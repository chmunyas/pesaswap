import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Users,
  Zap,
  Receipt,
  Plus,
  Minus,
  Clock3,
  Coffee,
  ChefHat,
  BookOpen,
} from 'lucide-react';
import { submitNewOrder, generateOrderId, type KitchenOrder, type KitchenOrderItem } from '../lib/realtime';
import { useI18n } from '../lib/i18n';

type TableItem = {
  id: number;
  name: string;
  qty: number;
  price: number;
};

type TableBill = {
  tableId: string;
  tableName: string;
  merchant: string;
  items: TableItem[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
};

const DEMO_BILL: TableBill = {
  tableId: 'demo',
  tableName: 'Table 7',
  merchant: 'PESASWAP Demo Restaurant',
  currency: 'KES',
  items: [
    { id: 1, name: 'Margherita Pizza', qty: 2, price: 850 },
    { id: 2, name: 'Caesar Salad', qty: 1, price: 650 },
    { id: 3, name: 'Coca Cola (500ml)', qty: 4, price: 150 },
    { id: 4, name: 'Tiramisu', qty: 2, price: 450 },
  ],
  subtotal: 3850,
  tax: 616,
  total: 4466,
};

export function TablePayPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [bill, setBill] = useState<TableBill | null>(null);
  const [loading, setLoading] = useState(true);
  const [splitCount, setSplitCount] = useState(1);
  const [tipPercent, setTipPercent] = useState<number>(10);
  const [paid, setPaid] = useState(false);
  const [orderedToKds, setOrderedToKds] = useState(false);
  const [startTime] = useState(() => Date.now());

  useEffect(() => {
    // Attempt to load real bill from API for this table; fall back to demo
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/dinner-tables/${tableId}/bill`, { credentials: 'include' });
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.bill) {
            setBill(data.bill);
            return;
          }
        }
      } catch {
        // ignore — fall through to demo
      }
      if (!cancelled) setBill({ ...DEMO_BILL, tableId: tableId || 'demo' });
    }
    load().finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [tableId]);

  if (loading || !bill) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="h-10 w-10 rounded-full border-4 border-gray-900 dark:border-white border-t-transparent animate-spin" />
      </div>
    );
  }

  if (paid) {
    return <PaidSuccess bill={bill} elapsedMs={Date.now() - startTime} onDone={() => navigate('/')} />;
  }

  const tipAmount = (bill.total * tipPercent) / 100;
  const totalWithTip = bill.total + tipAmount;
  const perPerson = totalWithTip / Math.max(1, splitCount);

  function placeOrderToKitchen() {
    if (!bill) return;
    const items: KitchenOrderItem[] = bill.items.map((it) => ({
      id: String(it.id),
      name: it.name,
      quantity: it.qty,
      price: it.price,
      destination: /coke|cola|juice|wine|beer|water|coffee|tea|soda/i.test(it.name)
        ? 'bar'
        : 'kitchen',
    }));
    const order: KitchenOrder = {
      id: generateOrderId(),
      tableId: bill.tableId,
      tableName: bill.tableName,
      items,
      status: 'new',
      total: bill.total,
      currency: bill.currency,
      fulfilment: 'dine-in',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    submitNewOrder(order);
    setOrderedToKds(true);
    setTimeout(() => setOrderedToKds(false), 3500);
  }

  function payNow() {
    if (!bill) return;
    const b = bill;
    const payload = btoa(
      JSON.stringify({
        till: `T-${b.tableId}`,
        amount: Math.round(perPerson),
        merchant: b.merchant,
        currency: b.currency,
        reference: `${b.tableName} · ${splitCount > 1 ? `1/${splitCount}` : 'full'}`,
      }),
    );
    window.location.href = `/pay?tapgo=${encodeURIComponent(payload)}`;
  }

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-32"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 8rem)' }}
    >
      {/* Header */}
      <div className="bg-gray-900 dark:bg-gray-800 text-white px-5 pt-8 pb-12 rounded-b-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono uppercase opacity-70 mb-2">
              <Coffee className="h-3.5 w-3.5" />
              {bill.merchant}
            </div>
            <h1 className="text-2xl font-bold">{bill.tableName}</h1>
            <p className="text-xs text-white/60 mt-1">{t('table.scanFlow')}</p>
          </div>
          <Link
            to={`/menu/${bill.tableId}`}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20"
          >
            <BookOpen className="h-4 w-4" />
            Browse menu
          </Link>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 -mt-6 space-y-4">
        {/* Items */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center gap-2 mb-3 text-gray-900 dark:text-white">
            <Receipt className="h-4 w-4" />
            <h2 className="text-sm font-bold">{t('table.yourBill')}</h2>
          </div>
          <div className="space-y-2.5">
            {bill.items.map((item) => (
              <div key={item.id} className="flex justify-between items-start text-sm">
                <div className="flex-1">
                  <p className="font-medium text-gray-900 dark:text-white">{item.name}</p>
                  <p className="text-xs text-gray-500">
                    {item.qty} × {bill.currency} {item.price.toLocaleString()}
                  </p>
                </div>
                <span className="font-mono font-semibold text-gray-900 dark:text-white">
                  {bill.currency} {(item.qty * item.price).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-200 dark:border-gray-800 mt-4 pt-3 space-y-1.5 text-sm">
            <div className="flex justify-between text-gray-500">
              <span>{t('table.subtotal')}</span>
              <span className="font-mono">{bill.currency} {bill.subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-gray-500">
              <span>{t('table.tax')} (16%)</span>
              <span className="font-mono">{bill.currency} {bill.tax.toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold text-gray-900 dark:text-white pt-1">
              <span>{t('table.total')}</span>
              <span className="font-mono">{bill.currency} {bill.total.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Split */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 text-gray-900 dark:text-white">
              <Users className="h-4 w-4" />
              <h2 className="text-sm font-bold">{t('table.splitBill')}</h2>
            </div>
            <span className="text-xs text-gray-500">
              {splitCount > 1 ? `${splitCount} ${t('table.ways')}` : t('table.justMe')}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => setSplitCount(Math.max(1, splitCount - 1))}
              className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-700 dark:text-gray-200"
            >
              <Minus className="h-5 w-5" />
            </button>
            <span className="text-4xl font-bold font-mono text-gray-900 dark:text-white">{splitCount}</span>
            <button
              onClick={() => setSplitCount(Math.min(20, splitCount + 1))}
              className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-700 dark:text-gray-200"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Tip */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
          <h2 className="text-sm font-bold mb-3 text-gray-900 dark:text-white">{t('table.addTip')} 💚</h2>
          <div className="grid grid-cols-4 gap-2">
            {[0, 10, 15, 20].map((pct) => (
              <button
                key={pct}
                onClick={() => setTipPercent(pct)}
                className={`py-3 rounded-xl text-sm font-bold transition-colors ${
                  tipPercent === pct
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200'
                }`}
              >
                {pct === 0 ? t('table.none') : `${pct}%`}
              </button>
            ))}
          </div>
          {tipPercent > 0 && (
            <p className="text-xs text-gray-500 mt-2 text-center font-mono">
              + {bill.currency} {tipAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })} {t('table.tip')}
            </p>
          )}
        </div>
      </div>

      {/* Fixed bottom CTA */}
      <div
        className="fixed bottom-0 inset-x-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 px-4 py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
      >
        <div className="max-w-md mx-auto">
          <div className="flex justify-between items-center mb-3">
            <span className="text-xs text-gray-500">{splitCount > 1 ? t('table.yourShare') : t('table.youPay')}</span>
            <span className="text-2xl font-bold font-mono text-gray-900 dark:text-white">
              {bill.currency} {perPerson.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
          <button
            onClick={payNow}
            className="w-full bg-emerald-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 active:bg-emerald-700"
          >
            <Zap className="h-5 w-5" />
            {t('table.payNow')}
          </button>
          <button
            onClick={placeOrderToKitchen}
            className="w-full mt-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 py-3 rounded-2xl text-xs font-semibold flex items-center justify-center gap-2 active:bg-gray-50 dark:active:bg-gray-800"
          >
            <ChefHat className="h-4 w-4" />
            Send order to kitchen
          </button>
          <button
            onClick={() => setPaid(true)}
            className="w-full mt-1 text-xs text-gray-500 font-mono text-center underline"
          >
            Demo: mark as paid
          </button>
        </div>
      </div>

      {/* "Sent to kitchen" toast */}
      {orderedToKds && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-orange-600 text-white px-4 py-3 shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <ChefHat className="h-5 w-5" />
          <span className="text-sm font-semibold">Order sent to kitchen 👨‍🍳</span>
        </div>
      )}
    </div>
  );
}

function PaidSuccess({ bill, elapsedMs, onDone }: { bill: TableBill; elapsedMs: number; onDone: () => void }) {
  const { t } = useI18n();
  const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center p-6 text-center" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="h-24 w-24 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-4">
        <CheckCircle2 className="h-14 w-14 text-emerald-600" />
      </div>
      <h1 className="text-xl font-bold text-emerald-700 dark:text-emerald-300">{t('table.allPaid')}</h1>
      <p className="text-gray-500 mt-1">{bill.tableName} · {bill.merchant}</p>
      <p className="text-3xl font-bold font-mono text-gray-900 dark:text-white mt-4">
        {bill.currency} {bill.total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1.5 mt-3 text-emerald-600 dark:text-emerald-400 text-xs font-mono">
        <Clock3 className="h-3.5 w-3.5" />
        {elapsedSec} {t('pay.seconds')} — {t('table.tableClosed')}
      </div>
      <button
        onClick={onDone}
        className="mt-8 w-full max-w-xs bg-gray-900 dark:bg-white text-white dark:text-gray-900 py-4 rounded-2xl text-sm font-bold"
      >
        {t('action.done')}
      </button>
    </div>
  );
}
