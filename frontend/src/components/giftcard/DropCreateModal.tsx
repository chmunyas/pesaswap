/**
 * DropCreateModal — operator-side Gift Drop creation.
 *
 * Cashier picks total amount + slots + distribution + optional message
 * + TTL. Submit hits POST /api/giftcards/:id/drop. On success we show
 * the share URL with Copy / SMS / WhatsApp affordances — same pattern
 * as the send-to-friend modal.
 *
 * The parent card's balance is debited atomically on the server side
 * (the entire dropped amount is frozen on the drop row's
 * amount_remaining and unfrozen — refunded to the parent — on cancel
 * or after cron-driven expiry).
 */

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Gift,
  MessageCircle,
  PartyPopper,
  Users,
  X as XIcon,
} from 'lucide-react';
import { api } from '../../lib/api';

interface Props {
  cardId: number;
  cardBalance: number;
  cardCurrency: string;
  onClose: () => void;
  onCreated?: () => void;
}

type Stage = 'form' | 'share';

interface DropResponse {
  drop_id: number;
  share_token: string;
  share_url: string;
  total_amount: number;
  currency: string;
  slot_count: number;
  distribution: 'equal' | 'random';
  expires_at: string;
}

export function DropCreateModal({ cardId, cardBalance, cardCurrency, onClose, onCreated }: Props) {
  const [stage, setStage] = useState<Stage>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [total, setTotal] = useState(String(Math.min(cardBalance, 1000)));
  const [slots, setSlots] = useState('5');
  const [distribution, setDistribution] = useState<'equal' | 'random'>('random');
  const [message, setMessage] = useState('');
  const [hours, setHours] = useState('24');

  const [result, setResult] = useState<DropResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Escape to close (when not busy + not in success state)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const totalN = Number(total);
    const slotsN = Number(slots);
    if (!Number.isFinite(totalN) || totalN <= 0 || totalN > cardBalance) {
      setError(`Amount must be between ${cardCurrency} 0 and ${cardCurrency} ${cardBalance.toLocaleString()}.`);
      return;
    }
    if (!Number.isFinite(slotsN) || slotsN < 2 || slotsN > 50) {
      setError('Slots must be between 2 and 50.');
      return;
    }

    setBusy(true);
    try {
      const j = await api.giftcards.dropCreate(cardId, {
        slot_count: slotsN,
        distribution,
        total_amount: totalN,
        message,
        expires_in_hours: Number(hours),
      });
      if (!j?.success) {
        setError(j?.message ?? 'Could not create drop.');
        return;
      }
      setResult(j.data as unknown as DropResponse);
      setStage('share');
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  const fullUrl = result ? window.location.origin + result.share_url : '';

  async function copyUrl() {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const sharePayload = result
    ? encodeURIComponent(
        `🎁 I shared a Gift Drop! ${result.currency} ${result.total_amount.toLocaleString()} across ${result.slot_count} slots (${result.distribution}). First to claim wins. ${fullUrl}`,
      )
    : '';
  const smsHref = `sms:?body=${sharePayload}`;
  const waHref = `https://wa.me/?text=${sharePayload}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-label="Create a Gift Drop"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PartyPopper className="h-5 w-5 text-rose-500" />
            <h2 className="text-base font-bold text-gray-900 dark:text-white">
              {stage === 'form' ? 'Create a Gift Drop' : 'Drop is live'}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {stage === 'form' && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Hand out one card to multiple people via a single share link. First N to claim each get a slice.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="drop-total">
                  Total ({cardCurrency})
                </label>
                <input
                  id="drop-total"
                  type="number"
                  min="1"
                  max={cardBalance}
                  step="0.01"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                <p className="mt-1 text-[10px] text-gray-500">
                  of {cardCurrency} {cardBalance.toLocaleString()} available
                </p>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="drop-slots">
                  Slots
                </label>
                <input
                  id="drop-slots"
                  type="number"
                  min="2"
                  max="50"
                  value={slots}
                  onChange={(e) => setSlots(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                <p className="mt-1 text-[10px] text-gray-500">
                  ≈ {(Number(total) / Math.max(1, Number(slots))).toFixed(2)} {cardCurrency}/slot
                </p>
              </div>
            </div>
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Distribution</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDistribution('equal')}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    distribution === 'equal'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
                  }`}
                >
                  ⚖️ Equal split
                </button>
                <button
                  type="button"
                  onClick={() => setDistribution('random')}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    distribution === 'random'
                      ? 'border-rose-500 bg-rose-50 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
                  }`}
                >
                  🎲 Random (hongbao)
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="drop-msg">
                Message (optional)
              </label>
              <textarea
                id="drop-msg"
                rows={2}
                maxLength={280}
                placeholder="Team lunch! 🎉"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="drop-hours">
                Expires in (hours)
              </label>
              <input
                id="drop-hours"
                type="number"
                min="1"
                max="168"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white md:max-w-[12rem]"
              />
              <p className="mt-1 text-[10px] text-gray-500">
                Unclaimed amount refunds to this card after expiry.
              </p>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-500 to-amber-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Creating…' : 'Create drop'}
              <Gift className="h-4 w-4" />
            </button>
            {error && (
              <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </form>
        )}

        {stage === 'share' && result && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-rose-500 via-pink-500 to-amber-500 p-5 text-center text-white">
              <CheckCircle2 className="mx-auto h-10 w-10" />
              <p className="mt-2 text-sm font-bold">
                {result.currency} {result.total_amount.toLocaleString()} across {result.slot_count} slots
              </p>
              <p className="mt-1 text-[11px] opacity-90 inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {result.distribution === 'random' ? 'Random split — luck wins' : 'Equal split'}
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Memorable phrase</p>
              <p className="mt-1 break-all font-mono text-sm font-semibold text-gray-900 dark:text-white">
                {result.share_token}
              </p>
              <p className="mt-2 break-all text-[10px] text-gray-500">{fullUrl}</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={copyUrl}
                className="flex flex-col items-center gap-1 rounded-xl border border-gray-200 bg-white p-3 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <Copy className="h-4 w-4" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <a
                href={smsHref}
                className="flex flex-col items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-900/30 dark:text-blue-200"
              >
                <MessageCircle className="h-4 w-4" />
                SMS
              </a>
              <a
                href={waHref}
                target="_blank"
                rel="noreferrer noopener"
                className="flex flex-col items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
              >
                <Gift className="h-4 w-4" />
                WhatsApp
              </a>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="block w-full rounded-2xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
