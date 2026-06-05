/**
 * PosPage — point-of-sale terminal wired to the real /api/sales endpoint.
 *
 * Layout (3-pane, full-height):
 *   Left  : item search + clickable grid (live /api/items)
 *   Right : cart (add / qty / discount / remove) + customer header
 *           + payment lines + Complete sale CTA
 *
 * Special handling:
 *   - When an ITEM_TICKET (item_type === 4) is added to cart, a session
 *     + tier picker opens. Selection is persisted on the cart line as
 *     ticket_session_id + ticket_tier_id and posted to /api/sales, where
 *     Ticket_issuer reads them and mints one ticket per quantity unit
 *     with atomic 3-counter decrement.
 *   - Payments support multiple lines (Cash / Card / M-Pesa / Bank /
 *     Cheque / Gift card / Custom). The Complete CTA disables until
 *     sum(payment_amount - cash_refund) >= cart total.
 *   - On success, a result modal shows the sale_id, the receipt
 *     summary, and any minted ticket codes with redemption URLs +
 *     scannable QR previews so the operator can hand the customer
 *     a slip or email the codes.
 *
 * Out of scope (deferred enterprise todos):
 *   - Tax computation (delegates to Sale::save_value's existing flow;
 *     this page assumes prices are tax-inclusive for the demo)
 *   - Discount-type toggle (percent vs flat) — defaults to percent
 *   - Inline customer create — operator must use /customers first
 *   - Print receipt — covered by the legacy PHP receipt template
 */

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Check,
  CreditCard,
  DollarSign,
  Loader2,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingCart,
  Smartphone,
  Ticket as TicketIcon,
  User,
  X,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { showToast } from '../components/ui/Toast';

const ITEM_TICKET = 4;

interface Item {
  item_id: number;
  name: string;
  category: string | null;
  unit_price: string | number;
  item_type: number;
  description?: string | null;
}

interface CartLine {
  item_id: number;
  name: string;
  unit_price: number;
  quantity: number;
  discount: number;
  item_type: number;
  ticket_session_id?: number | null;
  ticket_tier_id?: number | null;
  ticket_session_label?: string;
  ticket_tier_name?: string;
  seat_row?: string;
  seat_number?: string;
}

interface CustomerLite { person_id: number; first_name: string; last_name: string; email?: string | null; }

interface TicketSession {
  session_id: number;
  label: string | null;
  starts_at: string;
  ends_at: string | null;
  quantity: number | null;
  quantity_issued: number;
  sold_out: boolean;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
}
interface TicketTier {
  tier_id: number;
  name: string;
  price: string;
  quantity: number | null;
  quantity_issued: number;
  sold_out: boolean;
}

interface MintedTicket {
  ticket_id: number;
  code: string;
  status: string;
  valid_from: string | null;
  valid_to: string | null;
  product_title: string | null;
  subtype: string | null;
  notice: string | null;
  redemption_url: string | null;
}

interface PaymentLine { payment_type: string; payment_amount: string; cash_refund: string; }

const PAYMENT_TYPES = ['Cash', 'Credit Card', 'M-Pesa', 'Bank Transfer', 'Cheque', 'Gift Card', 'Other'];

function lineTotal(l: CartLine): number {
  const gross = l.unit_price * l.quantity;
  const disc = (gross * l.discount) / 100;
  return Math.max(0, gross - disc);
}

export function PosPage() {
  // catalog
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [itemsLoading, setItemsLoading] = useState(false);

  // cart
  const [cart, setCart] = useState<CartLine[]>([]);

  // customer
  const [customer, setCustomer] = useState<CustomerLite | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerLite[]>([]);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);

  // payment
  const [payments, setPayments] = useState<PaymentLine[]>([
    { payment_type: 'Cash', payment_amount: '0.00', cash_refund: '0.00' },
  ]);

  // ticket picker
  const [pendingTicket, setPendingTicket] = useState<Item | null>(null);

  // sale flow
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    sale_id: number;
    total_paid: number;
    tickets: MintedTicket[];
  } | null>(null);

  // live items search — debounce 250ms
  const searchTimer = useRef<number | null>(null);
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      void loadItems(search);
    }, 250);
    return () => { if (searchTimer.current) window.clearTimeout(searchTimer.current); };
  }, [search]);

  async function loadItems(q: string) {
    setItemsLoading(true);
    try {
      const res = await api.items.list(1, 60, q);
      setItems(((res.data as unknown as { items?: Item[] })?.items) ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Item search failed', 'error');
    } finally {
      setItemsLoading(false);
    }
  }

  // live customer search — debounce
  const custTimer = useRef<number | null>(null);
  useEffect(() => {
    if (custTimer.current) window.clearTimeout(custTimer.current);
    if (!showCustomerSearch) return;
    custTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await api.customers.list(1, 10, customerSearch);
          setCustomerOptions(((res.data as unknown as { customers?: CustomerLite[] })?.customers) ?? []);
        } catch {
          setCustomerOptions([]);
        }
      })();
    }, 200);
    return () => { if (custTimer.current) window.clearTimeout(custTimer.current); };
  }, [customerSearch, showCustomerSearch]);

  const cartTotal = useMemo(() => cart.reduce((s, l) => s + lineTotal(l), 0), [cart]);
  const paymentsTotal = useMemo(
    () => payments.reduce((s, p) => s + (Number(p.payment_amount) || 0) - (Number(p.cash_refund) || 0), 0),
    [payments],
  );
  const itemCount = useMemo(() => cart.reduce((s, l) => s + l.quantity, 0), [cart]);

  function addItem(item: Item) {
    if (item.item_type === ITEM_TICKET) {
      // Open ticket picker first; the user must choose a session/tier
      setPendingTicket(item);
      return;
    }
    setCart((prev) => {
      const i = prev.findIndex((l) => l.item_id === item.item_id && l.item_type !== ITEM_TICKET);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i], quantity: next[i].quantity + 1 };
        return next;
      }
      return [...prev, {
        item_id: item.item_id,
        name: item.name,
        unit_price: Number(item.unit_price) || 0,
        quantity: 1,
        discount: 0,
        item_type: item.item_type,
      }];
    });
  }

  function setLineQty(idx: number, qty: number) {
    setCart((prev) => {
      if (qty <= 0) return prev.filter((_, i) => i !== idx);
      return prev.map((l, i) => (i === idx ? { ...l, quantity: qty } : l));
    });
  }
  function setLineDiscount(idx: number, pct: number) {
    setCart((prev) => prev.map((l, i) => (i === idx ? { ...l, discount: Math.max(0, Math.min(100, pct)) } : l)));
  }
  function removeLine(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  function addPayment() {
    setPayments((prev) => [...prev, { payment_type: 'Cash', payment_amount: '0.00', cash_refund: '0.00' }]);
  }
  function setPayment(idx: number, patch: Partial<PaymentLine>) {
    setPayments((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function removePayment(idx: number) {
    setPayments((prev) => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  }
  function payFullCash() {
    setPayments([{ payment_type: 'Cash', payment_amount: cartTotal.toFixed(2), cash_refund: '0.00' }]);
  }

  async function completeSale() {
    if (cart.length === 0) { showToast('Cart is empty', 'error'); return; }
    if (paymentsTotal + 0.005 < cartTotal) {
      showToast(`Payments (${paymentsTotal.toFixed(2)}) are less than total (${cartTotal.toFixed(2)})`, 'error');
      return;
    }
    const ticketLines = cart.filter((l) => l.item_type === ITEM_TICKET);
    for (const tl of ticketLines) {
      if (!tl.ticket_session_id && !tl.ticket_tier_id) {
        // Ticket without session/tier is allowed (uses product defaults).
        // No-op; this is a hint, not a block.
      }
    }

    setSubmitting(true);
    try {
      const body = {
        customer_id: customer?.person_id ?? null,
        comment: '',
        items: cart.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          price: l.unit_price.toFixed(2),
          discount: l.discount,
          discount_type: 1,
          ticket_session_id: l.ticket_session_id ?? null,
          ticket_tier_id: l.ticket_tier_id ?? null,
          seat_assignment: (l.seat_row && l.seat_number)
            ? { row: l.seat_row, seat: l.seat_number }
            : null,
        })),
        payments: payments.map((p) => ({
          payment_type: p.payment_type,
          payment_amount: p.payment_amount,
          cash_refund: p.cash_refund,
          cash_adjustment: 0,
        })),
      };
      const res = await api.sales.create(body);
      const data = res.data as unknown as { sale_id: number; total_paid: number; tickets?: MintedTicket[] } | null;
      if (!data) throw new Error(res.message ?? 'Sale returned no data');
      setResult({
        sale_id: data.sale_id,
        total_paid: data.total_paid,
        tickets: data.tickets ?? [],
      });
      // Clear cart for next sale
      setCart([]);
      setCustomer(null);
      setPayments([{ payment_type: 'Cash', payment_amount: '0.00', cash_refund: '0.00' }]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Sale failed', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* LEFT — item catalog */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items by name, SKU, or category…"
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-4 py-3 text-sm outline-none focus:border-fuchsia-500 focus:ring-2 focus:ring-fuchsia-500/20 transition"
          />
        </div>

        <div className="flex-1 overflow-auto pr-1">
          {itemsLoading && items.length === 0 ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-fuchsia-500" /></div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40">
              {search ? `No items match "${search}"` : 'No items in catalog. Add some via Items.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {items.map((item) => (
                <button
                  key={item.item_id}
                  type="button"
                  onClick={() => addItem(item)}
                  className={`rounded-xl border p-4 text-left hover:border-fuchsia-400 hover:shadow-md active:scale-95 transition-all ${item.item_type === ITEM_TICKET ? 'border-fuchsia-300 bg-fuchsia-50 dark:bg-fuchsia-950/30 dark:border-fuchsia-800' : 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}`}
                >
                  <div className="text-xl mb-1">
                    {item.item_type === ITEM_TICKET ? <TicketIcon className="inline h-5 w-5 text-fuchsia-600" /> : '🛒'}
                  </div>
                  <h3 className="font-medium text-sm text-gray-900 dark:text-white truncate" title={item.name}>{item.name}</h3>
                  {item.category && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.category}</p>}
                  <p className="mt-2 text-base font-bold text-fuchsia-600">{formatCurrency(Number(item.unit_price) || 0)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — cart */}
      <div className="w-96 flex flex-col rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
        {/* Customer */}
        <div className="border-b dark:border-gray-700 p-3">
          {customer ? (
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-fuchsia-600" />
              <span className="flex-1 text-sm font-medium text-gray-900 dark:text-white">
                {customer.first_name} {customer.last_name}
              </span>
              <button type="button" onClick={() => setCustomer(null)} className="text-gray-400 hover:text-rose-600">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setShowCustomerSearch(true); void loadCustomerOptions(''); }}
              className="flex items-center gap-2 text-sm text-gray-500 hover:text-fuchsia-600"
            >
              <User className="h-4 w-4" /> Walk-in customer · attach…
            </button>
          )}
          {showCustomerSearch && (
            <div className="relative mt-2">
              <input
                autoFocus
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customers…"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-xs"
              />
              {customerOptions.length > 0 && (
                <ul className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                  {customerOptions.map((c) => (
                    <li key={c.person_id}>
                      <button
                        type="button"
                        onClick={() => { setCustomer(c); setShowCustomerSearch(false); setCustomerSearch(''); }}
                        className="block w-full px-3 py-2 text-left text-xs hover:bg-fuchsia-50 dark:hover:bg-fuchsia-900/30"
                      >
                        <strong>{c.first_name} {c.last_name}</strong>
                        {c.email && <span className="ml-2 text-gray-500">{c.email}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={() => setShowCustomerSearch(false)} className="mt-1 text-[10px] text-gray-400 hover:text-gray-700">Cancel</button>
            </div>
          )}
        </div>

        {/* Cart header */}
        <div className="flex items-center gap-2 border-b dark:border-gray-700 px-4 py-2.5">
          <ShoppingCart className="h-4 w-4 text-fuchsia-500" />
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Cart</h2>
          <span className="ml-auto rounded-full bg-fuchsia-500 px-2 py-0.5 text-xs text-white font-medium">{itemCount}</span>
        </div>

        {/* Cart lines */}
        <div className="flex-1 overflow-auto p-3 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <ShoppingCart className="h-12 w-12 mb-2 opacity-30" />
              <p className="text-sm">Cart is empty</p>
              <p className="text-xs">Tap items to add them</p>
            </div>
          ) : (
            cart.map((l, idx) => (
              <div key={idx} className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                      {l.item_type === ITEM_TICKET && <TicketIcon className="inline h-3 w-3 text-fuchsia-600 mr-1" />}
                      {l.name}
                    </p>
                    <p className="text-[10px] text-gray-500">{formatCurrency(l.unit_price)} each</p>
                    {l.item_type === ITEM_TICKET && (l.ticket_session_label || l.ticket_tier_name) && (
                      <p className="text-[10px] text-fuchsia-700 dark:text-fuchsia-300">
                        {l.ticket_session_label}{l.ticket_session_label && l.ticket_tier_name ? ' · ' : ''}{l.ticket_tier_name}
                        {(l.seat_row && l.seat_number) ? ` · seat ${l.seat_row}${l.seat_number}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => setLineQty(idx, l.quantity - 1)} className="rounded-md p-1 hover:bg-gray-200 dark:hover:bg-gray-600"><Minus className="h-3 w-3" /></button>
                    <span className="w-6 text-center text-sm font-medium">{l.quantity}</span>
                    <button type="button" onClick={() => setLineQty(idx, l.quantity + 1)} className="rounded-md p-1 hover:bg-gray-200 dark:hover:bg-gray-600"><Plus className="h-3 w-3" /></button>
                  </div>
                  <span className="text-sm font-medium w-14 text-right">{formatCurrency(lineTotal(l))}</span>
                  <button type="button" onClick={() => removeLine(idx)} className="rounded-md p-1 hover:bg-red-100 dark:hover:bg-red-900/20 text-red-400"><X className="h-3 w-3" /></button>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <label className="text-gray-500">Discount %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={l.discount}
                    onChange={(e) => setLineDiscount(idx, Number(e.target.value) || 0)}
                    className="w-14 rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px] dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                  />
                </div>
              </div>
            ))
          )}
        </div>

        {/* Payments + footer */}
        <div className="border-t dark:border-gray-700 p-3 space-y-2">
          <div className="space-y-1">
            {payments.map((p, i) => (
              <div key={i} className="flex items-center gap-1">
                <select
                  value={p.payment_type}
                  onChange={(e) => setPayment(i, { payment_type: e.target.value })}
                  className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  {PAYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={p.payment_amount}
                  onChange={(e) => setPayment(i, { payment_amount: e.target.value })}
                  className="w-20 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-right dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                {payments.length > 1 && (
                  <button type="button" onClick={() => removePayment(i)} className="text-rose-400"><X className="h-3 w-3" /></button>
                )}
              </div>
            ))}
            <div className="flex justify-between text-[10px]">
              <button type="button" onClick={addPayment} className="text-fuchsia-600 hover:underline">+ Add payment</button>
              <button type="button" onClick={payFullCash} className="text-fuchsia-600 hover:underline">Pay all in cash</button>
            </div>
          </div>

          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>{formatCurrency(cartTotal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Paid</span><span className={paymentsTotal + 0.005 >= cartTotal ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>{formatCurrency(paymentsTotal)}</span></div>
            <div className="flex justify-between border-t dark:border-gray-700 pt-1 text-sm font-bold"><span className="text-gray-900 dark:text-white">Total</span><span className="text-fuchsia-600">{formatCurrency(cartTotal)}</span></div>
          </div>

          <button
            type="button"
            disabled={submitting || cart.length === 0 || paymentsTotal + 0.005 < cartTotal}
            onClick={() => void completeSale()}
            className="w-full rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {submitting ? 'Saving…' : 'Complete sale'}
          </button>
        </div>
      </div>

      {/* Ticket picker */}
      {pendingTicket && (
        <TicketPickerModal
          item={pendingTicket}
          onCancel={() => setPendingTicket(null)}
          onAdd={(line) => {
            setCart((prev) => [...prev, line]);
            setPendingTicket(null);
          }}
        />
      )}

      {/* Sale result */}
      {result && (
        <SaleResultModal result={result} onClose={() => setResult(null)} />
      )}
    </div>
  );

  async function loadCustomerOptions(q: string) {
    try {
      const res = await api.customers.list(1, 10, q);
      setCustomerOptions(((res.data as unknown as { customers?: CustomerLite[] })?.customers) ?? []);
    } catch {
      setCustomerOptions([]);
    }
  }
}

// ---------- ticket picker modal ----------

function TicketPickerModal({ item, onCancel, onAdd }: {
  item: Item;
  onCancel: () => void;
  onAdd: (line: CartLine) => void;
}) {
  const [productId, setProductId] = useState<number | null>(null);
  const [sessions, setSessions] = useState<TicketSession[]>([]);
  const [tiers, setTiers] = useState<TicketTier[]>([]);
  const [sessionId, setSessionId] = useState(0);
  const [tierId, setTierId] = useState(0);
  const [seatRow, setSeatRow] = useState('');
  const [seatNumber, setSeatNumber] = useState('');
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(true);
  const [unitPriceOverride, setUnitPriceOverride] = useState(Number(item.unit_price) || 0);

  // Resolve product_id from item, then load sessions+tiers
  useEffect(() => {
    void (async () => {
      try {
        // ticket-products list filtered for item_id requires a custom param —
        // workaround: fetch a page and find it client-side.
        const res = await api.tickets.products.list(1, 200, '', '');
        const products = ((res.data as unknown as { products?: Array<{ ticket_product_id: number; item_id: number }> })?.products) ?? [];
        const matching = products.find((p) => Number(p.item_id) === item.item_id);
        if (!matching) {
          showToast('No ticket product is linked to this item', 'error');
          onCancel();
          return;
        }
        setProductId(matching.ticket_product_id);
        const [sRes, tRes] = await Promise.all([
          api.tickets.products.sessions.list(matching.ticket_product_id),
          api.tickets.products.tiers.list(matching.ticket_product_id),
        ]);
        setSessions(((sRes.data as unknown as { sessions?: TicketSession[] })?.sessions) ?? []);
        setTiers(((tRes.data as unknown as { tiers?: TicketTier[] })?.tiers) ?? []);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Load failed', 'error');
        onCancel();
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.item_id]);

  // Update price override when a tier is selected
  useEffect(() => {
    if (tierId > 0) {
      const t = tiers.find((t) => t.tier_id === tierId);
      if (t) setUnitPriceOverride(Number(t.price) || 0);
    }
  }, [tierId, tiers]);

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const session = sessions.find((s) => s.session_id === sessionId);
    const tier = tiers.find((t) => t.tier_id === tierId);
    onAdd({
      item_id: item.item_id,
      name: item.name,
      unit_price: unitPriceOverride,
      quantity: qty,
      discount: 0,
      item_type: ITEM_TICKET,
      ticket_session_id: sessionId > 0 ? sessionId : null,
      ticket_tier_id: tierId > 0 ? tierId : null,
      ticket_session_label: session ? (session.label ?? session.starts_at.slice(0, 16)) : undefined,
      ticket_tier_name: tier?.name,
      seat_row: seatRow || undefined,
      seat_number: seatNumber || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div className="w-full max-w-md mx-4 rounded-2xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="border-b dark:border-gray-700 p-4 flex items-center gap-2">
          <TicketIcon className="h-5 w-5 text-fuchsia-600" />
          <h3 className="text-base font-bold text-gray-900 dark:text-white">{item.name}</h3>
        </div>
        {loading ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-fuchsia-500" /></div>
        ) : (
          <form onSubmit={handleAdd} className="p-4 space-y-3 text-sm">
            {sessions.length > 0 && (
              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Session</span>
                <select value={sessionId} onChange={(e) => setSessionId(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                  <option value={0}>— Any session —</option>
                  {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id} disabled={s.sold_out || s.status === 'cancelled' || s.status === 'ended'}>
                      {(s.label ?? '') + ' ' + s.starts_at}
                      {s.quantity !== null && ` (${s.quantity_issued}/${s.quantity})`}
                      {s.sold_out && ' SOLD OUT'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tiers.length > 0 && (
              <label className="block">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Tier</span>
                <select value={tierId} onChange={(e) => setTierId(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
                  <option value={0}>— Any tier —</option>
                  {tiers.map((t) => (
                    <option key={t.tier_id} value={t.tier_id} disabled={t.sold_out}>
                      {t.name} — {t.price}
                      {t.quantity !== null && ` (${t.quantity_issued}/${t.quantity})`}
                      {t.sold_out && ' SOLD OUT'}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-500">Seat row (optional)</span>
                <input value={seatRow} onChange={(e) => setSeatRow(e.target.value)} maxLength={8} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Seat number</span>
                <input value={seatNumber} onChange={(e) => setSeatNumber(e.target.value)} maxLength={8} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-gray-500">Quantity</span>
                <input type="number" min="1" max="100" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Unit price</span>
                <input type="number" step="0.01" min="0" value={unitPriceOverride} onChange={(e) => setUnitPriceOverride(Number(e.target.value) || 0)} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
              </label>
            </div>
            <div className="flex justify-between text-xs text-gray-500 pt-2">
              <span>Subtotal</span>
              <strong className="text-fuchsia-600">{formatCurrency(unitPriceOverride * qty)}</strong>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-200">Cancel</button>
              <button type="submit" disabled={!productId} className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">
                Add to cart
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ---------- sale result modal ----------

function SaleResultModal({ result, onClose }: {
  result: { sale_id: number; total_paid: number; tickets: MintedTicket[] };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="border-b dark:border-gray-700 p-5 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-emerald-500 flex items-center justify-center mb-3">
            <Check className="h-8 w-8 text-white" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Sale complete</h3>
          <p className="mt-1 text-sm text-gray-500">#{result.sale_id} · {formatCurrency(result.total_paid)} paid</p>
        </div>

        {result.tickets.length > 0 && (
          <div className="p-5 space-y-4">
            <p className="text-xs font-bold uppercase text-gray-500">
              {result.tickets.length} ticket{result.tickets.length === 1 ? '' : 's'} minted
            </p>
            {result.tickets.map((t) => (
              <div key={t.ticket_id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
                <div className="flex gap-3 items-start">
                  <div className="bg-white rounded p-1.5 shrink-0">
                    {t.redemption_url && <QRCode value={t.redemption_url} size={72} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-gray-900 dark:text-white truncate">{t.product_title}</p>
                    <p className="font-mono text-[11px] text-fuchsia-700 dark:text-fuchsia-300">{t.code}</p>
                    {t.valid_from && (
                      <p className="text-[10px] text-gray-500 mt-1">{t.valid_from} → {t.valid_to ?? '∞'}</p>
                    )}
                    {t.redemption_url && (
                      <a href={t.redemption_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-fuchsia-600 hover:underline truncate block mt-1">{t.redemption_url}</a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="border-t dark:border-gray-700 p-4 flex gap-2">
          <a href={`/sales/${result.sale_id}`} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold dark:border-gray-700 dark:text-gray-200">
            View sale
          </a>
          <button type="button" onClick={onClose} className="flex-1 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700">
            New sale
          </button>
        </div>
      </div>
    </div>
  );
}

// Suppress unused-import warnings for icons surfaced via JSX inside conditional branches.
const _iconsUsed = { CreditCard, DollarSign, QrCode, Smartphone };
void _iconsUsed;
