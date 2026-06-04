/**
 * PaymentMethodSummaryPage — honest per-payment-method breakdown for OSPOS sales.
 *
 * The merchantApp ships a "Wallet Reconciliation" view, but reconciliation requires
 * external statement imports that OSPOS sales alone cannot provide (no matched/unmatched
 * wallet txns, no settlement records). This page intentionally scopes down to what
 * sales data actually supports:
 *   - today's totals per payment_type (cash, card, mpesa, airtel, mtn_momo, bank, bnpl, …)
 *   - 7-day trend per method
 *   - share of revenue per method
 *
 * Visual treatment is borrowed from merchantApp's WalletReconciliationView wallet grid
 * (chmunyas/merchantApp src/components/merchant/features/WalletReconciliationView.tsx).
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Landmark,
  RefreshCw,
  Smartphone,
  Wallet,
  Banknote,
  HelpCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { showToast } from '../components/ui/Toast';

interface SaleRow {
  sale_id?: number | string;
  sale_time?: string;
  payment_type?: string;
  total?: number | string;
}

interface MethodMeta {
  id: string;
  label: string;
  icon: typeof CreditCard;
  bg: string;
  ring: string;
  text: string;
}

const METHOD_META: MethodMeta[] = [
  { id: 'cash',     label: 'Cash',         icon: Banknote,   bg: 'bg-emerald-50 dark:bg-emerald-900/30',   ring: 'ring-emerald-200 dark:ring-emerald-800', text: 'text-emerald-700 dark:text-emerald-300' },
  { id: 'mpesa',    label: 'M-Pesa',       icon: Smartphone, bg: 'bg-green-50 dark:bg-green-900/30',       ring: 'ring-green-200 dark:ring-green-800',     text: 'text-green-700 dark:text-green-300' },
  { id: 'airtel',   label: 'Airtel Money', icon: Smartphone, bg: 'bg-rose-50 dark:bg-rose-900/30',         ring: 'ring-rose-200 dark:ring-rose-800',       text: 'text-rose-700 dark:text-rose-300' },
  { id: 'mtn_momo', label: 'MTN MoMo',     icon: Smartphone, bg: 'bg-amber-50 dark:bg-amber-900/30',       ring: 'ring-amber-200 dark:ring-amber-800',     text: 'text-amber-700 dark:text-amber-300' },
  { id: 'card',     label: 'Card',         icon: CreditCard, bg: 'bg-slate-50 dark:bg-slate-900/30',       ring: 'ring-slate-200 dark:ring-slate-700',     text: 'text-slate-700 dark:text-slate-300' },
  { id: 'bank',     label: 'Bank',         icon: Landmark,   bg: 'bg-blue-50 dark:bg-blue-900/30',         ring: 'ring-blue-200 dark:ring-blue-800',       text: 'text-blue-700 dark:text-blue-300' },
  { id: 'bnpl',     label: 'BNPL · Co-op', icon: Landmark,   bg: 'bg-indigo-50 dark:bg-indigo-900/30',     ring: 'ring-indigo-200 dark:ring-indigo-800',   text: 'text-indigo-700 dark:text-indigo-300' },
  { id: 'wallet',   label: 'Wallet',       icon: Wallet,     bg: 'bg-purple-50 dark:bg-purple-900/30',     ring: 'ring-purple-200 dark:ring-purple-800',   text: 'text-purple-700 dark:text-purple-300' },
  { id: 'other',    label: 'Other',        icon: HelpCircle, bg: 'bg-gray-50 dark:bg-gray-900/30',         ring: 'ring-gray-200 dark:ring-gray-700',       text: 'text-gray-700 dark:text-gray-300' },
];

function normalizeMethod(payment_type: string | undefined): string {
  if (!payment_type) return 'other';
  const p = payment_type.toLowerCase();
  if (p.includes('cash')) return 'cash';
  if (p.includes('mpesa') || p.includes('m-pesa') || p === 'm pesa') return 'mpesa';
  if (p.includes('airtel')) return 'airtel';
  if (p.includes('mtn') || p.includes('momo')) return 'mtn_momo';
  if (p.includes('bnpl') || p.includes('coop') || p.includes('co-op')) return 'bnpl';
  if (p.includes('bank')) return 'bank';
  if (p.includes('card') || p.includes('credit') || p.includes('debit') || p.includes('visa') || p.includes('mastercard')) return 'card';
  if (p.includes('wallet')) return 'wallet';
  return 'other';
}

function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const MOCK_SALES: SaleRow[] = (() => {
  // Reasonable demo data so the empty page is never confusing.
  const out: SaleRow[] = [];
  const now = new Date();
  const methods: string[] = ['cash', 'mpesa', 'mpesa', 'card', 'mpesa', 'airtel', 'bank', 'bnpl'];
  for (let day = 0; day < 7; day++) {
    const dayBase = new Date(now);
    dayBase.setDate(now.getDate() - day);
    const txCount = 10 + Math.floor(Math.random() * 12);
    for (let i = 0; i < txCount; i++) {
      const t = new Date(dayBase);
      t.setHours(8 + Math.floor(Math.random() * 12), Math.floor(Math.random() * 60));
      out.push({
        sale_id: out.length + 1,
        sale_time: t.toISOString(),
        payment_type: methods[Math.floor(Math.random() * methods.length)],
        total: Math.round(150 + Math.random() * 4500),
      });
    }
  }
  return out;
})();

export function PaymentMethodSummaryPage() {
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [usingMock, setUsingMock] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await api.sales.list(1, 500);
      const list = (res.data?.sales ?? []) as unknown as SaleRow[];
      if (list.length > 0) {
        setSales(list);
        setUsingMock(false);
      } else {
        setSales(MOCK_SALES);
        setUsingMock(true);
      }
    } catch {
      setSales(MOCK_SALES);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const summary = useMemo(() => {
    const todayByMethod = new Map<string, { total: number; count: number }>();
    const weekByMethod = new Map<string, { total: number; count: number }>();
    let todayTotal = 0;
    let weekTotal = 0;

    // 7-day buckets keyed by method id then day key
    const trendBuckets = new Map<string, Map<string, number>>();
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayStart);
      d.setDate(todayStart.getDate() - i);
      dayKeys.push(dayKey(d));
    }

    for (const sale of sales) {
      const total = Number(sale.total) || 0;
      const dt = sale.sale_time ? new Date(sale.sale_time) : null;
      if (!dt || isNaN(dt.getTime())) continue;

      const isWithin7 = (todayStart.getTime() - dt.getTime()) / (24 * 60 * 60 * 1000) < 7;
      if (!isWithin7) continue;

      const id = normalizeMethod(sale.payment_type);
      const week = weekByMethod.get(id) ?? { total: 0, count: 0 };
      week.total += total;
      week.count += 1;
      weekByMethod.set(id, week);
      weekTotal += total;

      if (dt >= todayStart) {
        const today = todayByMethod.get(id) ?? { total: 0, count: 0 };
        today.total += total;
        today.count += 1;
        todayByMethod.set(id, today);
        todayTotal += total;
      }

      let bucket = trendBuckets.get(id);
      if (!bucket) {
        bucket = new Map();
        trendBuckets.set(id, bucket);
      }
      const key = dayKey(dt);
      bucket.set(key, (bucket.get(key) ?? 0) + total);
    }

    const methods = METHOD_META.map((m) => ({
      ...m,
      todayTotal: todayByMethod.get(m.id)?.total ?? 0,
      todayCount: todayByMethod.get(m.id)?.count ?? 0,
      weekTotal: weekByMethod.get(m.id)?.total ?? 0,
      weekCount: weekByMethod.get(m.id)?.count ?? 0,
      trend: dayKeys.map((k) => trendBuckets.get(m.id)?.get(k) ?? 0),
    }))
      .filter((m) => m.weekTotal > 0 || m.todayCount > 0)
      .sort((a, b) => b.weekTotal - a.weekTotal);

    return { methods, todayTotal, weekTotal, dayKeys };
  }, [sales, todayStart]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Payment method summary</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Today and 7-day totals grouped by payment method.{' '}
            {usingMock && <span className="text-amber-600 dark:text-amber-400">(demo data)</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            showToast('Refreshing sales…');
            void load();
          }}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-mono uppercase tracking-widest text-gray-500">Today</p>
          <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(summary.todayTotal)}</p>
          <p className="mt-1 text-xs text-gray-500">across {summary.methods.reduce((s, m) => s + m.todayCount, 0)} sales</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-mono uppercase tracking-widest text-gray-500">Last 7 days</p>
          <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-white">{formatCurrency(summary.weekTotal)}</p>
          <p className="mt-1 text-xs text-gray-500">across {summary.methods.reduce((s, m) => s + m.weekCount, 0)} sales</p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-44 animate-pulse rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50" />
          ))}
        </div>
      ) : summary.methods.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/50">
          No sales recorded in the last 7 days.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summary.methods.map((m) => {
            const Icon = m.icon;
            const maxTrend = Math.max(...m.trend, 1);
            const sharePct = summary.weekTotal > 0 ? (m.weekTotal / summary.weekTotal) * 100 : 0;
            return (
              <div
                key={m.id}
                className={`rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ring-2 ${m.bg} ${m.ring}`}>
                    <Icon className={`h-5 w-5 ${m.text}`} />
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{m.weekCount} sales · 7d</p>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-gray-400">{m.id}</p>
                  </div>
                </div>
                <h3 className="mt-3 text-sm font-bold text-gray-900 dark:text-white">{m.label}</h3>

                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(m.weekTotal)}</p>
                  <p className="text-xs text-gray-500">7-day</p>
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">{formatCurrency(m.todayTotal)}</p>
                  <p className="text-xs text-gray-500">today ({m.todayCount})</p>
                </div>

                {/* Trend */}
                <div className="mt-4">
                  <div className="flex h-10 items-end gap-1">
                    {m.trend.map((v, i) => (
                      <div
                        key={i}
                        className={`flex-1 rounded-sm ${m.bg.replace('bg-', 'bg-').replace('50', '300').replace('900/30', '600')}`}
                        style={{ height: `${Math.max(4, (v / maxTrend) * 100)}%` }}
                        title={formatCurrency(v)}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">7-day trend</p>
                </div>

                {/* Share */}
                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>Share of revenue</span>
                    <span className="font-semibold">{sharePct.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700">
                    <div className={`h-1 rounded-full ${m.bg.replace('bg-', 'bg-').replace('50', '500').replace('900/30', '500')}`} style={{ width: `${sharePct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
        <p className="font-semibold">About this page</p>
        <p className="mt-1">
          This is a summary of sales recorded in OSPOS grouped by payment method.
          It is intentionally not a full bank/wallet reconciliation — true reconciliation
          requires importing external statements from M-Pesa, KCB, Airtel, etc. to match
          against recorded sales.
        </p>
      </div>
    </div>
  );
}
