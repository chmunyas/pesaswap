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
  Award,
  Cake,
  Calendar,
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
  Mail,
  Music4,
  Palette,
  PartyPopper,
  Pencil,
  Pizza,
  Plus,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  TreePine,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserPlus,
  Wallet,
  Wand2,
  X as XIcon,
  Zap,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';
import { playNotificationSound } from '../lib/realtime';
import { BindModal } from '../components/giftcard/BindModal';
import { giftcardBindingMock, type CardBinding } from '../lib/giftcard-bindings';

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
  // WeChat-parity modernization fields (nullable when migration not applied)
  design: Design | null;
  denomination: Denomination | null;
  delivery_status: 'immediate' | 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';
  deliver_at: string | null;
  delivered_at: string | null;
  pending_transfer: PendingTransfer | null;
}

interface Design {
  design_id: number;
  name: string;
  background_from: string;
  background_to: string;
  accent_color: string;
  text_color: string;
  image_url: string | null;
  icon: string | null;
  active: boolean;
  sort_order: number;
}

interface Denomination {
  denomination_id?: number;
  amount: number;
  label: string | null;
}

interface DenominationOption extends Denomination {
  denomination_id: number;
  currency: string;
  description: string | null;
  active: boolean;
  sort_order: number;
}

interface PendingTransfer {
  transfer_id: number;
  channel: string;
  to_recipient_name: string | null;
  to_recipient_email: string | null;
  expires_at: string | null;
  created_at: string | null;
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
  created:               { icon: Plus, color: 'text-emerald-600' },
  redeemed:              { icon: TrendingDown, color: 'text-rose-600' },
  refunded:              { icon: TrendingUp, color: 'text-emerald-600' },
  adjusted:              { icon: Pencil, color: 'text-amber-600' },
  topped_up:             { icon: Wallet, color: 'text-blue-600' },
  emailed:               { icon: Mail, color: 'text-purple-600' },
  disabled:              { icon: XIcon, color: 'text-rose-600' },
  transfer_requested:    { icon: UserPlus, color: 'text-indigo-600' },
  transfer_accepted_out: { icon: Send, color: 'text-indigo-600' },
  transfer_accepted_in:  { icon: Gift, color: 'text-emerald-600' },
  transfer_cancelled:    { icon: XIcon, color: 'text-gray-500' },
  scheduled:             { icon: Clock, color: 'text-sky-600' },
  delivered:             { icon: Mail, color: 'text-purple-600' },
};

// Lucide icon lookup for design rendering. Server-side whitelist in
// GiftcardsController::ALLOWED_DESIGN_ICONS must stay in sync.
const DESIGN_ICONS: Record<string, typeof Gift> = {
  Gift, Sparkles, TreePine, Cake, Star, Heart,
  PartyPopper, Cookie, Flower2, Music4, Coffee, Pizza,
  Award, Crown, Diamond, Trophy, Wand2,
};

function designIcon(name: string | null): typeof Gift {
  if (!name) return Gift;
  return DESIGN_ICONS[name] ?? Gift;
}

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
    design: raw.design && typeof raw.design === 'object' ? normalizeDesign(raw.design as Record<string, unknown>) : null,
    denomination: raw.denomination && typeof raw.denomination === 'object'
      ? { amount: Number((raw.denomination as Record<string, unknown>).amount ?? 0), label: ((raw.denomination as Record<string, unknown>).label as string | null) ?? null }
      : null,
    delivery_status: (String(raw.delivery_status ?? 'immediate') as GiftCard['delivery_status']),
    deliver_at: (raw.deliver_at as string | null) ?? null,
    delivered_at: (raw.delivered_at as string | null) ?? null,
    pending_transfer: raw.pending_transfer && typeof raw.pending_transfer === 'object'
      ? normalizePendingTransfer(raw.pending_transfer as Record<string, unknown>)
      : null,
  };
}

function normalizeDesign(raw: Record<string, unknown>): Design {
  return {
    design_id: Number(raw.design_id ?? 0),
    name: String(raw.name ?? ''),
    background_from: String(raw.background_from ?? '#3B82F6'),
    background_to: String(raw.background_to ?? '#8B5CF6'),
    accent_color: String(raw.accent_color ?? '#FFFFFF'),
    text_color: String(raw.text_color ?? '#FFFFFF'),
    image_url: (raw.image_url as string | null) ?? null,
    icon: (raw.icon as string | null) ?? null,
    active: Boolean(raw.active),
    sort_order: Number(raw.sort_order ?? 0),
  };
}

function normalizeDenomination(raw: Record<string, unknown>): DenominationOption {
  return {
    denomination_id: Number(raw.denomination_id ?? 0),
    currency: String(raw.currency ?? 'KES'),
    amount: Number(raw.amount ?? 0),
    label: (raw.label as string | null) ?? null,
    description: (raw.description as string | null) ?? null,
    active: Boolean(raw.active),
    sort_order: Number(raw.sort_order ?? 0),
  };
}

function normalizePendingTransfer(raw: Record<string, unknown>): PendingTransfer {
  return {
    transfer_id: Number(raw.transfer_id ?? 0),
    channel: String(raw.channel ?? 'link'),
    to_recipient_name: (raw.to_recipient_name as string | null) ?? null,
    to_recipient_email: (raw.to_recipient_email as string | null) ?? null,
    expires_at: (raw.expires_at as string | null) ?? null,
    created_at: (raw.created_at as string | null) ?? null,
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
  recipient_phone: string;
  bind_on_issue: boolean;
  mno_provider: 'mpesa' | 'airtel' | 'momo';
  sender_name: string;
  message: string;
  currency: string;
  expires_in_days: string;
  payment_provider: '' | Provider;
  design_id: string;
  denomination_id: string;
  deliver_at: string;
}

const EMPTY_CREATE: CreateForm = {
  value: '1000',
  recipient_name: '',
  recipient_email: '',
  recipient_phone: '',
  bind_on_issue: true,
  mno_provider: 'mpesa',
  sender_name: '',
  message: '',
  currency: 'KES',
  expires_in_days: '365',
  payment_provider: '',
  design_id: '',
  denomination_id: '',
  deliver_at: '',
};

interface TransferForm {
  to_recipient_name: string;
  to_recipient_email: string;
  to_recipient_phone: string;
  message: string;
  channel: 'link' | 'email' | 'sms';
}

const EMPTY_TRANSFER: TransferForm = {
  to_recipient_name: '',
  to_recipient_email: '',
  to_recipient_phone: '',
  message: '',
  channel: 'link',
};

export function GiftCardsPage() {
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [stats, setStats] = useState<Stats>({ total_outstanding: 0, active_count: 0, expiring_soon_count: 0, used_count: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');

  const [designs, setDesigns] = useState<Design[]>([]);
  const [denominations, setDenominations] = useState<DenominationOption[]>([]);

  const [showCreate, setShowCreate] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE);
  const [creating, setCreating] = useState(false);

  const [detail, setDetail] = useState<{ card: GiftCard; history: HistoryEntry[] } | null>(null);
  const [deleting, setDeleting] = useState<GiftCard | null>(null);
  const [transferTarget, setTransferTarget] = useState<GiftCard | null>(null);
  const [bindTarget, setBindTarget] = useState<{ card: GiftCard; prefillPhone?: string | null } | null>(null);
  // Track NFC binding state per card code (client-side mock).
  const [bindings, setBindings] = useState<Record<string, CardBinding>>({});

  function refreshBindings() {
    const all = giftcardBindingMock.list();
    const map: Record<string, CardBinding> = {};
    for (const b of all) if (b.status === 'active') map[b.giftcard_code] = b;
    setBindings(map);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await api.giftcards.list(1, 100, search, statusFilter);
      const list = Array.isArray(res.data?.giftcards) ? res.data!.giftcards : [];
      const normalized = list.map((c) => normalizeGiftCard(c as Record<string, unknown>));
      setCards(normalized);
      // Hydrate the adapter cache from the card payloads (each card now
      // includes its `active_binding` thanks to the backend decorate() helper).
      const cardsForPrime = list.map((raw) => {
        const r = raw as Record<string, unknown>;
        return {
          giftcard_id: Number(r.giftcard_id ?? 0),
          giftcard_number: String(r.giftcard_number ?? ''),
          active_binding: (r.active_binding as Record<string, unknown> | null | undefined) ?? null,
        };
      });
      giftcardBindingMock.primeMany(cardsForPrime);
      refreshBindings();
      const s = res.data?.stats as Stats | undefined;
      if (s) setStats(s);
    } catch {
      setCards([]);
      showToast('Failed to load gift cards', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadDesignsAndDenominations() {
    try {
      const [d, n] = await Promise.all([api.giftcards.designs.list(), api.giftcards.denominations.list()]);
      const designList = Array.isArray(d.data?.designs) ? d.data!.designs : [];
      setDesigns(designList.map((r) => normalizeDesign(r as Record<string, unknown>)).filter((x) => x.active));
      const denomList = Array.isArray(n.data?.denominations) ? n.data!.denominations : [];
      setDenominations(denomList.map((r) => normalizeDenomination(r as Record<string, unknown>)).filter((x) => x.active));
    } catch {
      // Modernization migration not applied — empty lists keep the page usable.
      setDesigns([]);
      setDenominations([]);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusFilter]);

  useEffect(() => {
    void loadDesignsAndDenominations();
    refreshBindings();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const value = Number(createForm.value);
    if (!Number.isFinite(value) || value <= 0) {
      showToast('Enter a positive amount', 'error');
      return;
    }
    const phoneNormalized = createForm.recipient_phone.replace(/\s+/g, '').trim();
    if (createForm.bind_on_issue && phoneNormalized && phoneNormalized.length < 7) {
      showToast('Enter a valid phone number to link the card', 'error');
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
        design_id: createForm.design_id ? Number(createForm.design_id) : undefined,
        denomination_id: createForm.denomination_id ? Number(createForm.denomination_id) : undefined,
        deliver_at: createForm.deliver_at || undefined,
      });
      const fresh = res.data?.giftcard ? normalizeGiftCard(res.data.giftcard as Record<string, unknown>) : null;
      const code = fresh?.giftcard_number ?? '';

      // Inline bind: if phone was given AND toggle is on, link immediately so
      // the cashier doesn't have to chase a second modal. This is the
      // collapsed Issue→Bind flow from the Jony-Ive/WeChat redesign.
      let bindNote = '';
      if (fresh && createForm.bind_on_issue && phoneNormalized) {
        try {
          await giftcardBindingMock.bind({
            giftcard_code: fresh.giftcard_number,
            mobile_number: phoneNormalized,
            mno_provider: createForm.mno_provider,
          });
          refreshBindings();
          bindNote = ` · linked to ${giftcardBindingMock.maskPhone(phoneNormalized)}`;
        } catch (err) {
          // Soft-fail the bind so the cashier still has a working card.
          // Surface a follow-up bind modal so they can retry without
          // re-entering all the issue data.
          showToast(`Card issued but link failed: ${err instanceof Error ? err.message : 'STK push error'}`, 'error');
          setBindTarget({ card: fresh, prefillPhone: phoneNormalized });
        }
      }
      showToast(`Gift card ${code} issued${bindNote}`);
      setShowCreate(false);
      setShowMoreOptions(false);
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
          Send a gift
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
              binding={bindings[card.giftcard_number] ?? null}
              onClick={() => openDetail(card)}
              onDelete={() => setDeleting(card)}
              onTransfer={() => setTransferTarget(card)}
              onBind={() => setBindTarget({ card, prefillPhone: null })}
            />
          ))}
        </div>
      )}

      {/* Create modal — collapsed redesign (3 visible fields by default).
          "More options" disclosure hides design / denomination / scheduling /
          payment-method, which power users rarely need but still appreciate. */}
      <Modal
        isOpen={showCreate}
        onClose={() => {
          if (creating) return;
          setShowCreate(false);
          setShowMoreOptions(false);
        }}
        title="Send a gift"
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-5">
          {/* === The 3 essential fields === */}

          {/* Amount, with currency dropdown stuck to the left + preset chips
              below if denominations exist. */}
          <Field label="Amount" required>
            <div className="flex">
              <select
                value={createForm.currency}
                onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value, denomination_id: '' })}
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
                onChange={(e) => setCreateForm({ ...createForm, value: e.target.value, denomination_id: '' })}
                className="w-full rounded-r-lg border border-gray-200 bg-white px-3 py-2 text-base font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                autoFocus
              />
            </div>
            {denominations.filter((d) => d.currency === createForm.currency).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {denominations
                  .filter((d) => d.currency === createForm.currency)
                  .map((d) => (
                    <button
                      key={d.denomination_id}
                      type="button"
                      onClick={() => setCreateForm({
                        ...createForm,
                        denomination_id: createForm.denomination_id === String(d.denomination_id) ? '' : String(d.denomination_id),
                        value: createForm.denomination_id === String(d.denomination_id) ? createForm.value : String(d.amount),
                      })}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
                        createForm.denomination_id === String(d.denomination_id)
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200'
                      }`}
                    >
                      {d.label ?? `${d.currency} ${d.amount.toLocaleString()}`}
                    </button>
                  ))}
              </div>
            )}
          </Field>

          {/* Recipient phone — the only contact field by default; everything
              else (name, email) lives in More options. The phone drives both
              the recipient-name imprint AND the NFC binding. */}
          <Field label="Send to phone">
            <div className="flex gap-2">
              <select
                value={createForm.mno_provider}
                onChange={(e) => setCreateForm({ ...createForm, mno_provider: e.target.value as 'mpesa' | 'airtel' | 'momo' })}
                className="w-28 rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs font-mono font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                aria-label="Mobile network"
                disabled={!createForm.bind_on_issue}
              >
                <option value="mpesa">M-Pesa</option>
                <option value="airtel">Airtel</option>
                <option value="momo">MoMo</option>
              </select>
              <input
                type="tel"
                inputMode="tel"
                placeholder="+254 7XX XXX XXX"
                value={createForm.recipient_phone}
                onChange={(e) => setCreateForm({ ...createForm, recipient_phone: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={createForm.bind_on_issue}
                onChange={(e) => setCreateForm({ ...createForm, bind_on_issue: e.target.checked })}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="flex items-center gap-1">
                <Smartphone className="h-3.5 w-3.5 text-blue-600" />
                Link this card to the phone (one-tap redemption)
              </span>
            </label>
          </Field>

          {/* Personal message — keep it short, hint at the ceremony. */}
          <Field label="Message (optional)">
            <textarea
              placeholder="Happy birthday! 🎂"
              rows={2}
              value={createForm.message}
              onChange={(e) => setCreateForm({ ...createForm, message: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              maxLength={140}
            />
          </Field>

          {/* === More options disclosure === */}
          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setShowMoreOptions((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {showMoreOptions ? 'Hide' : 'More'} options
              <span className="text-[10px] font-normal text-gray-400">
                {showMoreOptions ? '−' : '+'} design · expiry · schedule · sender · email · payment method
              </span>
            </button>

            {showMoreOptions && (
              <div className="mt-3 space-y-4">
                {/* Design picker. Empty list = migration not applied; hide. */}
                {designs.length > 0 && (
                  <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    <p className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-gray-500">
                      <Palette className="h-3 w-3" /> Design
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-2 md:grid-cols-6">
                      <button
                        type="button"
                        onClick={() => setCreateForm({ ...createForm, design_id: '' })}
                        className={`flex aspect-square flex-col items-center justify-center rounded-lg border text-[10px] font-semibold transition ${
                          createForm.design_id === '' ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
                        }`}
                        aria-label="Auto-pick design"
                      >
                        <Sparkles className="mb-1 h-4 w-4 text-gray-400" />
                        Auto
                      </button>
                      {designs.map((d) => (
                        <DesignTile
                          key={d.design_id}
                          design={d}
                          selected={createForm.design_id === String(d.design_id)}
                          onClick={() => setCreateForm({ ...createForm, design_id: String(d.design_id) })}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Recipient name">
                    <input
                      placeholder="Alice"
                      value={createForm.recipient_name}
                      onChange={(e) => setCreateForm({ ...createForm, recipient_name: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                  </Field>
                  <Field label="Sender name">
                    <input
                      placeholder="Bob"
                      value={createForm.sender_name}
                      onChange={(e) => setCreateForm({ ...createForm, sender_name: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                  </Field>
                  <Field label="Recipient email">
                    <input
                      type="email"
                      placeholder="alice@example.com"
                      value={createForm.recipient_email}
                      onChange={(e) => setCreateForm({ ...createForm, recipient_email: e.target.value })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
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

                <Field label="Schedule delivery">
                  <input
                    type="datetime-local"
                    value={createForm.deliver_at}
                    onChange={(e) => setCreateForm({ ...createForm, deliver_at: e.target.value })}
                    min={new Date(Date.now() + 60 * 1000).toISOString().slice(0, 16)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white md:max-w-[18rem]"
                  />
                  <p className="mt-1 text-[10px] text-gray-500">
                    Leave blank for immediate delivery. Scheduled cards are <span className="font-semibold">pending</span> until <code className="font-mono">spark giftcards:dispatch</code> fires.
                  </p>
                </Field>

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
              </div>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Stored-value gift cards may require a prepaid-card licence in some jurisdictions
              (e.g. Kenya CBK, EU PSD2). Confirm local requirements before issuing at volume.
            </span>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              type="button"
              onClick={() => {
                if (creating) return;
                setShowCreate(false);
                setShowMoreOptions(false);
              }}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Cancel
            </button>
            <button type="submit" disabled={creating} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
              {creating
                ? 'Sending…'
                : createForm.bind_on_issue && createForm.recipient_phone
                  ? 'Send & link'
                  : 'Send gift'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Detail modal */}
      {detail && (
        <DetailModal
          key={detail.card.giftcard_id}
          detail={detail}
          binding={bindings[detail.card.giftcard_number] ?? null}
          onClose={() => setDetail(null)}
          onRefresh={refreshDetail}
          onTransfer={() => {
            setTransferTarget(detail.card);
            setDetail(null);
          }}
          onBind={() => {
            setBindTarget({ card: detail.card, prefillPhone: detail.card.recipient_email ? null : null });
            setDetail(null);
          }}
          onUnbind={async () => {
            await giftcardBindingMock.unbind(detail.card.giftcard_number);
            refreshBindings();
            showToast('Card unlinked from phone');
          }}
        />
      )}

      {/* Transfer modal */}
      {transferTarget && (
        <TransferModal
          card={transferTarget}
          onClose={() => setTransferTarget(null)}
          onSent={async () => {
            setTransferTarget(null);
            await load();
            showToast('Transfer requested — share the link with the recipient');
          }}
        />
      )}

      {/* Bind-to-phone modal */}
      {bindTarget && (
        <BindModal
          giftcardCode={bindTarget.card.giftcard_number}
          prefillPhone={bindTarget.prefillPhone}
          onClose={() => setBindTarget(null)}
          onBound={() => {
            refreshBindings();
            setBindTarget(null);
          }}
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

function GiftCardCard({ card, binding, onClick, onDelete, onTransfer, onBind }: { card: GiftCard; binding: CardBinding | null; onClick: () => void; onDelete: () => void; onTransfer: () => void; onBind: () => void }) {
  const style = STATUS_STYLE[card.status];
  const Icon = designIcon(card.design?.icon ?? null);
  const headerGradient = card.design
    ? { backgroundImage: `linear-gradient(135deg, ${card.design.background_from}, ${card.design.background_to})` }
    : { backgroundImage: 'linear-gradient(135deg, #3B82F6, #8B5CF6)' };
  const headerTextColor = card.design?.text_color ?? '#FFFFFF';
  return (
    <div className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
      {/* Design strip */}
      <div className="flex items-center justify-between px-4 py-3" style={{ ...headerGradient, color: headerTextColor }}>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 opacity-90" />
          <p className="font-mono text-xs font-bold tracking-wide">{card.masked_code}</p>
        </div>
        <span className={`shrink-0 rounded-full bg-white/85 px-2 py-0.5 text-[10px] font-bold text-gray-800 ${style.badge}`}>{style.label}</span>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div>
          {card.recipient_name && (
            <p className="truncate text-xs text-gray-500">→ {card.recipient_name}</p>
          )}
        </div>

        <div className="mt-3">
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

        {/* Status badges */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px]">
          {binding && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">
              <Link2 className="h-3 w-3" /> {giftcardBindingMock.mnoLabel(binding.mno_provider)} {giftcardBindingMock.maskPhone(binding.mobile_number)}
            </span>
          )}
          {card.pending_transfer && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200">
              <UserPlus className="h-3 w-3" /> Transfer pending
            </span>
          )}
          {card.delivery_status === 'pending' && card.deliver_at && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
              <Clock className="h-3 w-3" /> Sends {new Date(card.deliver_at).toLocaleString()}
            </span>
          )}
          {card.days_to_expiry !== null && (
            <span className={card.days_to_expiry < 0 ? 'text-rose-600' : card.days_to_expiry < 30 ? 'text-amber-600' : 'text-gray-500'}>
              {card.days_to_expiry < 0 ? `Expired ${-card.days_to_expiry}d ago` : `Expires in ${card.days_to_expiry}d`}
            </span>
          )}
        </div>

        <div className="mt-auto flex gap-2 pt-4">
          <button
            type="button"
            onClick={onClick}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Pencil className="h-3.5 w-3.5" /> Manage
          </button>
          {!binding ? (
            <button
              type="button"
              onClick={onBind}
              disabled={card.status !== 'active'}
              aria-label="Link to phone"
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900 dark:bg-gray-900 dark:text-emerald-200 dark:hover:bg-emerald-900/20"
            >
              <Smartphone className="h-3.5 w-3.5" /> Link
            </button>
          ) : null}
          <button
            type="button"
            onClick={onTransfer}
            disabled={card.status !== 'active' || card.pending_transfer !== null}
            aria-label="Send as gift"
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900 dark:bg-gray-900 dark:text-indigo-200 dark:hover:bg-indigo-900/20"
          >
            <Gift className="h-3.5 w-3.5" /> Gift
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
    </div>
  );
}

function DetailModal({
  detail,
  binding,
  onClose,
  onRefresh,
  onTransfer,
  onBind,
  onUnbind,
}: {
  detail: { card: GiftCard; history: HistoryEntry[] };
  binding: CardBinding | null;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onTransfer: () => void;
  onBind: () => void;
  onUnbind: () => Promise<void>;
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

  async function cancelTransfer() {
    if (!card.pending_transfer) return;
    setBusy(true);
    try {
      await api.giftcards.transferCancel(card.giftcard_id, card.pending_transfer.transfer_id);
      showToast('Transfer cancelled');
      await onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to cancel transfer', 'error');
    } finally {
      setBusy(false);
    }
  }

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

        {/* Pending transfer banner */}
        {card.pending_transfer && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-900/30">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <UserPlus className="mt-0.5 h-4 w-4 text-indigo-600 dark:text-indigo-300" />
                <div className="text-xs">
                  <p className="font-semibold text-indigo-800 dark:text-indigo-200">
                    Transfer pending — balance frozen until accepted
                  </p>
                  <p className="mt-0.5 text-indigo-700 dark:text-indigo-300">
                    To {card.pending_transfer.to_recipient_name ?? 'recipient'}
                    {card.pending_transfer.to_recipient_email && <> ({card.pending_transfer.to_recipient_email})</>}
                    {card.pending_transfer.expires_at && <> · expires {formatRelative(card.pending_transfer.expires_at)}</>}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={cancelTransfer}
                disabled={busy}
                className="rounded-lg border border-indigo-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-gray-900 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
              >
                Cancel transfer
              </button>
            </div>
          </div>
        )}

        {/* Scheduled delivery banner */}
        {card.delivery_status === 'pending' && card.deliver_at && (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs dark:border-sky-900 dark:bg-sky-900/30">
            <p className="inline-flex items-center gap-1.5 font-semibold text-sky-800 dark:text-sky-200">
              <Clock className="h-3.5 w-3.5" /> Scheduled delivery
            </p>
            <p className="mt-0.5 text-sky-700 dark:text-sky-300">
              Email to {card.recipient_email} will be sent on {new Date(card.deliver_at).toLocaleString()} by the
              <code className="ml-1 font-mono">spark giftcards:dispatch</code> cron.
            </p>
          </div>
        )}

        {/* NFC binding panel */}
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          {binding ? (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Link2 className="mt-0.5 h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                <div className="text-xs">
                  <p className="font-semibold text-gray-900 dark:text-white">
                    Linked to {giftcardBindingMock.maskPhone(binding.mobile_number)} via {giftcardBindingMock.mnoLabel(binding.mno_provider)}
                  </p>
                  <p className="mt-0.5 text-gray-500">
                    Redemptions will ask this phone to authorise with a PIN before the balance is debited.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void onUnbind()}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                <Link2Off className="h-3 w-3" /> Unlink
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Smartphone className="mt-0.5 h-4 w-4 text-gray-500" />
                <div className="text-xs">
                  <p className="font-semibold text-gray-900 dark:text-white">Bearer card — not linked to a phone</p>
                  <p className="mt-0.5 text-gray-500">
                    Anyone with the code can redeem. Link to a phone to require STK-PIN authorisation per redemption.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onBind}
                disabled={busy || card.status !== 'active'}
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <Smartphone className="h-3 w-3" /> Link to phone
              </button>
            </div>
          )}
        </div>

        {/* Actions row */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <ActionButton label="Redeem" icon={TrendingDown} active={activeAction === 'redeem'} onClick={() => setActiveAction('redeem')} disabled={card.status !== 'active' || card.pending_transfer !== null} />
          <ActionButton label="Top up" icon={Wallet} active={activeAction === 'topup'} onClick={() => setActiveAction('topup')} disabled={card.status === 'disabled' || card.pending_transfer !== null} />
          <ActionButton label="Refund" icon={TrendingUp} active={activeAction === 'refund'} onClick={() => setActiveAction('refund')} disabled={card.status === 'disabled' || card.pending_transfer !== null} />
          <ActionButton label="Adjust" icon={Pencil} active={activeAction === 'adjust'} onClick={() => setActiveAction('adjust')} disabled={card.status === 'disabled' || card.pending_transfer !== null} />
          <ActionButton label="Send as gift" icon={Gift} active={false} onClick={onTransfer} disabled={card.status !== 'active' || card.pending_transfer !== null} />
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

function DesignTile({ design, selected, onClick }: { design: Design; selected: boolean; onClick: () => void }) {
  const Icon = designIcon(design.icon);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-lg border text-[10px] font-semibold transition ${
        selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
      }`}
      style={{ backgroundImage: `linear-gradient(135deg, ${design.background_from}, ${design.background_to})`, color: design.text_color }}
      title={design.name}
      aria-label={`Use ${design.name} design`}
    >
      <Icon className="mb-1 h-5 w-5" />
      <span className="truncate px-1">{design.name}</span>
    </button>
  );
}

function TransferModal({ card, onClose, onSent }: { card: GiftCard; onClose: () => void; onSent: () => Promise<void> }) {
  const [form, setForm] = useState<TransferForm>(EMPTY_TRANSFER);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ accept_url: string; verification_token: string; expires_at: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.giftcards.transfer(card.giftcard_id, {
        to_recipient_name: form.to_recipient_name,
        to_recipient_email: form.to_recipient_email,
        to_recipient_phone: form.to_recipient_phone,
        message: form.message,
        channel: form.channel,
      });
      const data = res.data as Record<string, unknown> | undefined;
      setResult({
        accept_url: String(data?.accept_url ?? ''),
        verification_token: String(data?.verification_token ?? ''),
        expires_at: String(data?.expires_at ?? ''),
      });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to request transfer', 'error');
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!result) return;
    const url = window.location.origin + result.accept_url;
    void navigator.clipboard?.writeText(url).then(() => showToast('Link copied to clipboard'));
  }

  return (
    <Modal isOpen={true} onClose={() => (busy ? undefined : onClose())} title={`Send as gift — ${card.masked_code}`} size="md">
      {result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-900/30">
            <p className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
              <Gift className="h-4 w-4" /> Transfer link ready
            </p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
              Share this link with the recipient. When they accept, the gift card code rotates and the old code stops working. The balance is frozen until they accept (or you cancel).
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11px] text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 break-all">
            {window.location.origin}{result.accept_url}
          </div>
          {result.expires_at && (
            <p className="text-[11px] text-gray-500">Expires {new Date(result.expires_at).toLocaleString()}</p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={copyLink} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">
              Copy link
            </button>
            <button type="button" onClick={() => void onSent()} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <p className="font-semibold">How transfer works</p>
            <p className="mt-0.5">
              The recipient opens a one-time link to accept. When they do, a brand-new code is generated for them and the current code stops working. The balance is frozen during the transfer window.
            </p>
          </div>

          <Field label="Recipient name">
            <input
              value={form.to_recipient_name}
              onChange={(e) => setForm({ ...form, to_recipient_name: e.target.value })}
              placeholder="Alice Smith"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Recipient email">
              <input
                type="email"
                value={form.to_recipient_email}
                onChange={(e) => setForm({ ...form, to_recipient_email: e.target.value })}
                placeholder="alice@example.com"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>
            <Field label="Recipient phone">
              <input
                type="tel"
                value={form.to_recipient_phone}
                onChange={(e) => setForm({ ...form, to_recipient_phone: e.target.value })}
                placeholder="07XX XXX XXX"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>
          </div>

          <Field label="Personal message (optional)">
            <textarea
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              rows={2}
              placeholder="Happy birthday Alice!"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </Field>

          <Field label="Delivery channel">
            <select
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value as TransferForm['channel'] })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="link">Link only (you copy & share)</option>
              <option value="email">Email (requires recipient email)</option>
              <option value="sms">SMS (requires recipient phone)</option>
            </select>
          </Field>

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
              {busy ? 'Requesting…' : 'Generate transfer link'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
