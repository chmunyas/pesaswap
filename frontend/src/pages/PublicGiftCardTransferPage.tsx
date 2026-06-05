/**
 * PublicGiftCardTransferPage — public-route accept-a-gift page.
 *
 * Mounted at /giftcard/transfer/:token (outside ProtectedRoutes). A
 * recipient lands here via the link the sender shares with them.
 *
 * Backed by:
 *   GET  /api/public/giftcards/transfer/:token   — sanitised preview (no balance)
 *   POST /api/public/giftcards/transfer/:token/accept — performs the swap
 *
 * On accept the server rotates the giftcard_number and returns the NEW
 * plaintext code ONCE. The recipient should save it — it's never derivable
 * from the DB again. The old code becomes invalid the instant the swap
 * commits, so the sender's copy stops working.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  Cake,
  CheckCircle2,
  Coffee,
  Cookie,
  Crown,
  Diamond,
  Flower2,
  Gift,
  Heart,
  Music4,
  PartyPopper,
  Pizza,
  Sparkles,
  Star,
  TreePine,
  Trophy,
  Wand2,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { api } from '../lib/api';

interface DesignPreview {
  background_from: string;
  background_to: string;
  text_color: string;
  icon: string | null;
  name: string;
}

interface TransferPreview {
  masked_old_code: string;
  currency: string;
  sender_name: string | null;
  message: string | null;
  to_recipient_name: string | null;
  design: DesignPreview | null;
  expires_at: string | null;
}

interface AcceptResult {
  new_code: string;
  masked_new_code: string;
  balance: number;
  currency: string;
}

const DESIGN_ICONS: Record<string, typeof Gift> = {
  Gift, Sparkles, TreePine, Cake, Star, Heart,
  PartyPopper, Cookie, Flower2, Music4, Coffee, Pizza,
  Award, Crown, Diamond, Trophy, Wand2,
};

function designIcon(name: string | null | undefined): typeof Gift {
  if (!name) return Gift;
  return DESIGN_ICONS[name] ?? Gift;
}

export function PublicGiftCardTransferPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [state, setState] = useState<'pending' | 'accepted' | 'cancelled' | 'expired' | 'not_found' | 'error'>('pending');
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [accepted, setAccepted] = useState<AcceptResult | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    api.giftcards
      .publicTransferLookup(token)
      .then((res) => {
        const data = res.data as Record<string, unknown> | undefined;
        const remoteState = String(data?.state ?? 'pending');
        if (['pending', 'accepted', 'cancelled', 'expired'].includes(remoteState)) {
          setState(remoteState as 'pending' | 'accepted' | 'cancelled' | 'expired');
        } else {
          setState('not_found');
        }
        const p = data?.preview as Record<string, unknown> | null | undefined;
        if (p) {
          setPreview({
            masked_old_code: String(p.masked_old_code ?? ''),
            currency: String(p.currency ?? 'KES'),
            sender_name: (p.sender_name as string | null) ?? null,
            message: (p.message as string | null) ?? null,
            to_recipient_name: (p.to_recipient_name as string | null) ?? null,
            design: p.design && typeof p.design === 'object' ? (p.design as unknown as DesignPreview) : null,
            expires_at: (p.expires_at as string | null) ?? null,
          });
          if (typeof p.to_recipient_name === 'string') setName(p.to_recipient_name);
        }
      })
      .catch(() => setState('not_found'))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name && !email && !phone) {
      setError('Please give your name, email, or phone so we know who accepted the gift.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.giftcards.publicTransferAccept(token, {
        recipient_name: name,
        recipient_email: email,
        recipient_phone: phone,
      });
      const data = res.data as Record<string, unknown> | undefined;
      const ackState = String(data?.state ?? 'accepted');
      if (ackState !== 'accepted') {
        setError('Transfer could not be accepted.');
        setSubmitting(false);
        return;
      }
      setAccepted({
        new_code: String(data?.new_code ?? ''),
        masked_new_code: String(data?.masked_new_code ?? ''),
        balance: Number(data?.balance ?? 0),
        currency: String(data?.currency ?? 'KES'),
      });
      setState('accepted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept transfer.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500" />
      </div>
    );
  }

  if (state === 'not_found') {
    return (
      <PublicShell>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900 dark:bg-rose-900/30">
          <AlertTriangle className="mx-auto h-12 w-12 text-rose-500" />
          <p className="mt-3 text-lg font-semibold text-rose-800 dark:text-rose-200">This gift link is not valid</p>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
            The link may have expired, been cancelled, or already been used. Ask the sender for a fresh link.
          </p>
        </div>
      </PublicShell>
    );
  }

  const Icon = designIcon(preview?.design?.icon ?? null);
  const headerGradient = preview?.design
    ? { backgroundImage: `linear-gradient(135deg, ${preview.design.background_from}, ${preview.design.background_to})` }
    : { backgroundImage: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' };
  const headerTextColor = preview?.design?.text_color ?? '#FFFFFF';

  return (
    <PublicShell>
      {/* Card preview */}
      <div className="overflow-hidden rounded-2xl shadow-lg">
        <div className="flex items-center gap-3 px-6 py-8" style={{ ...headerGradient, color: headerTextColor }}>
          <Icon className="h-9 w-9 opacity-95" />
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-widest opacity-80">{preview?.design?.name ?? 'Gift card'}</p>
            <p className="mt-1 font-mono text-sm font-bold">{preview?.masked_old_code ?? ''}</p>
            <p className="text-xs opacity-90">{preview?.currency ?? 'KES'}</p>
          </div>
        </div>
        {(preview?.sender_name || preview?.message) && (
          <div className="bg-white px-6 py-5 text-sm text-gray-800 dark:bg-gray-800 dark:text-gray-100">
            {preview.sender_name && (
              <p>
                <span className="text-gray-500">From:</span> <span className="font-semibold">{preview.sender_name}</span>
              </p>
            )}
            {preview.message && <p className="mt-2 italic text-gray-700 dark:text-gray-200">“{preview.message}”</p>}
          </div>
        )}
      </div>

      {state === 'accepted' && accepted && (
        <div className="mt-6 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900 dark:bg-emerald-900/30">
          <p className="flex items-center gap-2 text-base font-bold text-emerald-800 dark:text-emerald-200">
            <CheckCircle2 className="h-5 w-5" /> Gift accepted
          </p>
          <p className="text-sm text-emerald-800 dark:text-emerald-200">
            Your new code is below. <strong>Save it now</strong> — for security reasons we never show this code again,
            and the previous code has been invalidated.
          </p>
          <div className="rounded-lg bg-white p-4 text-center dark:bg-gray-900">
            <div className="mx-auto w-fit bg-white p-2">
              <QRCode value={accepted.new_code} size={150} />
            </div>
            <p className="mt-3 font-mono text-lg font-bold text-gray-900 dark:text-white">{accepted.new_code}</p>
            <p className="mt-1 text-xs text-gray-500">Balance: {accepted.currency} {accepted.balance.toLocaleString()}</p>
          </div>
        </div>
      )}

      {state === 'cancelled' && (
        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-5 text-center text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          The sender cancelled this transfer.
        </div>
      )}
      {state === 'expired' && (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-center text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
          This transfer link has expired. Ask the sender for a fresh link.
        </div>
      )}

      {state === 'pending' && (
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Accept this gift</p>
          <p className="text-xs text-gray-500">
            Tell us who's accepting. When you confirm, a brand-new code will be issued to you and the sender's copy will
            stop working.
          </p>
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email (optional)"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Your phone (optional)"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {submitting ? 'Accepting…' : 'Accept gift'}
          </button>
          {preview?.expires_at && (
            <p className="text-center text-[10px] text-gray-500">Link expires {new Date(preview.expires_at).toLocaleString()}</p>
          )}
        </form>
      )}
    </PublicShell>
  );
}

function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 px-4 py-10 dark:from-gray-950 dark:via-gray-900 dark:to-gray-950">
      <div className="mx-auto max-w-md">{children}</div>
    </div>
  );
}
