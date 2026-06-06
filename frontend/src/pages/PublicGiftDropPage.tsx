/**
 * PublicGiftDropPage — recipient-facing claim page for a Gift Drop.
 *
 * Mounted at /gd/:token. A sender shared the URL; we show the
 * drop info (total, slots, claims so far, sender message), let the
 * recipient claim a slot, and on success show their slice + a link
 * to the freshly-minted gift card.
 *
 * Server enforces atomicity (FOR UPDATE on the drop row), idempotency
 * (claimer_phone), and distribution math (equal/random) — frontend
 * just renders.
 */

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Gift,
  PartyPopper,
  Users,
} from 'lucide-react';

interface Claim {
  slot_index: number;
  claimed_amount: number;
  claimer_name: string | null;
  claimed_at: string;
}

interface DropLookup {
  drop_id: number;
  total_amount: number;
  amount_remaining: number;
  currency: string;
  slot_count: number;
  slots_claimed: number;
  distribution: 'equal' | 'random';
  message: string | null;
  expires_at: string;
  status: 'active' | 'expired' | 'exhausted' | 'cancelled';
  claims: Claim[];
}

interface ClaimResult {
  claim_id: number;
  claimed_amount: number;
  currency: string;
  giftcard_number: string;
  balance_url: string;
  idempotent: boolean;
}

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return iso;
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    return Math.floor(diff / 3600) + 'h ago';
  } catch {
    return iso;
  }
}

export function PublicGiftDropPage() {
  const { token } = useParams<{ token: string }>();
  const [drop, setDrop] = useState<DropLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);

  async function load() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/public/giftcards/drop/${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!j?.success) {
        setError(j?.message ?? 'Drop not found.');
        return;
      }
      setDrop(j.data as DropLookup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function claim() {
    if (!token) return;
    setError(null);
    setClaiming(true);
    try {
      const r = await fetch(`/api/public/giftcards/drop/${encodeURIComponent(token)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimer_name: name, claimer_phone: phone }),
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.message ?? 'Failed to claim.');
        return;
      }
      setResult(j.data as ClaimResult);
      // Refresh the drop so the new claim appears in the timeline.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setClaiming(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-rose-50 to-amber-50 dark:from-rose-950/40 dark:to-amber-950/30">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-rose-500" />
      </div>
    );
  }

  if (error && !drop) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
        <div className="max-w-sm rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900 dark:bg-rose-900/20">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
          <p className="mt-3 text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>
          <p className="mt-2 font-mono text-[10px] text-rose-600 dark:text-rose-400">{token}</p>
        </div>
      </div>
    );
  }

  if (!drop) return null;

  const isActive = drop.status === 'active';
  const slotsLeft = drop.slot_count - drop.slots_claimed;

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-rose-50 via-amber-50 to-emerald-50 dark:from-rose-950/40 dark:via-amber-950/30 dark:to-emerald-950/40 p-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
    >
      <div className="mx-auto w-full max-w-sm space-y-5 pt-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-500 to-amber-500 text-white px-4 py-2 shadow-lg">
            <PartyPopper className="h-4 w-4" />
            <span className="text-sm font-bold font-mono">Gift Drop</span>
          </div>
        </div>

        {/* Hero card */}
        <div className="rounded-3xl bg-gradient-to-br from-rose-500 via-pink-500 to-amber-500 p-6 text-white shadow-2xl">
          <div className="flex items-center justify-between">
            <Gift className="h-6 w-6 opacity-80" />
            <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur">
              <Users className="h-3 w-3" />
              {drop.slot_count} slots
            </div>
          </div>
          <div className="mt-6 text-center">
            <p className="text-[10px] font-mono uppercase tracking-widest opacity-70">Total</p>
            <p className="mt-1 text-4xl font-bold font-mono">{drop.currency} {drop.total_amount.toLocaleString()}</p>
            <p className="mt-2 text-xs opacity-90">
              {drop.distribution === 'random' ? 'Random distribution — luck of the draw' : 'Equal split — each slot identical'}
            </p>
          </div>
          {drop.message && (
            <div className="mt-5 rounded-xl bg-white/15 p-3 text-center text-sm italic backdrop-blur">
              &ldquo;{drop.message}&rdquo;
            </div>
          )}
          <div className="mt-5 flex items-center justify-between text-[10px]">
            <span className="opacity-70">
              <Clock className="mr-1 inline h-3 w-3" />
              expires {new Date(drop.expires_at).toLocaleString()}
            </span>
            <span className="font-semibold">
              {drop.slots_claimed}/{drop.slot_count} claimed
            </span>
          </div>
          <div className="mt-2 h-1 rounded-full bg-white/20">
            <div
              className="h-1 rounded-full bg-white"
              style={{ width: `${(drop.slots_claimed / drop.slot_count) * 100}%` }}
            />
          </div>
        </div>

        {/* Claim result (post-success) */}
        {result && (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-900 dark:bg-emerald-900/30">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-3 text-xs font-mono uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
              You got
            </p>
            <p className="mt-1 text-3xl font-bold font-mono text-emerald-800 dark:text-emerald-100">
              {result.currency} {result.claimed_amount.toLocaleString()}
            </p>
            {result.idempotent && (
              <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                (already claimed earlier — same card)
              </p>
            )}
            <Link
              to={result.balance_url}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-gray-900 px-5 py-2.5 text-sm font-bold text-white dark:bg-white dark:text-gray-900"
            >
              Open my gift
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        )}

        {/* Claim form (active, not yet claimed) */}
        {!result && isActive && slotsLeft > 0 && (
          <div className="space-y-3 rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              <span className="font-semibold text-gray-700 dark:text-gray-200">{slotsLeft}</span>{' '}
              slot{slotsLeft === 1 ? '' : 's'} left. Tap to claim before they're gone.
            </p>
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              type="tel"
              inputMode="tel"
              placeholder="Phone (optional, prevents accidental double-claim)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <button
              type="button"
              onClick={claim}
              disabled={claiming}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-amber-500 px-4 py-3 text-base font-bold text-white shadow-lg hover:opacity-90 disabled:opacity-60"
            >
              {claiming ? 'Claiming…' : 'Claim my slot 🎁'}
            </button>
            {error && (
              <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>
        )}

        {/* Sold-out / expired / cancelled */}
        {!result && !isActive && (
          <div className="rounded-3xl border border-gray-200 bg-white p-5 text-center dark:border-gray-700 dark:bg-gray-900">
            {drop.status === 'exhausted' && (
              <>
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">All slots claimed</p>
                <p className="mt-1 text-xs text-gray-500">Too late this time — keep an eye on the next drop.</p>
              </>
            )}
            {drop.status === 'expired' && (
              <>
                <p className="text-sm font-semibold text-amber-700">This drop has expired</p>
                <p className="mt-1 text-xs text-gray-500">
                  Unclaimed funds refund to the sender after the cron sweep.
                </p>
              </>
            )}
            {drop.status === 'cancelled' && (
              <>
                <p className="text-sm font-semibold text-rose-700">This drop was cancelled</p>
                <p className="mt-1 text-xs text-gray-500">Funds returned to the sender.</p>
              </>
            )}
          </div>
        )}

        {/* Claim feed */}
        {drop.claims.length > 0 && (
          <div className="rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
                Who's claimed so far
              </p>
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {drop.claims.map((c) => (
                <li key={c.slot_index} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-gray-800 dark:text-gray-100">
                      {c.claimer_name ?? 'Anonymous'}
                    </p>
                    <p className="text-[10px] text-gray-500">{formatRelative(c.claimed_at)}</p>
                  </div>
                  <p className="font-mono font-semibold text-emerald-600">
                    +{c.claimed_amount.toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-6 text-center text-[9px] text-gray-400">
          PESASWAP Gift Drop · one share link · first {drop.slot_count} to claim get a slice
        </p>
      </div>
    </div>
  );
}
