/**
 * FxPage — multi-currency converter + provider best-rate comparison.
 *
 * Patterns stolen from chmunyas/merchantApp:
 *   - QuickExchange.tsx (sell/receive/swap widget, components/QuickExchange.tsx)
 *   - ProviderComparison.tsx (best-rate provider list, components/ProviderComparison.tsx)
 *
 * Rewritten to use concrete Tailwind classes (no shadcn semantic tokens).
 * Rates are static demo data — marked "Demo rates, not live quotes" per
 * rubber-duck feedback to avoid implying executable financial pricing.
 */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowRightLeft, Globe2, ShieldCheck, Zap } from 'lucide-react';

type Currency = 'USD' | 'EUR' | 'GBP' | 'KES' | 'UGX' | 'TZS' | 'NGN';

const CURRENCIES: Currency[] = ['USD', 'EUR', 'GBP', 'KES', 'UGX', 'TZS', 'NGN'];

// Mid-market rates, all relative to USD. Demo only.
const TO_USD: Record<Currency, number> = {
  USD: 1,
  EUR: 1.0815,
  GBP: 1.275,
  KES: 0.0077,
  UGX: 0.000264,
  TZS: 0.00037,
  NGN: 0.00063,
};

function midRate(from: Currency, to: Currency): number {
  if (from === to) return 1;
  // amountInUSD = fromAmount * TO_USD[from]; toAmount = amountInUSD / TO_USD[to]
  return TO_USD[from] / TO_USD[to];
}

interface ProviderQuote {
  code: string;
  name: string;
  arrival: string;
  feeUsd: number;
  spreadBps: number; // basis points below mid (lower = better rate)
  bg: string;
  fg: string;
}

const PROVIDERS: ProviderQuote[] = [
  { code: 'W',  name: 'Wise',          arrival: 'Instant',       feeUsd: 4.5,  spreadBps: 25,  bg: 'bg-indigo-600',                      fg: 'text-white' },
  { code: 'CC', name: 'Currencycloud', arrival: '1–2 days',      feeUsd: 0,    spreadBps: 60,  bg: 'bg-gray-100 dark:bg-gray-800',       fg: 'text-gray-700 dark:text-gray-200' },
  { code: 'LX', name: 'LMAX Prime',    arrival: 'T+0',           feeUsd: 0,    spreadBps: 70,  bg: 'bg-gray-100 dark:bg-gray-800',       fg: 'text-gray-700 dark:text-gray-200' },
  { code: 'VT', name: 'Verto',         arrival: 'Same day',      feeUsd: 2.1,  spreadBps: 95,  bg: 'bg-gray-100 dark:bg-gray-800',       fg: 'text-gray-700 dark:text-gray-200' },
  { code: 'KC', name: 'KCB Bank',      arrival: '1 day',         feeUsd: 8,    spreadBps: 180, bg: 'bg-gray-100 dark:bg-gray-800',       fg: 'text-gray-700 dark:text-gray-200' },
];

function formatAmount(value: number, currency: Currency): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatNumeric(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function FxPage() {
  const [sellInput, setSellInput] = useState('100000');
  const [from, setFrom] = useState<Currency>('USD');
  const [to, setTo] = useState<Currency>('KES');

  const sellAmount = useMemo(() => {
    const n = Number(sellInput.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [sellInput]);

  const mid = midRate(from, to);

  const quotes = useMemo(() => {
    return PROVIDERS.map((p) => {
      // Effective rate = mid * (1 - spread)
      const rate = mid * (1 - p.spreadBps / 10_000);
      const totalReceived = sellAmount * rate;
      // Fee converted into the sell currency for fair comparison (approx via USD).
      const feeInSellCcy = p.feeUsd / TO_USD[from];
      return {
        ...p,
        rate,
        totalReceived,
        feeInSellCcy,
        netReceived: Math.max(0, totalReceived - feeInSellCcy * rate),
      };
    }).sort((a, b) => b.netReceived - a.netReceived);
  }, [mid, sellAmount, from]);

  const best = quotes[0];

  function swap() {
    setFrom(to);
    setTo(from);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Globe2 className="h-6 w-6 text-indigo-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">FX Converter</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Compare provider rates and pick the best route for cross-border payouts.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          <ShieldCheck className="h-3 w-3" />
          Demo rates · not live quotes
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Quick exchange widget */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
              Quick exchange
            </h2>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="fx-sell" className="block text-[10px] font-mono uppercase tracking-widest text-gray-500">
                You sell
              </label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-3 focus-within:border-indigo-500 focus-within:bg-white dark:border-gray-700 dark:bg-gray-900 dark:focus-within:bg-gray-950">
                <input
                  id="fx-sell"
                  type="text"
                  value={sellInput}
                  onChange={(e) => setSellInput(e.target.value)}
                  inputMode="decimal"
                  className="flex-1 bg-transparent text-lg font-bold outline-none text-gray-900 dark:text-white"
                />
                <select
                  value={from}
                  onChange={(e) => setFrom(e.target.value as Currency)}
                  aria-label="From currency"
                  className="cursor-pointer rounded-md bg-transparent font-mono text-xs font-bold outline-none text-gray-900 dark:text-white"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                onClick={swap}
                aria-label="Swap currencies"
                className="-my-2 z-10 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-gray-900 text-white shadow-sm transition-transform hover:scale-105 dark:border-gray-800 dark:bg-white dark:text-gray-900"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>

            <div>
              <label htmlFor="fx-receive" className="block text-[10px] font-mono uppercase tracking-widest text-gray-500">
                You receive
              </label>
              <div className="mt-1 flex items-center gap-2 rounded-xl border border-gray-200 bg-emerald-50 px-3 py-3 dark:border-gray-700 dark:bg-emerald-900/20">
                <input
                  id="fx-receive"
                  readOnly
                  value={formatNumeric(best?.totalReceived ?? 0)}
                  className="flex-1 bg-transparent text-lg font-bold outline-none text-gray-900 dark:text-white"
                />
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value as Currency)}
                  aria-label="To currency"
                  className="cursor-pointer rounded-md bg-transparent font-mono text-xs font-bold outline-none text-gray-900 dark:text-white"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400">
              <div className="flex items-center justify-between">
                <span>Mid-market rate</span>
                <span className="font-mono font-semibold text-gray-900 dark:text-white">
                  1 {from} = {mid.toFixed(4)} {to}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Best provider</span>
                <span className="font-mono font-semibold text-gray-900 dark:text-white">{best?.name ?? '—'}</span>
              </div>
            </div>

            <button
              type="button"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-4 py-3 text-sm font-bold text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
            >
              <Zap className="h-4 w-4" />
              Execute via {best?.name ?? 'best route'}
            </button>
            <p className="text-center text-[10px] font-mono text-gray-400">
              Rate would be locked for 54 seconds in production
            </p>
          </div>
        </div>

        {/* Provider comparison */}
        <div className="space-y-3 lg:col-span-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-mono uppercase tracking-widest text-gray-500">
              Provider comparison
            </h2>
            <span className="text-[10px] italic text-gray-400">
              Mid-market: {mid.toFixed(4)} · {sellAmount.toLocaleString()} {from} → ? {to}
            </span>
          </div>

          <div className="space-y-2">
            {quotes.map((q, i) => {
              const isBest = i === 0;
              return (
                <div
                  key={q.code}
                  className={`relative flex items-center justify-between gap-4 overflow-hidden rounded-xl border bg-white p-4 transition-colors dark:bg-gray-800 ${
                    isBest
                      ? 'border-2 border-emerald-500 dark:border-emerald-400'
                      : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                  }`}
                >
                  {isBest && (
                    <span className="absolute top-0 right-0 rounded-bl-lg bg-emerald-500 px-3 py-1 text-[9px] font-bold uppercase tracking-widest text-white">
                      Best rate
                    </span>
                  )}
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg font-bold ${q.bg} ${q.fg}`}>
                      {q.code}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-gray-900 dark:text-white">{q.name}</p>
                      <p className="font-mono text-[10px] text-gray-500 dark:text-gray-400">
                        Fee: ${q.feeUsd.toFixed(2)} · Arrival: {q.arrival}
                      </p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-lg font-bold text-gray-900 dark:text-white">
                      {q.rate.toFixed(4)}
                    </p>
                    <p className={`font-mono text-[10px] ${isBest ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      {formatAmount(q.totalReceived, to)} total
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
