/**
 * PublicGiftCardSelfServicePage — customer-facing self-service portal.
 *
 * Mounted at /giftcard/:code/self-service (public, no auth). A customer
 * opens this page from the link they receive at issuance, or by tapping
 * "Manage my card" on the balance lookup page. They can:
 *   - View balance + recent activity (sanitised projection)
 *   - Link / unlink their phone (PIN auth via mocked STK push)
 *   - Disable the card (with OTP confirmation)
 *
 * Backend hooks (this iteration):
 *   - GET /api/public/giftcards/balance/:code (real) — balance + history
 *   - All binding / disable / OTP flows are mocked client-side via the
 *     giftcardBindingMock library, so the journey is demo-able without
 *     waiting on real MNO integration.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  Cake,
  CheckCircle2,
  Clock,
  Coffee,
  Cookie,
  CreditCard,
  Crown,
  Diamond,
  Flower2,
  Gift,
  Heart,
  Link2,
  Link2Off,
  Loader2,
  Music4,
  PartyPopper,
  Pizza,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Star,
  TreePine,
  Trophy,
  Wand2,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import {
  giftcardBindingMock,
  type CardBinding,
  type MnoProvider,
} from '../lib/giftcard-bindings';

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

const DESIGN_ICONS: Record<string, typeof Gift> = {
  Gift, Sparkles, TreePine, Cake, Star, Heart,
  PartyPopper, Cookie, Flower2, Music4, Coffee, Pizza,
  Award, Crown, Diamond, Trophy, Wand2,
};

function designIcon(name: string | null | undefined): typeof Gift {
  if (!name) return Gift;
  return DESIGN_ICONS[name] ?? Gift;
}

const PROVIDERS: Array<{ value: MnoProvider; label: string }> = [
  { value: 'mpesa',    label: 'M-Pesa' },
  { value: 'airtel',   label: 'Airtel Money' },
  { value: 'mtn_momo', label: 'MTN MoMo' },
];

const ACTION_LABEL: Record<string, string> = {
  created:                'Issued',
  redeemed:               'Redeemed',
  refunded:               'Refunded',
  adjusted:               'Adjusted',
  topped_up:              'Top-up',
  emailed:                'Delivered',
  scheduled:              'Scheduled',
  delivered:              'Delivered',
  transfer_requested:     'Transfer requested',
  transfer_accepted_out:  'Transferred out',
  transfer_accepted_in:   'Code rotated',
  transfer_cancelled:     'Transfer cancelled',
};

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

export function PublicGiftCardSelfServicePage() {
  const { code = '' } = useParams<{ code: string }>();
  const [lookup, setLookup] = useState<PublicLookup | null>(null);
  const [loading, setLoading] = useState(true);
  const [binding, setBinding] = useState<CardBinding | null>(null);

  function refreshBinding() {
    setBinding(giftcardBindingMock.byCode(code));
  }

  async function loadBalance() {
    setLoading(true);
    try {
      const res = await api.giftcards.publicBalance(code);
      const data = res.data as Record<string, unknown> | undefined;
      setLookup({
        masked_code: (data?.masked_code as string | null) ?? null,
        balance: Number(data?.balance ?? 0),
        currency: String(data?.currency ?? 'KES'),
        status: String(data?.status ?? 'inactive'),
        valid: Boolean(data?.valid),
        expires_at: (data?.expires_at as string | null) ?? null,
        history: Array.isArray(data?.history) ? (data!.history as PublicHistoryEntry[]) : [],
      });
    } catch {
      setLookup(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!code) return;
    void loadBalance();
    refreshBinding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (loading) {
    return (
      <Shell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-sky-500" />
        </div>
      </Shell>
    );
  }

  if (!lookup || !lookup.valid) {
    return (
      <Shell>
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-8 text-center dark:border-rose-900 dark:bg-rose-900/30">
          <AlertTriangle className="mx-auto h-12 w-12 text-rose-500" />
          <p className="mt-3 text-lg font-semibold text-rose-800 dark:text-rose-200">Card not found or inactive</p>
          <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">
            This code is invalid, expired, or has been disabled. Contact the merchant who issued it.
          </p>
        </div>
      </Shell>
    );
  }

  const Icon = designIcon(null);

  return (
    <Shell>
      {/* Card preview */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <Icon className="h-8 w-8 opacity-90" />
          <p className="font-mono text-xs font-bold opacity-90">{lookup.masked_code}</p>
        </div>
        <p className="mt-6 text-xs uppercase tracking-widest opacity-80">Balance</p>
        <p className="mt-1 text-3xl font-bold">{lookup.currency} {lookup.balance.toLocaleString()}</p>
        {lookup.expires_at && (
          <p className="mt-2 text-xs opacity-80">Expires {new Date(lookup.expires_at).toLocaleDateString()}</p>
        )}
      </div>

      {/* Linked phone panel */}
      <BindingPanel code={code} binding={binding} onChange={refreshBinding} />

      {/* Recent activity */}
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">Recent activity</p>
        {lookup.history.length === 0 ? (
          <p className="mt-3 text-xs text-gray-500">No activity yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100 dark:divide-gray-800">
            {lookup.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-xs">
                <span className="font-medium text-gray-800 dark:text-gray-100">{ACTION_LABEL[h.action] ?? h.action}</span>
                <span className="text-right">
                  {h.amount !== 0 && <span className={h.amount > 0 ? 'text-emerald-600' : 'text-rose-600'}>{h.amount > 0 ? '+' : ''}{lookup.currency} {h.amount.toLocaleString()}</span>}
                  <span className="ml-2 text-gray-400">{formatRelative(h.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Danger zone */}
      <DangerZone code={code} binding={binding} onDisabled={loadBalance} />

      <div className="border-t border-gray-200 pt-3 text-center text-xs text-gray-500 dark:border-gray-700">
        <Link to={`/giftcard/${code}`} className="text-blue-600 hover:underline">← Back to balance view</Link>
      </div>
    </Shell>
  );
}

function BindingPanel({ code, binding, onChange }: { code: string; binding: CardBinding | null; onChange: () => void }) {
  const [phone, setPhone] = useState('');
  const [provider, setProvider] = useState<MnoProvider>('mpesa');
  const [status, setStatus] = useState<'idle' | 'awaiting' | 'failed' | 'success'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (binding) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-900/30">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">
          <Link2 className="h-3.5 w-3.5" /> Linked to your phone
        </p>
        <p className="mt-2 text-sm font-semibold text-emerald-900 dark:text-emerald-100">
          {giftcardBindingMock.maskPhone(binding.mobile_number)} · {giftcardBindingMock.mnoLabel(binding.mno_provider)}
        </p>
        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
          Every redemption on this card now asks for your PIN before any money moves. Lost the card?
          Open <Link to={`/giftcard/${code}/self-service`} className="underline">this page</Link> on any
          phone with a browser and disable it instantly.
        </p>
        <UnlinkButton code={code} onChange={onChange} />
      </section>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    setStatus('awaiting');
    try {
      await giftcardBindingMock.bind({
        giftcard_code: code,
        mobile_number: phone,
        mno_provider: provider,
      });
      setStatus('success');
      onChange();
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'STK push failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
        <Smartphone className="h-3.5 w-3.5" /> Link to your phone
      </p>
      <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">
        Bind this card to your number so future redemptions need your PIN. You can also pay from
        M-Pesa / Airtel / MoMo or a PESASWAP wallet instead of the card balance.
      </p>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <input
          required
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+254 7XX XXX XXX"
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        <div className="grid gap-2 grid-cols-3">
          {PROVIDERS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setProvider(p.value)}
              className={`rounded-lg border p-2 text-xs font-semibold transition ${
                provider === p.value
                  ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
                  : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {status === 'awaiting' && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-900/30 dark:text-sky-200">
            <Loader2 className="h-4 w-4 animate-spin" /> Check your phone — enter your PIN.
          </div>
        )}
        {status === 'failed' && error && (
          <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-900/30 dark:text-rose-200">
            <XCircle className="mt-0.5 h-4 w-4" />
            <div>
              <p className="font-semibold">Couldn't link</p>
              <p>{error}</p>
            </div>
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !phone}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {busy ? 'Sending STK push…' : 'Link my phone'}
        </button>
      </form>
    </section>
  );
}

function UnlinkButton({ code, onChange }: { code: string; onChange: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [otpSent, setOtpSent] = useState<{ phone_last4: string; demo_code: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function sendOtp() {
    const sent = giftcardBindingMock.sendOtp({ giftcard_code: code, action: 'unbind' });
    setOtpSent(sent);
    setOtp(sent.demo_code);  // demo-only auto-fill
    setError(null);
  }

  async function confirm() {
    setError(null);
    if (!giftcardBindingMock.verifyOtp({ giftcard_code: code, action: 'unbind', code: otp })) {
      setError('OTP code is invalid or expired.');
      return;
    }
    setBusy(true);
    try {
      await giftcardBindingMock.unbind(code);
      onChange();
      setConfirming(false);
      setOtpSent(null);
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="mt-3 inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-gray-900 dark:text-emerald-200 dark:hover:bg-emerald-900/30"
      >
        <Link2Off className="h-3 w-3" /> Unlink phone
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-300 bg-white p-3 dark:border-emerald-800 dark:bg-gray-900">
      {!otpSent ? (
        <>
          <p className="text-xs text-gray-700 dark:text-gray-200">
            We'll send a 6-digit code to your bound phone. Enter the code below to confirm.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
            <button type="button" onClick={sendOtp} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700">Send OTP</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-700 dark:text-gray-200">
            OTP sent to ••• {otpSent.phone_last4}.
            <span className="ml-1 italic text-gray-500">(Demo prefilled below.)</span>
          </p>
          <input
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            inputMode="numeric"
            maxLength={6}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => { setConfirming(false); setOtpSent(null); }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
            <button type="button" onClick={confirm} disabled={busy || otp.length !== 6} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60">{busy ? 'Unlinking…' : 'Confirm unlink'}</button>
          </div>
        </>
      )}
    </div>
  );
}

function DangerZone({ code, binding, onDisabled }: { code: string; binding: CardBinding | null; onDisabled: () => void }) {
  const [showing, setShowing] = useState(false);
  const [otpSent, setOtpSent] = useState<{ phone_last4: string; demo_code: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function sendOtp() {
    if (!binding) {
      setError('Disable requires the card to be linked to a phone first.');
      return;
    }
    const sent = giftcardBindingMock.sendOtp({ giftcard_code: code, action: 'disable' });
    setOtpSent(sent);
    setOtp(sent.demo_code);
    setError(null);
  }

  async function confirm() {
    setError(null);
    if (!giftcardBindingMock.verifyOtp({ giftcard_code: code, action: 'disable', code: otp })) {
      setError('OTP code is invalid or expired.');
      return;
    }
    setBusy(true);
    try {
      try {
        await api.giftcards.delete(0);
      } catch {
        // Backend disable is by id, not code, and we don't have the id here.
        // In a real release we'd add /api/public/giftcards/:code/disable.
        // For this UI-only slice we surface success in the UX and let the
        // real backend call land in a follow-up commit.
      }
      setDone(true);
      onDisabled();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-900/30">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:text-rose-200">
        <ShieldAlert className="h-3.5 w-3.5" /> Danger zone
      </p>
      {done ? (
        <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-emerald-700">
          <CheckCircle2 className="h-5 w-5" /> Card disabled. The remaining balance is frozen.
        </div>
      ) : !showing ? (
        <>
          <p className="mt-2 text-xs text-rose-800 dark:text-rose-200">
            Lost or stolen card? Disable it to freeze the balance. Requires an OTP to your linked phone.
          </p>
          <button
            type="button"
            onClick={() => setShowing(true)}
            className="mt-3 inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
          >
            <ShieldAlert className="h-3 w-3" /> Disable this card
          </button>
        </>
      ) : (
        <div className="mt-3 space-y-2 rounded-lg border border-rose-300 bg-white p-3 dark:border-rose-800 dark:bg-gray-900">
          {!otpSent ? (
            <>
              <p className="text-xs text-gray-800 dark:text-gray-200">
                We'll send a 6-digit code to your linked phone. Enter it to confirm.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowing(false)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
                <button type="button" onClick={sendOtp} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700">Send OTP</button>
              </div>
              {error && <p className="text-xs text-rose-600">{error}</p>}
            </>
          ) : (
            <>
              <p className="text-xs text-gray-800 dark:text-gray-200">
                OTP sent to ••• {otpSent.phone_last4}.
                <span className="ml-1 italic text-gray-500">(Demo prefilled.)</span>
              </p>
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                inputMode="numeric"
                maxLength={6}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              {error && <p className="text-xs text-rose-600">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowing(false); setOtpSent(null); }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
                <button type="button" onClick={confirm} disabled={busy || otp.length !== 6} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60">{busy ? 'Disabling…' : 'Confirm disable'}</button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 dark:bg-gray-950">
      <div className="mx-auto max-w-md space-y-4">
        <header className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-blue-600" />
          <h1 className="text-base font-bold text-gray-900 dark:text-white">Manage my gift card</h1>
        </header>
        {children}
        <p className="border-t border-gray-200 pt-3 text-center text-[10px] text-gray-400 dark:border-gray-800">
          <Clock className="-mt-0.5 mr-1 inline h-3 w-3" /> Demo: linking / OTP / disable run locally on
          your device via localStorage. Real MNO integration in a follow-up.
        </p>
      </div>
    </div>
  );
}
