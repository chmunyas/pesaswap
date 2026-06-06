/**
 * PublicGiftCardWelcomePage — the recipient ceremony.
 *
 * Mounted at /g/:code/welcome (and /giftcard/:code/welcome as an alias).
 * A recipient lands here from an SMS / email / chat link. We give them a
 * 1.5-second gradient reveal + payment chime + sender's personal message,
 * then surface a "Keep it" CTA that routes to /g/:code (balance + manage).
 *
 * This is the WeChat hongbao moment translated into gift cards. Every
 * other UX in the system is utility; this one is ceremony.
 *
 * Design notes:
 *   - Auto-plays the chime on mount once the user gesture requirement is
 *     satisfied (we attempt on mount but tolerate failure — Safari requires
 *     interaction to unlock audio).
 *   - The "Keep it" button is the only path forward. We don't expose
 *     redeem / transfer / disable here — those live on /g/:code where the
 *     recipient has had a moment to read the gift.
 *   - The card preview mirrors the colour of the issued design when one
 *     is set; otherwise we use the brand emerald gradient.
 *   - The animation runs once per pageload. Subsequent visits to /welcome
 *     replay it — by design — because we expect the link to be opened once.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Gift, ShieldCheck, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { playNotificationSound } from '../lib/realtime';

interface PublicLookup {
  masked_code: string | null;
  balance: number;
  currency: string;
  status: string;
  valid: boolean;
  recipient_name?: string | null;
  sender_name?: string | null;
  message?: string | null;
}

export function PublicGiftCardWelcomePage() {
  const { code } = useParams<{ code: string }>();
  const [lookup, setLookup] = useState<PublicLookup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<'envelope' | 'reveal' | 'rest'>('envelope');

  useEffect(() => {
    let cancelled = false;
    if (!code) return;
    async function load() {
      try {
        const res = await api.giftcards.publicBalance(code!);
        const d = res.data as unknown as PublicLookup | undefined;
        if (cancelled || !d) return;
        // Guard: don't play the ceremony for expired, used, or invalid
        // cards. Falling into the friendly error state is better than
        // celebrating something the recipient can't actually spend.
        if (!d.valid) {
          setError('This gift card is no longer active. It may have expired, been used, or been disabled.');
          return;
        }
        setLookup(d);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Lookup failed');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Ceremony timer — runs once the lookup confirms a valid card. If the
  // load is still pending we wait; if it fails (`error` set) we never
  // start. This avoids the chime + reveal animating over an empty card.
  useEffect(() => {
    if (!lookup || error) return;
    const t1 = setTimeout(() => {
      setStage('reveal');
      // Best-effort audio. Modern Safari requires a user gesture so this
      // may silently fail; that's fine, the visual carries the moment.
      try {
        playNotificationSound('payment');
      } catch {
        /* ignore */
      }
    }, 250);
    const t2 = setTimeout(() => setStage('rest'), 1750);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [lookup, error]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
        <div className="max-w-sm rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center dark:border-rose-900 dark:bg-rose-900/20">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
          <p className="mt-3 text-sm font-semibold text-rose-700 dark:text-rose-300">{error}</p>
          <p className="mt-2 font-mono text-[10px] text-rose-600 dark:text-rose-400">{code}</p>
        </div>
      </div>
    );
  }

  const senderName = lookup?.sender_name?.trim() || 'Someone';
  const recipientName = lookup?.recipient_name?.trim();
  const personalMessage = lookup?.message?.trim();

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-rose-50 via-amber-50 to-emerald-50 dark:from-rose-950/40 dark:via-amber-950/30 dark:to-emerald-950/40">
      {/* Floating sparkles backdrop — purely decorative. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40">
        <Sparkles className="absolute top-[12%] left-[15%] h-4 w-4 animate-pulse text-amber-400" />
        <Sparkles className="absolute top-[28%] right-[10%] h-5 w-5 animate-pulse text-rose-400" />
        <Sparkles className="absolute top-[55%] left-[8%] h-3 w-3 animate-pulse text-emerald-400" />
        <Sparkles className="absolute top-[72%] right-[18%] h-4 w-4 animate-pulse text-pink-400" />
        <Sparkles className="absolute top-[40%] left-[45%] h-3 w-3 animate-pulse text-amber-300" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-5 py-10">
        {/* Envelope — pre-reveal moment. */}
        <div
          className={`transition-all duration-700 ease-out ${
            stage === 'envelope' ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-[-30px] opacity-0 scale-95'
          }`}
        >
          <div className="rounded-3xl bg-gradient-to-br from-rose-500 via-pink-500 to-amber-500 p-12 shadow-2xl">
            <Gift className="h-20 w-20 text-white" strokeWidth={1.5} />
          </div>
          <p className="mt-6 text-center text-xs font-semibold uppercase tracking-widest text-gray-500">
            A gift for you
          </p>
        </div>

        {/* Card reveal — the big moment. */}
        {stage !== 'envelope' && (
          <div
            className={`w-full transition-all duration-1000 ease-out ${
              stage === 'reveal'
                ? 'translate-y-0 opacity-100 scale-100'
                : 'translate-y-0 opacity-100 scale-100'
            }`}
            style={{
              animation: stage === 'reveal' ? 'gift-card-reveal 1.5s cubic-bezier(0.16, 1, 0.3, 1)' : undefined,
            }}
          >
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-700 p-8 text-white shadow-2xl">
              <div className="absolute inset-0 opacity-20" style={{
                backgroundImage:
                  'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.3) 0%, transparent 40%)',
              }} />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <Gift className="h-6 w-6 opacity-80" />
                  <span className="text-[10px] font-mono uppercase tracking-widest opacity-70">PESASWAP</span>
                </div>
                <div className="mt-8 text-center">
                  {recipientName && (
                    <p className="text-sm font-light opacity-90">Dear {recipientName},</p>
                  )}
                  <p className="mt-3 text-[11px] font-mono uppercase tracking-widest opacity-70">You received</p>
                  <p className="mt-1 text-5xl font-bold font-mono">
                    {lookup?.currency || 'KES'} {(lookup?.balance ?? 0).toLocaleString()}
                  </p>
                  <p className="mt-3 text-sm opacity-90">
                    from <span className="font-semibold">{senderName}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Personal message — appears once the card has settled. */}
            {personalMessage && stage === 'rest' && (
              <div className="mt-5 animate-fade-in rounded-3xl border border-amber-200 bg-amber-50 p-5 text-center text-sm italic text-amber-900 dark:border-amber-900 dark:bg-amber-900/30 dark:text-amber-100">
                <span className="text-2xl text-amber-500">&ldquo;</span>
                {personalMessage}
                <span className="text-2xl text-amber-500">&rdquo;</span>
              </div>
            )}

            {/* Keep-it CTA — only enabled at rest so the user can't blast
                through the ceremony. */}
            <Link
              to={`/g/${code}`}
              className={`mt-6 flex items-center justify-center gap-2 rounded-full bg-gray-900 px-6 py-4 text-base font-bold text-white shadow-lg transition-all dark:bg-white dark:text-gray-900 ${
                stage === 'rest' ? 'opacity-100' : 'pointer-events-none opacity-30'
              }`}
            >
              Keep it
              <ArrowRight className="h-5 w-5" />
            </Link>

            <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[10px] text-gray-500">
              <ShieldCheck className="h-3 w-3" />
              Your gift is safe. Link your phone for one-tap redemption.
            </p>
          </div>
        )}
      </div>

      {/* Inline keyframes — Tailwind 4 doesn't ship these by default and we
          don't want a global stylesheet churn for one animation. */}
      <style>{`
        @keyframes gift-card-reveal {
          0%   { transform: translateY(40px) scale(0.85) rotate(-3deg); opacity: 0; }
          50%  { transform: translateY(-8px) scale(1.04) rotate(1deg);  opacity: 1; }
          100% { transform: translateY(0)    scale(1)    rotate(0);     opacity: 1; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in { animation: fade-in 0.5s ease-out; }
      `}</style>
    </div>
  );
}
