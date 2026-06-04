/**
 * PublicGiftCardPage — public-route balance lookup.
 *
 * Mounted at /giftcard/:code (outside ProtectedRoutes). A customer scans
 * the QR on a printed gift card or in the merchant's app, and lands here
 * to see balance + recent activity. No auth.
 *
 * Backed by GET /api/public/giftcards/balance/:code, which is rate-limited
 * (60 req/min/IP) and returns the same shape for valid/invalid codes so
 * code enumeration is harder. The PWA service worker is configured to
 * NOT cache this endpoint — a customer must see live balance, never stale.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CreditCard,
  Mail,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { api } from '../lib/api';

interface PublicHistoryEntry {
  action: string;
  amount: number;
  created_at: string;
}

interface PublicLookup {
  masked_code: string | null;
  balance: number;
  currency: string;
  status: string;
  valid: boolean;
  expires_at: string | null;
  history: PublicHistoryEntry[];
}

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return iso;
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return new Date(t).toLocaleDateString();
  } catch {
    return iso;
  }
}

const ACTION_LABEL: Record<string, string> = {
  created: 'Issued',
  redeemed: 'Redeemed',
  refunded: 'Refunded',
  adjusted: 'Adjusted',
  topped_up: 'Topped up',
  emailed: 'Email sent',
  disabled: 'Disabled',
};

export function PublicGiftCardPage() {
  const { code } = useParams<{ code: string }>();
  const [lookup, setLookup] = useState<PublicLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.giftcards.publicBalance(code);
      const d = res.data as unknown as PublicLookup | undefined;
      if (!d) {
        setError('Lookup failed.');
        return;
      }
      setLookup({
        masked_code: d.masked_code ?? null,
        balance: Number(d.balance ?? 0),
        currency: String(d.currency ?? 'KES'),
        status: String(d.status ?? 'inactive'),
        valid: Boolean(d.valid),
        expires_at: d.expires_at ?? null,
        history: Array.isArray(d.history) ? d.history.map((h) => ({ action: String(h.action), amount: Number(h.amount), created_at: String(h.created_at) })) : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
    >
      <div className="mx-auto w-full max-w-sm space-y-5 pt-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-900 text-white px-4 py-2 dark:bg-white dark:text-gray-900">
            <CreditCard className="h-4 w-4" />
            <span className="text-sm font-bold font-mono">PESASWAP · Gift Card</span>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
          </div>
        ) : error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900 dark:bg-rose-900/20">
            <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
            <p className="mt-3 text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>
            <button onClick={load} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-gray-900">
              <RotateCcw className="h-3.5 w-3.5" /> Try again
            </button>
          </div>
        ) : lookup && lookup.valid ? (
          <>
            {/* Main card */}
            <div className="rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-6 text-white shadow-xl">
              <div className="flex items-center justify-between">
                <div className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur">
                  Active
                </div>
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="mt-6 text-center">
                <p className="text-[10px] font-mono uppercase tracking-widest opacity-70">Balance</p>
                <p className="mt-2 text-4xl font-bold font-mono">{lookup.currency} {lookup.balance.toLocaleString()}</p>
                <p className="mt-2 font-mono text-xs opacity-80">{lookup.masked_code}</p>
              </div>
              {lookup.expires_at && (
                <div className="mt-5 flex items-center justify-center gap-1.5 rounded-full bg-white/10 py-1.5 text-[10px] backdrop-blur">
                  <Clock className="h-3 w-3" />
                  expires {new Date(lookup.expires_at).toLocaleDateString()}
                </div>
              )}
            </div>

            {/* QR */}
            <div className="rounded-3xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Scan to redeem in-store</p>
              <div className="mx-auto mt-3 aspect-square w-48 rounded-xl bg-white p-3">
                <QRCode value={code ?? ''} size={160} style={{ width: '100%', height: '100%' }} />
              </div>
            </div>

            {/* Recent activity */}
            <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
              <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                  Recent activity
                </p>
              </div>
              {lookup.history.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-gray-500">No activity yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {lookup.history.slice(0, 10).map((h, i) => {
                    const label = ACTION_LABEL[h.action] ?? h.action;
                    return (
                      <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                        <div>
                          <p className="font-semibold text-gray-800 dark:text-gray-100">{label}</p>
                          <p className="text-[10px] text-gray-500">{formatRelative(h.created_at)}</p>
                        </div>
                        <p className={`font-mono font-semibold ${h.amount > 0 ? 'text-emerald-600' : h.amount < 0 ? 'text-rose-600' : 'text-gray-500'}`}>
                          {h.amount > 0 ? '+' : ''}{h.amount.toLocaleString()}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-[11px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>This is a bearer instrument — anyone with the code can redeem it. Keep it safe.</span>
            </div>
          </>
        ) : (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-900/20">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
            <h2 className="mt-3 text-lg font-bold text-amber-900 dark:text-amber-200">Card not found</h2>
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
              This gift card code is not active. It may be expired, fully used, or invalid.
            </p>
            <p className="mt-3 font-mono text-[10px] text-amber-700 dark:text-amber-300">{code}</p>
            <a href="/pay" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-gray-900">
              Pay with another method
            </a>
          </div>
        )}

        <p className="mt-6 text-center text-[9px] text-gray-400">
          <Mail className="mr-1 inline h-3 w-3" />
          Need help? Contact the merchant who issued this card.
        </p>
      </div>
    </div>
  );
}
