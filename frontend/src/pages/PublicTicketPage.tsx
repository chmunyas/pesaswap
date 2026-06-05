/**
 * PublicTicketPage — customer-facing ticket viewer at /ticket/:code.
 *
 * The customer scans a QR (which encodes a /ticket/<JWT> URL for staff
 * redemption), OR loads this page directly from a printed/emailed short
 * code. Resolves by the short human code (NOT the JWT — that stays
 * encrypted inside the QR payload to avoid leaking via logs/history).
 *
 * Rendered subtype-aware: meeting shows entrance+zone+map, movie shows
 * film+hall+screening+seat, transport shows origin→destination, scenic
 * shows opening hours+address. Status badge + "Show at gate" instruction.
 *
 * Offline behaviour (rubber-duck #10): if a previous load succeeded the
 * page renders from cache but explicitly marks status as "may be stale".
 * The PWA config sets NetworkOnly on the underlying balance endpoint, so
 * a fresh load while offline will fail — we keep the last successful
 * lookup in localStorage as a defensive cache.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Film,
  MapPin,
  RotateCcw,
  ScanLine,
  Send,
  ShieldCheck,
  Ticket,
  Train,
  Users,
  WifiOff,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { api } from '../lib/api';

type Subtype = 'meeting' | 'scenic' | 'movie' | 'transport';
type Status = 'issued' | 'active' | 'redeemed' | 'refunded' | 'revoked' | 'expired' | 'not_found' | 'inactive';

interface PublicTicket {
  code: string | null;
  status: Status | string;
  valid_from: string | null;
  valid_to: string | null;
  seat: Record<string, unknown> | null;
  redeem_count: number;
  bound: boolean;
  product: {
    subtype: Subtype;
    title: string;
    brand_name: string | null;
    color: string | null;
    notice: string | null;
    code_type: string;
    logo_url: string | null;
    service_phone: string | null;
    description: string | null;
  } | null;
  subtype_info: Record<string, unknown> | null;
  qr_url: string | null;
}

const SUBTYPE_ICON: Record<Subtype, typeof Film> = {
  meeting: Users,
  scenic: MapPin,
  movie: Film,
  transport: Train,
};

const SUBTYPE_LABEL: Record<Subtype, string> = {
  meeting: 'Event',
  scenic: 'Attraction',
  movie: 'Cinema',
  transport: 'Transport',
};

const STATUS_BADGE: Record<string, { label: string; classes: string }> = {
  issued:   { label: 'Ready',     classes: 'bg-blue-500 text-white' },
  active:   { label: 'Active',    classes: 'bg-emerald-500 text-white' },
  redeemed: { label: 'Used',      classes: 'bg-gray-500 text-white' },
  refunded: { label: 'Refunded',  classes: 'bg-amber-500 text-white' },
  revoked:  { label: 'Revoked',   classes: 'bg-rose-500 text-white' },
  expired:  { label: 'Expired',   classes: 'bg-gray-400 text-white' },
  not_found:{ label: 'Not found', classes: 'bg-rose-500 text-white' },
  inactive: { label: 'Inactive',  classes: 'bg-gray-400 text-white' },
};

const CACHE_KEY_PREFIX = 'pesaswap.ticket.cache.';

function loadCachedLookup(code: string): PublicTicket | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY_PREFIX + code);
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j as PublicTicket;
  } catch {
    return null;
  }
}

function saveCachedLookup(code: string, data: PublicTicket): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY_PREFIX + code, JSON.stringify(data));
  } catch {
    /* quota — ignore */
  }
}

export function PublicTicketPage() {
  const { code } = useParams<{ code: string }>();
  const [ticket, setTicket] = useState<PublicTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const go = () => setOnline(navigator.onLine);
    window.addEventListener('online', go);
    window.addEventListener('offline', go);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('offline', go);
    };
  }, []);

  async function load() {
    if (!code) return;
    setLoading(true);
    setError(null);
    setFromCache(false);
    try {
      const res = await api.tickets.publicLookup(code);
      const data = res.data as unknown as PublicTicket | undefined;
      if (!data) {
        setError('Lookup failed.');
        return;
      }
      setTicket(data);
      if (data.product) saveCachedLookup(code, data);
    } catch (err) {
      // Rubber-duck #10: fall back to last-known cache when offline.
      const cached = loadCachedLookup(code);
      if (cached) {
        setTicket(cached);
        setFromCache(true);
      } else {
        setError(err instanceof Error ? err.message : 'Lookup failed');
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [code]);

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-fuchsia-50 to-purple-50 dark:from-gray-950 dark:to-gray-900 p-4"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1rem)' }}
    >
      <div className="mx-auto w-full max-w-sm space-y-5 pt-6">
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-900 text-white px-4 py-2 dark:bg-white dark:text-gray-900">
            <Ticket className="h-4 w-4" />
            <span className="text-sm font-bold font-mono">PESASWAP · Ticket</span>
          </div>
        </div>

        {!online && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <WifiOff className="mr-1 inline h-3 w-3" /> You're offline. Showing last-known data.
          </div>
        )}

        {fromCache && online && (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            Cached copy — status may be stale.
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-3xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-fuchsia-500" />
          </div>
        ) : error ? (
          <ErrorCard onRetry={load} message={error} />
        ) : ticket && ticket.product ? (
          <ValidTicketCard ticket={ticket} code={code ?? ''} />
        ) : (
          <ErrorCard onRetry={load} message="This ticket code is not active." code={code} />
        )}

        <p className="mt-4 text-center text-[9px] text-gray-400">
          <ShieldCheck className="mr-1 inline h-3 w-3" />
          Tickets are signed and verified at the gate. Never share your QR with strangers.
        </p>
      </div>
    </div>
  );
}

function ValidTicketCard({ ticket, code }: { ticket: PublicTicket; code: string }) {
  if (!ticket.product) return null;
  const Icon = SUBTYPE_ICON[ticket.product.subtype] ?? Ticket;
  const status = String(ticket.status);
  const badge = STATUS_BADGE[status] ?? STATUS_BADGE.inactive;
  const accent = ticket.product.color || '#a855f7';

  return (
    <>
      {/* Big card */}
      <div
        className="rounded-3xl p-6 text-white shadow-xl"
        style={{ background: `linear-gradient(135deg, ${accent} 0%, #ec4899 100%)` }}
      >
        <div className="flex items-start justify-between">
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${badge.classes}`}>{badge.label}</span>
          <Icon className="h-5 w-5" />
        </div>
        <h2 className="mt-3 text-2xl font-bold leading-tight">{ticket.product.title}</h2>
        {ticket.product.brand_name && <p className="mt-1 text-sm opacity-90">{ticket.product.brand_name}</p>}

        {ticket.valid_from && ticket.valid_to && (
          <div className="mt-5 flex items-center justify-center gap-1.5 rounded-full bg-white/15 py-1.5 text-[11px] backdrop-blur">
            <Clock className="h-3 w-3" />
            {ticket.valid_from.slice(0, 10)} — {ticket.valid_to.slice(0, 10)}
          </div>
        )}

        <p className="mt-3 text-center font-mono text-xs opacity-80">{code}</p>
      </div>

      {/* Subtype-specific details */}
      {ticket.subtype_info && Object.keys(ticket.subtype_info).length > 1 && (
        <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
            {SUBTYPE_LABEL[ticket.product.subtype]} details
          </p>
          <dl className="mt-2 space-y-1.5 text-xs">
            {Object.entries(ticket.subtype_info).map(([k, v]) => {
              if (k === 'ticket_product_id' || v === null || v === '') return null;
              return (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-gray-500 capitalize">{k.replace(/_/g, ' ')}</dt>
                  <dd className="font-medium text-gray-800 text-right dark:text-gray-100">
                    {String(v).slice(0, 80)}
                  </dd>
                </div>
              );
            })}
            {ticket.seat && Object.keys(ticket.seat).length > 0 && (
              <div className="mt-2 flex justify-between gap-3 border-t border-gray-100 pt-2 dark:border-gray-800">
                <dt className="text-gray-500">Seat</dt>
                <dd className="font-mono font-semibold text-gray-800 dark:text-gray-100">
                  {Object.entries(ticket.seat).map(([k, v]) => `${k}:${v}`).join(' · ')}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* QR for gate scan */}
      <div className="rounded-3xl border border-gray-200 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-900">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Show at the gate</p>
        <div className="mx-auto mt-3 aspect-square w-52 rounded-xl bg-white p-3">
          {ticket.qr_url && <QRCode value={ticket.qr_url} size={180} style={{ width: '100%', height: '100%' }} />}
        </div>
        <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-gray-500">
          <ScanLine className="h-3 w-3" />
          Hold steady while staff scan
        </p>
      </div>

      {ticket.bound && (
        <div className="flex items-start gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-2 text-[11px] text-blue-800 dark:border-blue-900 dark:bg-blue-900/20 dark:text-blue-300">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ID may be requested at the gate to match this ticket holder.
        </div>
      )}

      {ticket.product.notice && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          ⚠ {ticket.product.notice}
        </div>
      )}

      {status === 'redeemed' && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> Already admitted
        </div>
      )}

      <TicketActions ticket={ticket} code={code} />
    </>
  );
}

// ---------- ticket-holder actions (Phase 2: transfer + add to calendar) ----------

function TicketActions({ ticket, code }: { ticket: PublicTicket; code: string }) {
  const [showTransfer, setShowTransfer] = useState(false);
  const status = String(ticket.status);
  const transferable = ticket.product && status !== 'redeemed' && status !== 'revoked' && status !== 'expired' && status !== 'refunded';
  const hasDate = !!(ticket.valid_from || ticket.valid_to);

  function downloadIcs() {
    if (!ticket.product) return;
    const dtFmt = (iso: string | null): string => {
      if (!iso) return '';
      const d = new Date(iso.replace(' ', 'T'));
      if (Number.isNaN(d.getTime())) return '';
      return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    };
    const start = dtFmt(ticket.valid_from);
    const end = dtFmt(ticket.valid_to || ticket.valid_from);
    const title = ticket.product.title;
    const desc = ticket.product.description || ticket.product.notice || '';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Pesaswap//Tickets//EN',
      'BEGIN:VEVENT',
      `UID:${code}@pesaswap`,
      `DTSTAMP:${dtFmt(new Date().toISOString())}`,
      start ? `DTSTART:${start}` : '',
      end ? `DTEND:${end}` : '',
      `SUMMARY:${escapeIcs(title)}`,
      desc ? `DESCRIPTION:${escapeIcs(desc)}` : '',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');
    const blob = new Blob([lines], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${code}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {hasDate && (
          <button
            type="button"
            onClick={downloadIcs}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Add to Calendar
          </button>
        )}
        {transferable && (
          <button
            type="button"
            onClick={() => setShowTransfer(true)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl border border-fuchsia-200 bg-white px-3 py-2 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-gray-900 dark:text-fuchsia-300"
          >
            <Send className="h-3.5 w-3.5" />
            Transfer
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={`/api/public/tickets/${encodeURIComponent(code)}/apple-wallet`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-gray-800"
          title="Download an Apple Wallet pass (requires the merchant to have configured a Pass Type ID certificate)"
        >
          🍎 Add to Apple Wallet
        </a>
        <a
          href={`/api/public/tickets/${encodeURIComponent(code)}/google-wallet`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl bg-white px-3 py-2 text-xs font-semibold text-gray-800 border border-gray-300 hover:bg-gray-50"
          title="Open Google Wallet save URL (requires the merchant to have configured Google Wallet credentials)"
        >
          <span style={{ background: 'linear-gradient(45deg, #4285f4, #34a853, #fbbc05, #ea4335)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 'bold' }}>G</span>
          Add to Google Wallet
        </a>
      </div>

      {showTransfer && <TransferModal code={code} onClose={() => setShowTransfer(false)} />}
    </>
  );
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function TransferModal({ code, onClose }: { code: string; onClose: () => void }) {
  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request');
  const [toEmail, setToEmail] = useState('');
  const [toPhone, setToPhone] = useState('');
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [transferId, setTransferId] = useState<number | null>(null);
  const [inlineToken, setInlineToken] = useState<string | null>(null);
  const [verificationToken, setVerificationToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {};
      if (channel === 'email') payload.to_email = toEmail;
      else payload.to_phone = toPhone;
      const res = await api.tickets.transferRequest(code, payload);
      const data = res.data as Record<string, unknown> | undefined;
      if (!data) throw new Error(res.message || 'Request failed');
      setTransferId(Number(data.transfer_id));
      if (typeof data.verification_token === 'string') setInlineToken(data.verification_token);
      setStep('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (!transferId) return;
    setBusy(true);
    setError(null);
    try {
      await api.tickets.transferConfirm(code, {
        transfer_id: transferId,
        verification_token: verificationToken,
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirm failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Transfer ticket</h3>
            <p className="mt-1 text-[11px] text-gray-500">
              {step === 'request' && 'A verification code will be sent to confirm the new recipient.'}
              {step === 'confirm' && 'Enter the verification code that was sent.'}
              {step === 'done' && 'Transfer complete.'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-900/20 dark:text-rose-300">{error}</div>
        )}

        {step === 'request' && (
          <form onSubmit={handleRequest} className="mt-4 space-y-3">
            <div className="flex gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-700">
              {(['email', 'sms'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannel(c)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold uppercase ${channel === c ? 'bg-fuchsia-600 text-white' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'}`}
                >{c}</button>
              ))}
            </div>
            {channel === 'email' ? (
              <input required type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="recipient@example.com" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
            ) : (
              <input required type="tel" value={toPhone} onChange={(e) => setToPhone(e.target.value)} placeholder="+254712345678" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
            )}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">{busy ? 'Sending…' : 'Send verification code'}</button>
          </form>
        )}

        {step === 'confirm' && (
          <form onSubmit={handleConfirm} className="mt-4 space-y-3">
            {inlineToken && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                Dev mode: verification token returned inline: <strong className="font-mono">{inlineToken}</strong>
              </div>
            )}
            <input required value={verificationToken} onChange={(e) => setVerificationToken(e.target.value.toUpperCase())} placeholder="VERIFICATION CODE" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">{busy ? 'Verifying…' : 'Confirm transfer'}</button>
          </form>
        )}

        {step === 'done' && (
          <div className="mt-4 space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <p className="text-sm font-semibold text-gray-900 dark:text-white">Transfer complete</p>
            <p className="text-[11px] text-gray-500">The ticket has been reassigned. The recipient should access it via the same code.</p>
            <button type="button" onClick={onClose} className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white dark:bg-white dark:text-gray-900">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ErrorCard({ onRetry, message, code }: { onRetry: () => void; message: string; code?: string }) {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-900/20">
      <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" />
      <h2 className="mt-3 text-lg font-bold text-amber-900 dark:text-amber-200">Can't load ticket</h2>
      <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">{message}</p>
      {code && <p className="mt-3 font-mono text-[10px] text-amber-700 dark:text-amber-300">{code}</p>}
      <button onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-bold text-white dark:bg-white dark:text-gray-900">
        <RotateCcw className="h-3.5 w-3.5" /> Try again
      </button>
    </div>
  );
}
