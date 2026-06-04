/**
 * GiftCardsPage — full lifecycle gift card management.
 *
 * Combines the best of:
 *   - Maho Commerce: status (active/used/expired/disabled), initial vs current
 *     balance, recipient/sender/message, expires_at, full audit history.
 *   - WeChat: gift-to-friend with personalised message + recipient email.
 *   - PESASWAP: MNO top-up via M-Pesa / Airtel Money / MTN MoMo (mock STK),
 *     public balance lookup, mobile-first detail modal.
 *
 * The page itself shows: stats strip (outstanding liability, active count,
 * expiring-soon, used count) + filter chips + search + create button +
 * card grid. Each card opens a detail modal with the QR code, full audit
 * history timeline, and action buttons (Redeem / Top-up / Refund / Adjust /
 * Resend email / Delete).
 */

import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CreditCard,
  Mail,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X as XIcon,
  Zap,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';
import { playNotificationSound } from '../lib/realtime';

type Status = 'active' | 'used' | 'expired' | 'disabled';

interface HistoryEntry {
  history_id: number;
  action: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  provider: string | null;
  reference: string | null;
  transaction_id: string | null;
  txn_status: string;
  order_id: number | null;
  user_id: number | null;
  comment: string | null;
  created_at: string;
}

interface GiftCard {
  giftcard_id: number;
  giftcard_number: string;
  masked_code: string;
  value: number;
  initial_value: number;
  status: Status;
  recipient_name: string | null;
  recipient_email: string | null;
  sender_name: string | null;
  sender_email: string | null;
  message: string | null;
  currency: string;
  expires_at: string | null;
  email_status: string;
  email_sent_at: string | null;
  is_expired: boolean;
  remaining_pct: number;
  days_to_expiry: number | null;
  updated_at: string;
}

interface Stats {
  total_outstanding: number;
  active_count: number;
  expiring_soon_count: number;
  used_count: number;
}

type Provider = 'mpesa' | 'airtel' | 'mtn_momo' | 'cash' | 'card' | 'bank';

const PROVIDER_LABELS: Record<Provider, string> = {
  mpesa: 'M-Pesa STK push',
  airtel: 'Airtel Money',
  mtn_momo: 'MTN MoMo',
  cash: 'Cash',
  card: 'Card',
  bank: 'Bank transfer',
};

const STATUS_STYLE: Record<Status, { badge: string; label: string }> = {
  active:   { badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', label: 'Active' },
  used:     { badge: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300', label: 'Used' },
  expired:  { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', label: 'Expired' },
  disabled: { badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', label: 'Disabled' },
};

const ACTION_ICON: Record<string, { icon: typeof Plus; color: string }> = {
  created:   { icon: Plus, color: 'text-emerald-600' },
  redeemed:  { icon: TrendingDown, color: 'text-rose-600' },
  refunded:  { icon: TrendingUp, color: 'text-emerald-600' },
  adjusted:  { icon: Pencil, color: 'text-amber-600' },
  topped_up: { icon: Wallet, color: 'text-blue-600' },
  emailed:   { icon: Mail, color: 'text-purple-600' },
  disabled:  { icon: XIcon, color: 'text-rose-600' },
};

function normalizeGiftCard(raw: Record<string, unknown>): GiftCard {
  const status = String(raw.status ?? 'active') as Status;
  return {
    giftcard_id: Number(raw.giftcard_id ?? 0),
    giftcard_number: String(raw.giftcard_number ?? ''),
    masked_code: String(raw.masked_code ?? '****'),
    value: Number(raw.value ?? 0),
    initial_value: Number(raw.initial_value ?? raw.value ?? 0),
    status: (['active', 'used', 'expired', 'disabled'] as const).includes(status) ? status : 'active',
    recipient_name: (raw.recipient_name as string | null) ?? null,
    recipient_email: (raw.recipient_email as string | null) ?? null,
    sender_name: (raw.sender_name as string | null) ?? null,
    sender_email: (raw.sender_email as string | null) ?? null,
    message: (raw.message as string | null) ?? null,
    currency: String(raw.currency ?? 'KES'),
    expires_at: (raw.expires_at as string | null) ?? null,
    email_status: String(raw.email_status ?? 'not_requested'),
    email_sent_at: (raw.email_sent_at as string | null) ?? null,
    is_expired: Boolean(raw.is_expired),
    remaining_pct: Number(raw.remaining_pct ?? 0),
    days_to_expiry: raw.days_to_expiry == null ? null : Number(raw.days_to_expiry),
    updated_at: String(raw.updated_at ?? new Date().toISOString()),
  };
}

function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => r as HistoryEntry);
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

interface CreateForm {
  value: string;
  recipient_name: string;
  recipient_email: string;
  sender_name: string;
  message: string;
  currency: string;
  expires_in_days: string;
  payment_provider: '' | Provider;
}

const EMPTY_CREATE: CreateForm = {
  value: '1000',
  recipient_name: '',
  recipient_email: '',
  sender_name: '',
  message: '',
  currency: 'KES',
  expires_in_days: '365',
  payment_provider: '',
};

export function GiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [stats, setStats] = useState<Stats>({ total_outstanding: 0, active_count: 0, expiring_soon_count: 0, used_count: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<{ card: GiftCard; history: HistoryEntry[] } | null>(null);
  const [deleting, setDeleting] = useState<GiftCard | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.giftcards.list(1, 100, search, statusFilter);
      const list = Array.isArray(res.data?.giftcards) ? res.data!.giftcards : [];
      setCards(list.map((c) => normalizeGiftCard(c as Record<string, unknown>)));
      const s = res.data?.stats as Stats | undefined;
      if (s) setStats(s);
    } catch {
      setCards([]);
      showToast('Failed to load gift cards', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const value = Number(createForm.value);
    if (!Number.isFinite(value) || value <= 0) {
      showToast('Enter a positive amount', 'error');
      return;
    }
    setCreating(true);
    try {
      const res = await api.giftcards.create({
        value: createForm.value,
        recipient_name: createForm.recipient_name,
        recipient_email: createForm.recipient_email,
        sender_name: createForm.sender_name,
        message: createForm.message,
        currency: createForm.currency,
        expires_in_days: createForm.expires_in_days ? Number(createForm.expires_in_days) : undefined,
        payment_provider: createForm.payment_provider || undefined,
      });
      const code = res.data?.giftcard ? normalizeGiftCard(res.data.giftcard as Record<string, unknown>).giftcard_number : '';
      showToast(`Gift card ${code} issued`);
      setShowCreate(false);
      setCreateForm(EMPTY_CREATE);
      playNotificationSound('payment');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function openDetail(card: GiftCard) {
    try {
      const res = await api.giftcards.get(card.giftcard_id);
      const fresh = res.data?.giftcard ? normalizeGiftCard(res.data.giftcard as Record<string, unknown>) : card;
      const history = normalizeHistory(res.data?.history);
      setDetail({ card: fresh, history });
    } catch {
      setDetail({ card, history: [] });
    }
  }

  async function refreshDetail() {
    if (!detail) return;
    await openDetail(detail.card);
    await load();
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.giftcards.delete(deleting.giftcard_id);
      showToast('Gift card disabled');
      setDeleting(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  const filtered = cards;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gift Cards</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sell, top-up, redeem and audit gift cards. Pay via M-Pesa, Airtel Money, MTN MoMo, cash, card or bank.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          Issue Gift Card
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Outstanding liability" value={formatCurrency(stats.total_outstanding)} color="bg-blue-500" />
        <StatCard label="Active" value={String(stats.active_count)} color="bg-emerald-500" />
        <StatCard label="Expiring <30 days" value={String(stats.expiring_soon_count)} color="bg-amber-500" warn={stats.expiring_soon_count > 0} />
        <StatCard label="Used" value={String(stats.used_count)} color="bg-gray-500" />
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_minmax(180px,240px)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by code, recipient name, or email..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([['', 'All'], ['active', 'Active'], ['used', 'Used'], ['expired', 'Expired'], ['disabled', 'Disabled']] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setStatusFilter(val as '' | Status)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  statusFilter === val
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Card grid */}
      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <CreditCard className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-500">No gift cards yet — issue your first one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((card) => (
            <GiftCardCard
              key={card.giftcard_id}
              card={card}
              onClick={() => openDetail(card)}
              onDelete={() => setDeleting(card)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      <Modal isOpen={showCreate} onClose={() => !creating && setShowCreate(false)} title="Issue gift card" size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Amount" required>
              <div className="flex">
                <select
                  value={createForm.currency}
                  onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value })}
                  className="rounded-l-lg border border-r-0 border-gray-200 bg-gray-50 px-2 text-xs font-mono font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option>KES</option><option>USD</option><option>EUR</option><option>GBP</option><option>NGN</option><option>UGX</option><option>TZS</option>
                </select>
                <input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  value={createForm.value}
                  onChange={(e) => setCreateForm({ ...createForm, value: e.target.value })}
                  className="w-full rounded-r-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
            </Field>
            <Field label="Expires in (days)">
              <input
                type="number"
                min="1"
                max="3650"
                value={createForm.expires_in_days}
                onChange={(e) => setCreateForm({ ...createForm, expires_in_days: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>
          </div>

          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Recipient (optional)</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <input
                placeholder="Recipient name"
                value={createForm.recipient_name}
                onChange={(e) => setCreateForm({ ...createForm, recipient_name: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              <input
                type="email"
                placeholder="Recipient email"
                value={createForm.recipient_email}
                onChange={(e) => setCreateForm({ ...createForm, recipient_email: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              <input
                placeholder="Sender name"
                value={createForm.sender_name}
                onChange={(e) => setCreateForm({ ...createForm, sender_name: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white md:col-span-2"
              />
              <textarea
                placeholder="Personal message (e.g. Happy Birthday!)"
                rows={2}
                value={createForm.message}
                onChange={(e) => setCreateForm({ ...createForm, message: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white md:col-span-2"
              />
            </div>
          </div>

          <Field label="Payment method (purchaser pays via)">
            <select
              value={createForm.payment_provider}
              onChange={(e) => setCreateForm({ ...createForm, payment_provider: e.target.value as '' | Provider })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="">— Not recorded —</option>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </Field>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Stored-value gift cards may require a prepaid-card licence in some jurisdictions
              (e.g. Kenya CBK, EU PSD2). Confirm local requirements before issuing at volume.
            </span>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={() => !creating && setShowCreate(false)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={creating} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
              {creating ? 'Issuing…' : 'Issue gift card'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Detail modal */}
      {detail && (
        <DetailModal
          key={detail.card.giftcard_id}
          detail={detail}
          onClose={() => setDetail(null)}
          onRefresh={refreshDetail}
        />
      )}

      {/* Delete modal */}
      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title="Disable gift card" size="sm">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Disable <span className="font-mono font-semibold">{deleting.masked_code}</span>?
              Remaining balance of <span className="font-semibold">{formatCurrency(deleting.value)}</span> will be frozen and the card can no longer be redeemed.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
              <button type="button" onClick={handleDelete} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700">Disable</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------- subcomponents ----------

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
      {label}{required && <span className="text-rose-500"> *</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatCard({ label, value, color, warn }: { label: string; value: string; color: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow-sm dark:bg-gray-800 ${warn ? 'border-amber-300 dark:border-amber-800' : 'border-gray-200 dark:border-gray-700'}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${color}`} />
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function GiftCardCard({ card, onClick, onDelete }: { card: GiftCard; onClick: () => void; onDelete: () => void }) {
  const style = STATUS_STYLE[card.status];
  return (
    <div className="group flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold text-gray-900 dark:text-white">{card.giftcard_number}</p>
          {card.recipient_name && (
            <p className="mt-1 truncate text-xs text-gray-500">→ {card.recipient_name}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{style.label}</span>
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Balance</p>
        <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{card.currency} {card.value.toLocaleString()}</p>
        <p className="text-[10px] text-gray-500">of {card.currency} {card.initial_value.toLocaleString()} initial</p>
        <div className="mt-2 h-1 rounded-full bg-gray-100 dark:bg-gray-900">
          <div
            className={`h-1 rounded-full ${card.status === 'active' ? 'bg-emerald-500' : card.status === 'used' ? 'bg-gray-400' : 'bg-amber-500'}`}
            style={{ width: `${Math.max(0, Math.min(100, card.remaining_pct))}%` }}
          />
        </div>
      </div>

      {card.days_to_expiry !== null && (
        <p className={`mt-3 text-[10px] ${card.days_to_expiry < 0 ? 'text-rose-600' : card.days_to_expiry < 30 ? 'text-amber-600' : 'text-gray-500'}`}>
          {card.days_to_expiry < 0
            ? `Expired ${-card.days_to_expiry}d ago`
            : `Expires in ${card.days_to_expiry}d`}
        </p>
      )}

      <div className="mt-auto flex gap-2 pt-4">
        <button
          type="button"
          onClick={onClick}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          <Pencil className="h-3.5 w-3.5" /> Manage
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Disable"
          className="rounded-lg border border-rose-200 bg-white px-2 py-1.5 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-900/20"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function DetailModal({
  detail,
  onClose,
  onRefresh,
}: {
  detail: { card: GiftCard; history: HistoryEntry[] };
  onClose: () => void;
  onRefresh: () => Promise<void>;
}) {
  const { card, history } = detail;
  const [activeAction, setActiveAction] = useState<'' | 'redeem' | 'refund' | 'adjust' | 'topup'>('');
  const [amount, setAmount] = useState('');
  const [comment, setComment] = useState('');
  const [provider, setProvider] = useState<Provider>('mpesa');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const style = STATUS_STYLE[card.status];

  function reset() {
    setActiveAction('');
    setAmount('');
    setComment('');
    setPhone('');
  }

  async function runAction(e: FormEvent) {
    e.preventDefault();
    if (!activeAction) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      showToast('Enter a positive amount', 'error');
      return;
    }
    setBusy(true);
    try {
      if (activeAction === 'redeem') {
        await api.giftcards.redeem(card.giftcard_id, { amount, comment });
      } else if (activeAction === 'refund') {
        await api.giftcards.refund(card.giftcard_id, { amount, comment });
      } else if (activeAction === 'adjust') {
        await api.giftcards.adjust(card.giftcard_id, { new_balance: amount, reason: comment || 'Manual adjustment' });
      } else if (activeAction === 'topup') {
        await api.giftcards.topup(card.giftcard_id, { amount, provider, phone });
        playNotificationSound('payment');
      }
      showToast(`${activeAction} successful`);
      reset();
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    try {
      await api.giftcards.resendEmail(card.giftcard_id);
      showToast('Email re-sent (mock)');
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to resend', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={`Gift card ${card.masked_code}`} size="lg">
      <div className="space-y-5">
        <div className="grid gap-4 md:grid-cols-[200px_1fr]">
          {/* QR */}
          <div className="rounded-xl border border-gray-200 bg-white p-3 text-center dark:border-gray-700 dark:bg-gray-900">
            <div className="aspect-square bg-white p-2">
              <QRCode value={card.giftcard_number} size={170} style={{ width: '100%', height: '100%' }} />
            </div>
            <button
              type="button"
              onClick={() => setShowCode((s) => !s)}
              className="mt-2 w-full text-[10px] font-mono text-blue-600 hover:underline"
            >
              {showCode ? card.giftcard_number : 'reveal code'}
            </button>
            <p className="mt-1 text-[9px] text-gray-500">share with care — bearer instrument</p>
          </div>

          {/* Summary */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{style.label}</span>
              {card.is_expired && <span className="text-[10px] text-rose-600">expired</span>}
              {card.days_to_expiry !== null && !card.is_expired && card.days_to_expiry < 30 && (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-600">
                  <AlertTriangle className="h-3 w-3" /> expires in {card.days_to_expiry}d
                </span>
              )}
            </div>

            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Balance</p>
              <p className="text-3xl font-bold text-gray-900 dark:text-white">{card.currency} {card.value.toLocaleString()}</p>
              <p className="text-xs text-gray-500">of {card.currency} {card.initial_value.toLocaleString()} initial · {card.remaining_pct}% remaining</p>
            </div>

            {(card.recipient_name || card.recipient_email || card.message) && (
              <div className="rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-900/60">
                {card.recipient_name && <p><span className="text-gray-500">To:</span> <span className="font-medium text-gray-800 dark:text-gray-100">{card.recipient_name}</span> {card.recipient_email && <span className="text-gray-500">({card.recipient_email})</span>}</p>}
                {card.sender_name && <p><span className="text-gray-500">From:</span> <span className="font-medium text-gray-800 dark:text-gray-100">{card.sender_name}</span></p>}
                {card.message && <p className="mt-2 italic text-gray-700 dark:text-gray-200">"{card.message}"</p>}
                {card.email_status !== 'not_requested' && (
                  <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-gray-500">
                    <Mail className="h-3 w-3" /> email {card.email_status}{card.email_sent_at ? ` at ${formatRelative(card.email_sent_at)}` : ''}
                    {card.recipient_email && (
                      <button type="button" onClick={resend} disabled={busy} className="ml-2 text-blue-600 hover:underline disabled:opacity-50">resend</button>
                    )}
                  </p>
                )}
              </div>
            )}

            {/* Public lookup hint */}
            {typeof window !== 'undefined' && (
              <p className="text-[10px] text-gray-500">
                Customer balance lookup:{' '}
                <a className="font-mono text-blue-600 hover:underline" href={`/giftcard/${card.giftcard_number}`} target="_blank" rel="noreferrer">
                  /giftcard/{card.masked_code}
                </a>
              </p>
            )}
          </div>
        </div>

        {/* Actions row */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <ActionButton label="Redeem" icon={TrendingDown} active={activeAction === 'redeem'} onClick={() => setActiveAction('redeem')} disabled={card.status !== 'active'} />
          <ActionButton label="Top up" icon={Wallet} active={activeAction === 'topup'} onClick={() => setActiveAction('topup')} disabled={card.status === 'disabled'} />
          <ActionButton label="Refund" icon={TrendingUp} active={activeAction === 'refund'} onClick={() => setActiveAction('refund')} disabled={card.status === 'disabled'} />
          <ActionButton label="Adjust" icon={Pencil} active={activeAction === 'adjust'} onClick={() => setActiveAction('adjust')} disabled={card.status === 'disabled'} />
        </div>

        {activeAction && (
          <form onSubmit={runAction} className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
              {activeAction === 'redeem' && 'Redeem amount'}
              {activeAction === 'refund' && 'Refund amount'}
              {activeAction === 'adjust' && 'New balance'}
              {activeAction === 'topup' && 'Top-up amount'}
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={activeAction === 'adjust' ? `New balance (current ${card.value})` : 'Amount'}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              {activeAction !== 'topup' ? (
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={activeAction === 'adjust' ? 'Reason (required)' : 'Comment (optional)'}
                  required={activeAction === 'adjust'}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              ) : (
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                    <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                  ))}
                </select>
              )}
              {activeAction === 'topup' && ['mpesa', 'airtel', 'mtn_momo'].includes(provider) && (
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Phone (07XX XXX XXX) — STK push target"
                  required
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm md:col-span-2 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={reset} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
              <button type="submit" disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                <Zap className="h-3 w-3" />
                {busy ? 'Working…' : 'Confirm'}
              </button>
            </div>
          </form>
        )}

        {/* History timeline */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
              Audit history ({history.length})
            </p>
          </div>
          {history.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-gray-500">No history yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {history.map((h) => {
                const meta = ACTION_ICON[h.action] ?? { icon: Send, color: 'text-gray-500' };
                const Icon = meta.icon;
                const signed = h.amount > 0 ? `+${h.amount.toLocaleString()}` : h.amount.toLocaleString();
                return (
                  <li key={h.history_id} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-gray-800 capitalize dark:text-gray-100">
                        {h.action.replace('_', ' ')}
                        {h.provider && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-mono uppercase text-gray-600 dark:bg-gray-900 dark:text-gray-300">{h.provider}</span>}
                      </p>
                      {h.comment && <p className="truncate text-[10px] text-gray-500">{h.comment}</p>}
                      {h.transaction_id && <p className="font-mono text-[9px] text-gray-400">{h.transaction_id}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-mono font-semibold ${h.amount > 0 ? 'text-emerald-600' : h.amount < 0 ? 'text-rose-600' : 'text-gray-500'}`}>{signed}</p>
                      <p className="text-[9px] text-gray-400">{formatRelative(h.created_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ActionButton({ label, icon: Icon, active, onClick, disabled }: { label: string; icon: typeof Plus; active: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
