/**
 * MenuPage — Public, customer-facing table menu at /menu/:tableId.
 *
 * Customer scans the table QR, browses the menu (categories + add/remove),
 * then taps "Send to kitchen" which drops a KitchenOrder onto the
 * BroadcastChannel bus (lib/realtime.ts). Any KDS tab in the SAME browser
 * receives it instantly. Cross-device/cross-browser would need a backend
 * WebSocket/SSE — out of scope for Tier 2 (acknowledged demo limitation).
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChefHat, ChevronLeft, ShoppingBag, Sparkles } from 'lucide-react';
import {
  CustomerMenuList,
  type CatalogueItem,
} from '../components/menu/CustomerMenuList';
import {
  generateOrderId,
  submitNewOrder,
  type KitchenOrder,
  type KitchenOrderItem,
} from '../lib/realtime';
import { useI18n } from '../lib/i18n';
import { api } from '../lib/api';
import type { Item } from '../types';

const MOCK_ITEMS: CatalogueItem[] = [
  { id: 'm-1', name: 'Beef Burger',         category: 'Mains',     price: 850,  description: 'Grilled beef patty, lettuce, tomato, special sauce', dietary: ['halal'] },
  { id: 'm-2', name: 'Chicken Wings (6)',   category: 'Starters',  price: 600,  description: 'Spicy buffalo wings with blue cheese dip' },
  { id: 'm-3', name: 'Margherita Pizza',    category: 'Mains',     price: 950,  description: 'Fresh tomato, mozzarella, basil', dietary: ['vegetarian'] },
  { id: 'm-4', name: 'Caesar Salad',        category: 'Starters',  price: 480,  description: 'Crisp romaine, parmesan, croutons, anchovy dressing' },
  { id: 'm-5', name: 'Ugali & Sukuma',      category: 'Mains',     price: 320,  description: 'Kenyan staple — fresh sukuma wiki and white maize meal', dietary: ['vegan'] },
  { id: 'm-6', name: 'Nyama Choma (250g)',  category: 'Mains',     price: 1200, description: 'Charcoal-grilled goat with kachumbari', dietary: ['halal'] },
  { id: 'm-7', name: 'Mandazi (3)',         category: 'Desserts',  price: 200,  description: 'Sweet East-African triangular doughnuts' },
  { id: 'm-8', name: 'Chocolate Cake',      category: 'Desserts',  price: 380,  description: 'Rich dark chocolate sponge with ganache' },
  { id: 'm-9', name: 'Tusker Lager (500ml)', category: 'Drinks',   price: 280,  description: 'Kenya\u2019s favourite lager' },
  { id: 'm-10', name: 'Stoney Tangawizi',   category: 'Drinks',    price: 120,  description: 'Ginger soda' },
  { id: 'm-11', name: 'Fresh Mango Juice',  category: 'Drinks',    price: 180,  description: '100% pressed seasonal mango', dietary: ['vegan'] },
  { id: 'm-12', name: 'Kenyan Coffee',      category: 'Drinks',    price: 220,  description: 'Single-origin AA from Nyeri' },
];

const CATEGORY_ORDER = ['Starters', 'Mains', 'Desserts', 'Drinks'];

const MOCK_SUGGESTIONS: Record<string, string[]> = {
  'm-1': ['m-9', 'm-2', 'm-8'],
  'm-3': ['m-4', 'm-10', 'm-7'],
  'm-6': ['m-9', 'm-5', 'm-11'],
  'm-5': ['m-10', 'm-11', 'm-7'],
  'm-2': ['m-9', 'm-1', 'm-10'],
  'm-4': ['m-3', 'm-11', 'm-8'],
};

function itemToCatalogue(item: Item, idx: number): CatalogueItem {
  return {
    id: String(item.item_id ?? `api-${idx}`),
    name: item.name || 'Untitled item',
    category: item.category || 'Mains',
    price: Number(item.unit_price) || 0,
    description: item.description || undefined,
    available: Number(item.quantity ?? 1) > 0,
  };
}

export function MenuPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const { t } = useI18n();
  const [items, setItems] = useState<CatalogueItem[]>(MOCK_ITEMS);
  const [usingMock, setUsingMock] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.items.list(1, 100, '');
        const apiItems = (res.data?.items ?? []) as Item[];
        if (!cancelled && apiItems.length > 0) {
          setItems(apiItems.map(itemToCatalogue));
          setUsingMock(false);
        }
      } catch {
        // Public route — auth-protected API may reject. Fall back to mock items.
        if (!cancelled) setUsingMock(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const itemMap = useMemo(() => {
    const map = new Map<string, CatalogueItem>();
    for (const it of items) map.set(it.id, it);
    return map;
  }, [items]);

  const cartTotals = useMemo(() => {
    let count = 0;
    let total = 0;
    for (const [id, qty] of Object.entries(cart)) {
      const it = itemMap.get(id);
      if (!it) continue;
      count += qty;
      total += it.price * qty;
    }
    return { count, total };
  }, [cart, itemMap]);

  function addItem(item: CatalogueItem) {
    setSubmitted(false);
    setCart((prev) => ({ ...prev, [item.id]: (prev[item.id] ?? 0) + 1 }));
  }

  function removeItem(item: CatalogueItem) {
    setCart((prev) => {
      const next = { ...prev };
      const current = next[item.id] ?? 0;
      if (current <= 1) {
        delete next[item.id];
      } else {
        next[item.id] = current - 1;
      }
      return next;
    });
  }

  function suggestionsFor(item: CatalogueItem): CatalogueItem[] {
    if (!usingMock) return [];
    const ids = MOCK_SUGGESTIONS[item.id] ?? [];
    return ids.map((id) => itemMap.get(id)).filter(Boolean) as CatalogueItem[];
  }

  function sendToKitchen() {
    if (cartTotals.count === 0 || submitting) return;
    setSubmitting(true);

    const orderItems: KitchenOrderItem[] = Object.entries(cart)
      .map(([id, qty]) => {
        const it = itemMap.get(id);
        if (!it) return null;
        const destination: KitchenOrderItem['destination'] =
          /coke|cola|juice|wine|beer|water|coffee|tea|soda|tusker|stoney|tangawizi/i.test(it.name)
            ? 'bar'
            : 'kitchen';
        return {
          id: it.id,
          name: it.name,
          quantity: qty,
          price: it.price,
          notes: '',
          destination,
        } as KitchenOrderItem;
      })
      .filter(Boolean) as KitchenOrderItem[];

    const now = new Date().toISOString();
    const order: KitchenOrder = {
      id: generateOrderId(),
      tableId: tableId || 'walk-in',
      tableName: `Table ${tableId ?? '—'}`,
      items: orderItems,
      status: 'new',
      total: cartTotals.total,
      currency: 'KES',
      fulfilment: 'dine-in',
      createdAt: now,
      updatedAt: now,
    };

    submitNewOrder(order);
    setSubmitting(false);
    setSubmitted(true);
    setCart({});
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 via-white to-sky-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
          <Link
            to={tableId ? `/t/${tableId}` : '/pay'}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            <ChevronLeft className="h-4 w-4" />
            {tableId ? 'Bill' : 'Back'}
          </Link>
          <div className="text-center">
            <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
              {t('table.scanFlow')}
            </p>
            <h1 className="text-base font-bold text-slate-900">
              Table {tableId ?? '—'} · Menu
            </h1>
          </div>
          <div className="w-12 text-right">
            <ShoppingBag className="ml-auto h-5 w-5 text-purple-600" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 py-5 pb-32">
        {usingMock && (
          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Sparkles className="h-4 w-4 shrink-0" />
            <span>
              Showing demo menu. Connect the items API to display this venue's
              live menu.
            </span>
          </div>
        )}

        {submitted && (
          <div className="mb-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <ChefHat className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Order sent to kitchen!</p>
              <p className="text-xs">
                Your order has been queued. Browse more or wait for service.
              </p>
            </div>
          </div>
        )}

        <CustomerMenuList
          items={items}
          categoryOrder={CATEGORY_ORDER}
          itemQuantities={cart}
          onAddItem={addItem}
          onRemoveItem={removeItem}
          getSuggestions={suggestionsFor}
          onAddSuggestedItem={addItem}
        />
      </main>

      {cartTotals.count > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 backdrop-blur"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
                {cartTotals.count} {cartTotals.count === 1 ? 'item' : 'items'}
              </p>
              <p className="text-lg font-bold text-slate-900">
                KES {cartTotals.total.toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              onClick={sendToKitchen}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-2xl bg-purple-600 px-5 py-3 text-sm font-bold text-white shadow-lg hover:bg-purple-700 disabled:opacity-60"
            >
              <ChefHat className="h-5 w-5" />
              {submitting ? 'Sending…' : 'Send to kitchen'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
