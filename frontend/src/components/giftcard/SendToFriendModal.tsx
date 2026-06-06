/**
 * SendToFriendModal — public OTP-gated re-gift flow on /g/:code.
 *
 * Three stages:
 *   1. Recipient info  → tap "Continue" → fires OTP send to bound phone
 *   2. OTP             → 6-digit input → fires verify+mint
 *   3. Share           → memorable-phrase URL + copy/SMS buttons
 *
 * Requires the card to have an active phone binding (otherwise the
 * backend returns 409 "no linked phone" and we surface that as a
 * friendly explanation pointing back to the merchant).
 */

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Gift,
  MessageCircle,
  Smartphone,
  X as XIcon,
} from 'lucide-react';

interface Props {
  code: string;
  onClose: () => void;
}

type Stage = 'form' | 'otp' | 'share';

export function SendToFriendModal({ code, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [toName, setToName] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [message, setMessage] = useState('');

  // OTP stage
  const [otp, setOtp] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);

  // Share stage
  const [acceptUrl, setAcceptUrl] = useState('');
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);

  // Escape closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function continueToOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/public/giftcards/${encodeURIComponent(code)}/transfer/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.message ?? 'Could not send code.');
        return;
      }
      setMaskedPhone(j.data?.masked_phone ?? '');
      setDemoCode(j.data?.demo_code ?? null);
      setStage('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/public/giftcards/${encodeURIComponent(code)}/transfer/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: otp,
          to_recipient_name: toName,
          to_recipient_phone: toPhone,
          message,
        }),
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.message ?? 'Wrong code.');
        return;
      }
      const fullUrl = window.location.origin + (j.data?.accept_url ?? '/giftcard/transfer/' + (j.data?.verification_token ?? ''));
      setAcceptUrl(fullUrl);
      setToken(j.data?.verification_token ?? '');
      setStage('share');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(acceptUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const smsHref = toPhone
    ? `sms:${toPhone}?body=${encodeURIComponent(`I'm sending you a gift! Open this link to claim it: ${acceptUrl}`)}`
    : `sms:?body=${encodeURIComponent(`I'm sending you a gift! Open this link to claim it: ${acceptUrl}`)}`;
  const waHref = `https://wa.me/${(toPhone || '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(
    `I'm sending you a gift! Open this link to claim it: ${acceptUrl}`,
  )}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-label="Send gift card to a friend"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-pink-500" />
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Send to a friend</h2>
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
          <form onSubmit={continueToOtp} className="space-y-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              We'll send a 6-digit code to your linked phone to confirm.
            </p>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="regift-name">
                Friend's name (optional)
              </label>
              <input
                id="regift-name"
                type="text"
                placeholder="Alice"
                value={toName}
                onChange={(e) => setToName(e.target.value)}
                maxLength={120}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="regift-phone">
                Their phone (optional, helps with SMS)
              </label>
              <input
                id="regift-phone"
                type="tel"
                inputMode="tel"
                placeholder="+254 7XX XXX XXX"
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="regift-msg">
                Message (optional)
              </label>
              <textarea
                id="regift-msg"
                rows={2}
                maxLength={280}
                placeholder="Happy birthday! 🎂"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-900"
            >
              {busy ? 'Sending code…' : 'Continue'}
              <ArrowRight className="h-4 w-4" />
            </button>
            {error && (
              <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </form>
        )}

        {stage === 'otp' && (
          <form onSubmit={confirm} className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
              <Smartphone className="h-4 w-4 shrink-0" />
              <span>
                Code sent to <span className="font-mono font-semibold">{maskedPhone}</span>
              </span>
            </div>
            {demoCode && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
                Dev mode: <span className="font-mono font-bold">{demoCode}</span>
              </div>
            )}
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="regift-otp">
                6-digit code
              </label>
              <input
                id="regift-otp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                placeholder="123456"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                required
                autoFocus
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-center text-2xl font-mono font-bold tracking-[0.4em] dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={busy || otp.length !== 6}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-900"
            >
              {busy ? 'Verifying…' : 'Send gift'}
              <Gift className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setStage('form')}
              className="block w-full text-center text-[11px] text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              ← Change recipient
            </button>
            {error && (
              <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </form>
        )}

        {stage === 'share' && (
          <div className="space-y-4">
            <div className="rounded-2xl bg-gradient-to-br from-pink-500 to-amber-500 p-5 text-center text-white">
              <CheckCircle2 className="mx-auto h-10 w-10" />
              <p className="mt-2 text-sm font-bold">Gift link ready</p>
              {toName && <p className="mt-1 text-xs opacity-90">for {toName}</p>}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              The recipient opens this link to claim. The original code stops working as soon as they accept.
            </p>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Memorable phrase</p>
              <p className="mt-1 break-all font-mono text-sm font-semibold text-gray-900 dark:text-white">{token}</p>
              <p className="mt-2 break-all text-[10px] text-gray-500">{acceptUrl}</p>
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
