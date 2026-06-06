/**
 * MyGiftsPage — public OTP-gated roll-up of cards bound to a phone.
 *
 * Mounted at /my-gifts (no auth). The recipient types their phone,
 * receives an SMS OTP, enters it, and sees every active card bound to
 * that number with a one-tap link to /g/:code for each.
 *
 * Auth model:
 *   - The phone is the bearer credential. We never trust a phone alone —
 *     possession of the OTP proves the holder can read SMS to that
 *     number. The server caches sha256(phone) → sha256(otp) with a 5min
 *     TTL and a 5-attempt counter (see GiftcardsController:: publicSendOtpByPhone).
 *   - We deliberately return a successful 200 with an empty list when
 *     no cards are bound, so the endpoint isn't an oracle for "does this
 *     phone have any cards?"
 *   - Once verified, each card row includes its full code so we can
 *     deep-link to /g/:code without a second round-trip — safe because
 *     the caller has proven phone ownership and could redeem the cards
 *     anyway.
 *
 * UX:
 *   - 3-stage form: phone → OTP → list
 *   - Phone-prefill from ?phone=… query string (welcome page can link
 *     here with the recipient's phone pre-filled)
 *   - "Resend code" link after 30 seconds
 *   - Each card uses the same gradient design as /g/:code
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Clock, Gift, RotateCcw, Smartphone } from 'lucide-react';
import { giftcardDisplayName } from '../lib/giftcard-name';

interface MyGiftCard {
  masked_code: string;
  giftcard_number: string;
  balance: number;
  initial_value: number;
  currency: string;
  expires_at: string | null;
  recipient_name: string | null;
  sender_name: string | null;
  message: string | null;
  created_at: string | null;
  mno_provider: string;
}

interface ListResponse {
  masked_phone: string;
  cards: MyGiftCard[];
  total: number;
}

type Stage = 'phone' | 'otp' | 'list' | 'empty';

export function MyGiftsPage() {
  const [params] = useSearchParams();
  const prefillPhone = params.get('phone') ?? '';

  const [stage, setStage] = useState<Stage>('phone');
  const [phone, setPhone] = useState(prefillPhone);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [cards, setCards] = useState<MyGiftCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number>(0);

  // 30s cooldown for resend
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const resendAvailable = sentAt > 0 && now - sentAt >= 30_000;
  const resendInSeconds = useMemo(() => Math.max(0, 30 - Math.floor((now - sentAt) / 1000)), [now, sentAt]);

  async function sendOtp(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/public/giftcards/by-phone/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.message ?? 'Failed to send code.');
        return;
      }
      setMaskedPhone(j.data?.masked_phone ?? '');
      setDemoCode(j.data?.demo_code ?? null);
      setSentAt(Date.now());
      setStage('otp');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await fetch('/api/public/giftcards/by-phone/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: otp }),
      });
      const j = await r.json();
      if (!j?.success) {
        setError(j?.message ?? 'Wrong code.');
        return;
      }
      const data = j.data as ListResponse;
      setCards(data.cards);
      setStage(data.total === 0 ? 'empty' : 'list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-950 dark:to-gray-900 p-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
    >
      <div className="mx-auto w-full max-w-sm space-y-5 pt-8">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-900 text-white px-4 py-2 dark:bg-white dark:text-gray-900">
            <Gift className="h-4 w-4" />
            <span className="text-sm font-bold font-mono">My Gifts</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            All your PESASWAP gift cards, linked to your phone.
          </p>
        </div>

        {stage === 'phone' && (
          <form
            onSubmit={sendOtp}
            className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="my-gifts-phone">
                Your phone
              </label>
              <input
                id="my-gifts-phone"
                type="tel"
                inputMode="tel"
                placeholder="+254 7XX XXX XXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoFocus
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-base dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              <p className="mt-1 text-[10px] text-gray-500">
                We'll send a 6-digit code by SMS.
              </p>
            </div>
            <button
              type="submit"
              disabled={busy || !phone.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-gray-800 disabled:opacity-60 dark:bg-white dark:text-gray-900"
            >
              {busy ? 'Sending…' : 'Send code'}
              <ArrowRight className="h-4 w-4" />
            </button>
            {error && (
              <p className="flex items-center gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="h-3 w-3" /> {error}
              </p>
            )}
          </form>
        )}

        {stage === 'otp' && (
          <form
            onSubmit={verify}
            className="space-y-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          >
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
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="my-gifts-otp">
                6-digit code
              </label>
              <input
                id="my-gifts-otp"
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
              {busy ? 'Verifying…' : 'View my gifts'}
              <ArrowRight className="h-4 w-4" />
            </button>
            <div className="flex items-center justify-between text-[11px]">
              <button
                type="button"
                onClick={() => setStage('phone')}
                className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
              >
                ← Change phone
              </button>
              <button
                type="button"
                disabled={busy || !resendAvailable}
                onClick={() => sendOtp()}
                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 disabled:text-gray-400"
              >
                <RotateCcw className="h-3 w-3" />
                {resendAvailable ? 'Resend code' : `Resend in ${resendInSeconds}s`}
              </button>
            </div>
            {error && (
              <p className="flex items-center gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="h-3 w-3" /> {error}
              </p>
            )}
          </form>
        )}

        {stage === 'list' && (
          <>
            <p className="text-center text-xs text-gray-500">
              <span className="font-semibold text-gray-700 dark:text-gray-200">{cards.length}</span>{' '}
              {cards.length === 1 ? 'gift card' : 'gift cards'} linked to{' '}
              <span className="font-mono font-semibold">{maskedPhone}</span>
            </p>
            <ul className="space-y-3">
              {cards.map((c) => (
                <li key={c.giftcard_number}>
                  <Link
                    to={`/g/${c.giftcard_number}`}
                    className="block rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-5 text-white shadow-xl transition active:scale-[0.99]"
                  >
                    <div className="flex items-center justify-between">
                      <Gift className="h-5 w-5 opacity-80" />
                      <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">{c.mno_provider.toUpperCase()}</span>
                    </div>
                    <p className="mt-3 text-sm opacity-90">
                      {giftcardDisplayName({
                        sender: c.sender_name,
                        recipient: c.recipient_name,
                        value: c.initial_value,
                        currency: c.currency,
                        date: c.created_at,
                      })}
                    </p>
                    <p className="mt-3 text-[10px] font-mono uppercase tracking-widest opacity-70">Balance</p>
                    <p className="text-3xl font-bold font-mono">{c.currency} {c.balance.toLocaleString()}</p>
                    <div className="mt-3 flex items-center justify-between text-[10px]">
                      <span className="font-mono opacity-70">{c.masked_code}</span>
                      {c.expires_at && (
                        <span className="inline-flex items-center gap-1 opacity-70">
                          <Clock className="h-3 w-3" />
                          {new Date(c.expires_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}

        {stage === 'empty' && (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-900/20">
            <Gift className="mx-auto h-10 w-10 text-amber-500" />
            <h2 className="mt-3 text-lg font-bold text-amber-900 dark:text-amber-200">No gift cards yet</h2>
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">
              No PESASWAP gift cards are linked to{' '}
              <span className="font-mono font-semibold">{maskedPhone}</span>.
              When someone sends you a gift, it will appear here.
            </p>
            <button
              type="button"
              onClick={() => setStage('phone')}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-gray-900"
            >
              ← Try a different phone
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-[9px] text-gray-400">
          Phone-OTP verification · 5-minute code · 5-attempt limit
        </p>
      </div>
    </div>
  );
}
