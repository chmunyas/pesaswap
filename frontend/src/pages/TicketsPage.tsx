/**
 * TicketsPage — Phase 1 admin UI for QR ticketing.
 *
 * Three tabs:
 *   - Products: list ticket products + create modal with subtype-aware form
 *     (meeting / scenic / movie / transport) + per-product detail.
 *   - Instances: issued tickets list with status filter + issue modal +
 *     per-ticket detail modal (QR code + revoke/refund).
 *   - Redeem: staff scan flow — paste/scan a JWT or full ticket URL or
 *     short code; large green/red result card.
 */

import { useEffect, useState, type FormEvent } from 'react';
import {
  Calendar,
  CheckCircle2,
  ChevronRight,
  Film,
  MapPin,
  Plus,
  QrCode,
  ScanLine,
  Search,
  Tag,
  Ticket,
  Trash2,
  Train,
  Users,
  XCircle,
  Zap,
} from 'lucide-react';
import { QRCode } from 'react-qr-code';
import { api } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';

type Subtype = 'meeting' | 'scenic' | 'movie' | 'transport';
type Status = 'issued' | 'active' | 'redeemed' | 'refunded' | 'revoked' | 'expired';
type RedeemResult = 'ok' | 'already_redeemed' | 'expired' | 'revoked' | 'not_yet_valid' | 'wrong_location' | 'invalid_signature' | 'not_found';

interface TicketProduct {
  ticket_product_id: number;
  item_id: number;
  subtype: Subtype;
  title: string;
  brand_name: string | null;
  color: string | null;
  notice: string | null;
  description: string | null;
  code_type: string;
  validity_mode: string;
  begin_ts: string | null;
  end_ts: string | null;
  quantity: number | null;
  quantity_issued: number;
  remaining: number | null;
  sold_out: boolean;
  sale_window_open: boolean;
  bind_customer: number;
  transferable: number;
  single_use: number;
  max_redemptions: number;
  refundable: number;
  refund_window_hours: number | null;
  item_name?: string;
  item_price?: string;
}

interface TicketInstance {
  ticket_id: number;
  ticket_product_id: number;
  product_title?: string;
  subtype?: Subtype;
  brand_name?: string;
  code: string;
  masked_code: string;
  status: Status;
  customer_id: number | null;
  sale_id: number | null;
  valid_from: string | null;
  valid_to: string | null;
  issued_at: string;
  redeemed_at: string | null;
  redeem_count: number;
  seat_assignment_json: string | null;
}

interface RedemptionLog {
  redemption_id: number;
  occurred_at: string;
  result: RedeemResult;
  employee_id: number | null;
  location_id: number | null;
  notes: string | null;
}

const SUBTYPE_ICON: Record<Subtype, typeof Film> = {
  meeting: Users,
  scenic: MapPin,
  movie: Film,
  transport: Train,
};

const SUBTYPE_LABEL: Record<Subtype, string> = {
  meeting: 'Meeting / Event',
  scenic: 'Scenic / Tourism',
  movie: 'Movie / Cinema',
  transport: 'Transport',
};

const STATUS_STYLE: Record<Status, { badge: string; label: string }> = {
  issued:   { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200', label: 'Issued' },
  active:   { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200', label: 'Active' },
  redeemed: { badge: 'bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300', label: 'Redeemed' },
  refunded: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', label: 'Refunded' },
  revoked:  { badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200', label: 'Revoked' },
  expired:  { badge: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', label: 'Expired' },
};

const REDEEM_RESULT_STYLE: Record<RedeemResult, { color: string; icon: typeof CheckCircle2; label: string }> = {
  ok:                 { color: 'emerald', icon: CheckCircle2, label: 'Admitted ✓' },
  already_redeemed:   { color: 'rose',    icon: XCircle, label: 'Already redeemed' },
  expired:            { color: 'amber',   icon: XCircle, label: 'Expired' },
  revoked:            { color: 'rose',    icon: XCircle, label: 'Revoked' },
  not_yet_valid:      { color: 'amber',   icon: XCircle, label: 'Not yet valid' },
  wrong_location:     { color: 'amber',   icon: XCircle, label: 'Wrong location' },
  invalid_signature:  { color: 'rose',    icon: XCircle, label: 'Invalid signature' },
  not_found:          { color: 'rose',    icon: XCircle, label: 'Not found' },
};

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  try {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return iso;
    const diff = (t - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 60) return diff < 0 ? 'just now' : 'in a moment';
    if (abs < 3600) {
      const m = Math.floor(abs / 60);
      return diff < 0 ? `${m}m ago` : `in ${m}m`;
    }
    if (abs < 86400) {
      const h = Math.floor(abs / 3600);
      return diff < 0 ? `${h}h ago` : `in ${h}h`;
    }
    return new Date(t).toLocaleDateString();
  } catch {
    return iso;
  }
}

interface TicketSession {
  session_id: number;
  ticket_product_id: number;
  label: string | null;
  starts_at: string;
  ends_at: string | null;
  quantity: number | null;
  quantity_issued: number;
  remaining: number | null;
  sold_out: boolean;
  hall: string | null;
  gate: string | null;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
}

interface TicketTier {
  tier_id: number;
  ticket_product_id: number;
  name: string;
  price: string;
  quantity: number | null;
  quantity_issued: number;
  remaining: number | null;
  sold_out: boolean;
  sort_order: number;
  color: string | null;
  description: string | null;
}

interface CreateProductForm {
  item_id: string;
  subtype: Subtype;
  title: string;
  brand_name: string;
  notice: string;
  description: string;
  code_type: string;
  validity_mode: 'fixed' | 'relative';
  begin_ts: string;
  end_ts: string;
  fixed_term_days: string;
  quantity: string;
  max_per_customer: string;
  bind_customer: boolean;
  transferable: boolean;
  refundable: boolean;
  refund_window_hours: string;
  // Subtype-specific (only the relevant fields are sent)
  meeting_detail: string;
  meeting_entrance: string;
  meeting_zone: string;
  scenic_name: string;
  scenic_opening_hours: string;
  scenic_ticket_class: string;
  scenic_address: string;
  movie_film_title: string;
  movie_hall: string;
  movie_screening_ts: string;
  transport_origin: string;
  transport_destination: string;
  transport_carrier: string;
  transport_departure_ts: string;
  transport_arrival_ts: string;
}

const EMPTY_CREATE: CreateProductForm = {
  item_id: '1',
  subtype: 'movie',
  title: '',
  brand_name: '',
  notice: '',
  description: '',
  code_type: 'qrcode',
  validity_mode: 'fixed',
  begin_ts: '',
  end_ts: '',
  fixed_term_days: '30',
  quantity: '',
  max_per_customer: '',
  bind_customer: false,
  transferable: true,
  refundable: true,
  refund_window_hours: '',
  meeting_detail: '',
  meeting_entrance: '',
  meeting_zone: '',
  scenic_name: '',
  scenic_opening_hours: '',
  scenic_ticket_class: '',
  scenic_address: '',
  movie_film_title: '',
  movie_hall: '',
  movie_screening_ts: '',
  transport_origin: '',
  transport_destination: '',
  transport_carrier: '',
  transport_departure_ts: '',
  transport_arrival_ts: '',
};

export function TicketsPage() {
  const [tab, setTab] = useState<'products' | 'instances' | 'redeem'>('products');

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Ticket className="h-6 w-6 text-fuchsia-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">QR Ticketing</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Sell event, scenic, cinema and transport tickets with QR + JWT redemption.
        </p>
      </div>

      <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {(['products', 'instances', 'redeem'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize transition ${
              tab === t
                ? 'bg-fuchsia-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
            }`}
          >
            {t === 'redeem' ? 'Scan & Redeem' : t}
          </button>
        ))}
      </div>

      {tab === 'products' && <ProductsTab />}
      {tab === 'instances' && <InstancesTab />}
      {tab === 'redeem' && <RedeemTab />}
    </div>
  );
}

// ---------- PRODUCTS TAB ----------

function ProductsTab() {
  const [products, setProducts] = useState<TicketProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [subtypeFilter, setSubtypeFilter] = useState<'' | Subtype>('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateProductForm>(EMPTY_CREATE);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<TicketProduct | null>(null);
  const [managingSessions, setManagingSessions] = useState<TicketProduct | null>(null);
  const [managingTiers, setManagingTiers] = useState<TicketProduct | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.tickets.products.list(1, 100, search, subtypeFilter);
      const list = Array.isArray(res.data?.products) ? res.data!.products : [];
      setProducts(list as unknown as TicketProduct[]);
    } catch {
      showToast('Failed to load products', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [search, subtypeFilter]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { showToast('Title is required', 'error'); return; }
    setSaving(true);
    try {
      const subtypeData: Record<string, unknown> = {};
      if (form.subtype === 'meeting') {
        subtypeData.meeting_detail = form.meeting_detail;
        subtypeData.entrance = form.meeting_entrance;
        subtypeData.zone = form.meeting_zone;
      } else if (form.subtype === 'scenic') {
        subtypeData.scenic_name = form.scenic_name;
        subtypeData.opening_hours = form.scenic_opening_hours;
        subtypeData.ticket_class = form.scenic_ticket_class;
        subtypeData.address = form.scenic_address;
      } else if (form.subtype === 'movie') {
        subtypeData.film_title = form.movie_film_title;
        subtypeData.hall = form.movie_hall;
        subtypeData.screening_ts = form.movie_screening_ts;
      } else if (form.subtype === 'transport') {
        subtypeData.origin = form.transport_origin;
        subtypeData.destination = form.transport_destination;
        subtypeData.carrier = form.transport_carrier;
        subtypeData.departure_ts = form.transport_departure_ts;
        subtypeData.arrival_ts = form.transport_arrival_ts;
      }
      await api.tickets.products.create({
        item_id: Number(form.item_id) || 1,
        subtype: form.subtype,
        title: form.title,
        brand_name: form.brand_name,
        notice: form.notice,
        description: form.description,
        code_type: form.code_type,
        validity_mode: form.validity_mode,
        begin_ts: form.validity_mode === 'fixed' ? form.begin_ts : null,
        end_ts: form.validity_mode === 'fixed' ? form.end_ts : null,
        fixed_term_days: form.validity_mode === 'relative' ? Number(form.fixed_term_days) : null,
        quantity: form.quantity ? Number(form.quantity) : null,
        max_per_customer: form.max_per_customer ? Number(form.max_per_customer) : null,
        bind_customer: form.bind_customer,
        transferable: form.transferable,
        refundable: form.refundable,
        refund_window_hours: form.refund_window_hours ? Number(form.refund_window_hours) : null,
        subtype_data: subtypeData,
      });
      showToast('Ticket product created');
      setShowCreate(false);
      setForm(EMPTY_CREATE);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      const res = await api.tickets.products.delete(deleting.ticket_product_id);
      showToast(res.message || 'Deleted');
      setDeleting(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by title or brand..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <select
            value={subtypeFilter}
            onChange={(e) => setSubtypeFilter(e.target.value as '' | Subtype)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">All subtypes</option>
            {(['meeting', 'scenic', 'movie', 'transport'] as Subtype[]).map((s) => (
              <option key={s} value={s}>{SUBTYPE_LABEL[s]}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700"
        >
          <Plus className="h-4 w-4" />
          New product
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-fuchsia-500" />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <Ticket className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No ticket products yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((p) => {
            const Icon = SUBTYPE_ICON[p.subtype];
            return (
              <div key={p.ticket_product_id} className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="inline-flex items-center gap-1 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-bold uppercase text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300">
                      <Icon className="h-3 w-3" /> {SUBTYPE_LABEL[p.subtype]}
                    </p>
                    <h3 className="mt-2 truncate text-lg font-bold text-gray-900 dark:text-white">{p.title}</h3>
                    {p.brand_name && <p className="text-xs text-gray-500">{p.brand_name}</p>}
                  </div>
                  <div
                    aria-hidden
                    className="h-4 w-4 rounded-full ring-2 ring-white shadow"
                    style={{ background: p.color || '#a855f7' }}
                  />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded bg-gray-50 p-2 dark:bg-gray-900/60">
                    <p className="text-gray-500">Stock</p>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {p.quantity === null ? '∞' : `${p.quantity_issued} / ${p.quantity}`}
                    </p>
                  </div>
                  <div className="rounded bg-gray-50 p-2 dark:bg-gray-900/60">
                    <p className="text-gray-500">Sale window</p>
                    <p className={`font-semibold ${p.sale_window_open ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {p.sale_window_open ? 'Open' : 'Closed'}
                    </p>
                  </div>
                  <div className="rounded bg-gray-50 p-2 dark:bg-gray-900/60">
                    <p className="text-gray-500">Validity</p>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {p.validity_mode === 'fixed' ? 'Fixed dates' : 'Relative'}
                    </p>
                  </div>
                  <div className="rounded bg-gray-50 p-2 dark:bg-gray-900/60">
                    <p className="text-gray-500">Refundable</p>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {p.refundable ? 'Yes' : 'No'}
                    </p>
                  </div>
                </div>

                {p.notice && (
                  <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                    ⚠ {p.notice}
                  </p>
                )}

                {p.sold_out && (
                  <p className="mt-2 rounded-lg bg-rose-100 px-3 py-1.5 text-center text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                    Sold out
                  </p>
                )}

                <div className="mt-auto flex gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => setManagingSessions(p)}
                    title="Manage sessions"
                    className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-200 bg-white px-3 py-1.5 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-gray-900 dark:text-fuchsia-300"
                  >
                    <Calendar className="h-3.5 w-3.5" />
                    Sessions
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagingTiers(p)}
                    title="Manage tiers"
                    className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-200 bg-white px-3 py-1.5 text-xs font-semibold text-fuchsia-700 hover:bg-fuchsia-50 dark:border-fuchsia-900 dark:bg-gray-900 dark:text-fuchsia-300"
                  >
                    <Tag className="h-3.5 w-3.5" />
                    Tiers
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(p)}
                    className="ml-auto rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={showCreate} onClose={() => !saving && setShowCreate(false)} title="Create ticket product" size="lg">
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="grid gap-2 md:grid-cols-2">
            <select
              value={form.subtype}
              onChange={(e) => setForm({ ...form, subtype: e.target.value as Subtype })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {(['meeting', 'scenic', 'movie', 'transport'] as Subtype[]).map((s) => (
                <option key={s} value={s}>{SUBTYPE_LABEL[s]}</option>
              ))}
            </select>
            <input
              required
              placeholder="Title *"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              placeholder="Brand name"
              value={form.brand_name}
              onChange={(e) => setForm({ ...form, brand_name: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              type="number"
              placeholder="OSPOS item_id"
              value={form.item_id}
              onChange={(e) => setForm({ ...form, item_id: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              type="number"
              placeholder="Total stock (blank = unlimited)"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              type="number"
              placeholder="Max per customer"
              value={form.max_per_customer}
              onChange={(e) => setForm({ ...form, max_per_customer: e.target.value })}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>

          <textarea
            placeholder="Description"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
          <input
            placeholder="Notice (e.g. Photo ID required)"
            value={form.notice}
            onChange={(e) => setForm({ ...form, notice: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />

          <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Validity</p>
            <select
              value={form.validity_mode}
              onChange={(e) => setForm({ ...form, validity_mode: e.target.value as 'fixed' | 'relative' })}
              className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="fixed">Fixed dates</option>
              <option value="relative">Relative (N days from issue)</option>
            </select>
            {form.validity_mode === 'fixed' ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="datetime-local"
                  value={form.begin_ts}
                  onChange={(e) => setForm({ ...form, begin_ts: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                <input
                  type="datetime-local"
                  value={form.end_ts}
                  onChange={(e) => setForm({ ...form, end_ts: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
            ) : (
              <input
                type="number"
                placeholder="Valid for N days from issue"
                value={form.fixed_term_days}
                onChange={(e) => setForm({ ...form, fixed_term_days: e.target.value })}
                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            )}
          </div>

          {/* Subtype-specific form */}
          <div className="rounded-lg border border-fuchsia-200 bg-fuchsia-50/40 p-3 dark:border-fuchsia-900/40 dark:bg-fuchsia-900/10">
            <p className="text-[10px] font-mono uppercase tracking-widest text-fuchsia-700 dark:text-fuchsia-300">{SUBTYPE_LABEL[form.subtype]} details</p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {form.subtype === 'movie' && (
                <>
                  <input placeholder="Film title" value={form.movie_film_title} onChange={(e) => setForm({ ...form, movie_film_title: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input placeholder="Hall" value={form.movie_hall} onChange={(e) => setForm({ ...form, movie_hall: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input type="datetime-local" placeholder="Screening at" value={form.movie_screening_ts} onChange={(e) => setForm({ ...form, movie_screening_ts: e.target.value })} className="md:col-span-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                </>
              )}
              {form.subtype === 'scenic' && (
                <>
                  <input placeholder="Scenic name" value={form.scenic_name} onChange={(e) => setForm({ ...form, scenic_name: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input placeholder="Ticket class" value={form.scenic_ticket_class} onChange={(e) => setForm({ ...form, scenic_ticket_class: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input placeholder="Opening hours" value={form.scenic_opening_hours} onChange={(e) => setForm({ ...form, scenic_opening_hours: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input placeholder="Address" value={form.scenic_address} onChange={(e) => setForm({ ...form, scenic_address: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                </>
              )}
              {form.subtype === 'meeting' && (
                <>
                  <input placeholder="Entrance" value={form.meeting_entrance} onChange={(e) => setForm({ ...form, meeting_entrance: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input placeholder="Zone" value={form.meeting_zone} onChange={(e) => setForm({ ...form, meeting_zone: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <textarea placeholder="Meeting detail" rows={2} value={form.meeting_detail} onChange={(e) => setForm({ ...form, meeting_detail: e.target.value })} className="md:col-span-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                </>
              )}
              {form.subtype === 'transport' && (
                <>
                  <input placeholder="Origin" value={form.transport_origin} onChange={(e) => setForm({ ...form, transport_origin: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input placeholder="Destination" value={form.transport_destination} onChange={(e) => setForm({ ...form, transport_destination: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input placeholder="Carrier" value={form.transport_carrier} onChange={(e) => setForm({ ...form, transport_carrier: e.target.value })} className="md:col-span-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input type="datetime-local" placeholder="Departure" value={form.transport_departure_ts} onChange={(e) => setForm({ ...form, transport_departure_ts: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                  <input type="datetime-local" placeholder="Arrival" value={form.transport_arrival_ts} onChange={(e) => setForm({ ...form, transport_arrival_ts: e.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
                </>
              )}
            </div>
          </div>

          <div className="flex gap-3 text-xs">
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.bind_customer} onChange={(e) => setForm({ ...form, bind_customer: e.target.checked })} /> Bind to customer</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.transferable} onChange={(e) => setForm({ ...form, transferable: e.target.checked })} /> Transferable</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.refundable} onChange={(e) => setForm({ ...form, refundable: e.target.checked })} /> Refundable</label>
          </div>

          <div className="flex justify-end gap-2 border-t pt-3 dark:border-gray-700">
            <button type="button" onClick={() => !saving && setShowCreate(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium dark:border-gray-700 dark:text-gray-200">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">
              {saving ? 'Creating…' : 'Create product'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title="Delete / archive" size="sm">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {deleting.quantity_issued > 0
                ? `Archive "${deleting.title}"? ${deleting.quantity_issued} tickets have already been issued and will remain readable.`
                : `Delete "${deleting.title}"?`}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-200">Cancel</button>
              <button type="button" onClick={handleDelete} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white">
                {deleting.quantity_issued > 0 ? 'Archive' : 'Delete'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {managingSessions && (
        <SessionsModal product={managingSessions} onClose={() => setManagingSessions(null)} />
      )}
      {managingTiers && (
        <TiersModal product={managingTiers} onClose={() => setManagingTiers(null)} />
      )}
    </div>
  );
}

// ---------- SESSIONS MODAL ----------

function SessionsModal({ product, onClose }: { product: TicketProduct; onClose: () => void }) {
  const [sessions, setSessions] = useState<TicketSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TicketSession | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.tickets.products.sessions.list(product.ticket_product_id);
      setSessions((res.data?.sessions as unknown as TicketSession[]) ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Load failed', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleDelete(s: TicketSession) {
    if (!window.confirm(`Delete session "${s.label ?? s.starts_at}"?`)) return;
    try {
      const res = await api.tickets.products.sessions.delete(product.ticket_product_id, s.session_id);
      showToast(res.message || 'Deleted');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Sessions — ${product.title}`} size="lg">
      <div className="space-y-3">
        <div className="flex justify-between">
          <p className="text-xs text-gray-500">
            Recurring or scheduled occurrences. Each session has its own capacity counter.
          </p>
          <button
            type="button"
            onClick={() => { setEditing(null); setShowCreate(true); }}
            className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New session
          </button>
        </div>

        {loading ? (
          <div className="flex h-24 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-b-2 border-fuchsia-500" /></div>
        ) : sessions.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40">
            No sessions yet. Add one to schedule a showtime or occurrence.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Label</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Starts</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Ends</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Hall / Gate</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Capacity</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {sessions.map((s) => (
                  <tr key={s.session_id}>
                    <td className="px-3 py-2 text-xs">{s.label ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{s.starts_at}</td>
                    <td className="px-3 py-2 text-xs">{s.ends_at ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{[s.hall, s.gate].filter(Boolean).join(' / ') || '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {s.quantity === null ? '∞' : `${s.quantity_issued} / ${s.quantity}`}
                      {s.sold_out && <span className="ml-2 rounded bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">SOLD OUT</span>}
                    </td>
                    <td className="px-3 py-2 text-xs"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      s.status === 'cancelled' ? 'bg-rose-100 text-rose-700' :
                      s.status === 'ended' ? 'bg-gray-100 text-gray-600' :
                      s.status === 'live' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                    }`}>{s.status}</span></td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => { setEditing(s); setShowCreate(true); }} className="text-[11px] font-semibold text-fuchsia-700 hover:underline">Edit</button>
                      <button type="button" onClick={() => handleDelete(s)} className="ml-3 text-[11px] font-semibold text-rose-700 hover:underline">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showCreate && (
          <SessionEditor
            product={product}
            session={editing}
            onClose={() => { setShowCreate(false); setEditing(null); }}
            onSaved={async () => { setShowCreate(false); setEditing(null); await load(); }}
          />
        )}
      </div>
    </Modal>
  );
}

function SessionEditor({ product, session, onClose, onSaved }: { product: TicketProduct; session: TicketSession | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [label, setLabel] = useState(session?.label ?? '');
  const [startsAt, setStartsAt] = useState(session?.starts_at ?? '');
  const [endsAt, setEndsAt] = useState(session?.ends_at ?? '');
  const [quantity, setQuantity] = useState(session?.quantity?.toString() ?? '');
  const [hall, setHall] = useState(session?.hall ?? '');
  const [gate, setGate] = useState(session?.gate ?? '');
  const [status, setStatus] = useState<TicketSession['status']>(session?.status ?? 'scheduled');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!startsAt) { showToast('starts_at is required', 'error'); return; }
    setSaving(true);
    const payload = {
      label: label || null,
      starts_at: startsAt,
      ends_at: endsAt || null,
      quantity: quantity ? Number(quantity) : null,
      hall: hall || null,
      gate: gate || null,
      status,
    };
    try {
      if (session) {
        await api.tickets.products.sessions.update(product.ticket_product_id, session.session_id, payload);
        showToast('Session updated');
      } else {
        await api.tickets.products.sessions.create(product.ticket_product_id, payload);
        showToast('Session created');
      }
      await onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={session ? 'Edit session' : 'New session'} size="md">
      <form onSubmit={handleSubmit} className="space-y-3">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Day 1 Evening)" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        <div className="grid gap-2 md:grid-cols-2">
          <label className="text-xs">
            <span className="text-gray-500">Starts at *</span>
            <input required type="datetime-local" value={startsAt.replace(' ', 'T').slice(0, 16)} onChange={(e) => setStartsAt(e.target.value.replace('T', ' ') + ':00')} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          </label>
          <label className="text-xs">
            <span className="text-gray-500">Ends at</span>
            <input type="datetime-local" value={endsAt ? endsAt.replace(' ', 'T').slice(0, 16) : ''} onChange={(e) => setEndsAt(e.target.value ? e.target.value.replace('T', ' ') + ':00' : '')} className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          </label>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <input value={hall} onChange={(e) => setHall(e.target.value)} placeholder="Hall / Stage" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={gate} onChange={(e) => setGate(e.target.value)} placeholder="Gate / Entrance" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Capacity (blank = ∞)" type="number" min="0" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as TicketSession['status'])} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
          <option value="scheduled">Scheduled</option>
          <option value="live">Live</option>
          <option value="ended">Ended</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-200">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">{saving ? 'Saving…' : (session ? 'Update' : 'Create')}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- TIERS MODAL ----------

function TiersModal({ product, onClose }: { product: TicketProduct; onClose: () => void }) {
  const [tiers, setTiers] = useState<TicketTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<TicketTier | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.tickets.products.tiers.list(product.ticket_product_id);
      setTiers((res.data?.tiers as unknown as TicketTier[]) ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Load failed', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, []);

  async function handleDelete(t: TicketTier) {
    if (!window.confirm(`Delete tier "${t.name}"?`)) return;
    try {
      const res = await api.tickets.products.tiers.delete(product.ticket_product_id, t.tier_id);
      showToast(res.message || 'Deleted');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`Tiers — ${product.title}`} size="lg">
      <div className="space-y-3">
        <div className="flex justify-between">
          <p className="text-xs text-gray-500">
            Multiple SKUs per product (Adult, Child, VIP, Early Bird…). Each tier has its own price and capacity.
          </p>
          <button
            type="button"
            onClick={() => { setEditing(null); setShowCreate(true); }}
            className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-700"
          >
            <Plus className="h-3.5 w-3.5" />
            New tier
          </button>
        </div>

        {loading ? (
          <div className="flex h-24 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-b-2 border-fuchsia-500" /></div>
        ) : tiers.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40">
            No tiers yet. Add one to differentiate Adult / Child / VIP pricing.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/40">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Price</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Capacity</th>
                  <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Sort</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {tiers.map((t) => (
                  <tr key={t.tier_id}>
                    <td className="px-3 py-2 text-xs">
                      {t.color && <span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: t.color || '#a855f7' }} />}
                      <strong>{t.name}</strong>{t.description && <span className="ml-2 text-gray-500">{t.description}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{t.price}</td>
                    <td className="px-3 py-2 text-xs">
                      {t.quantity === null ? '∞' : `${t.quantity_issued} / ${t.quantity}`}
                      {t.sold_out && <span className="ml-2 rounded bg-rose-100 px-1.5 text-[10px] font-bold text-rose-700">SOLD OUT</span>}
                    </td>
                    <td className="px-3 py-2 text-xs">{t.sort_order}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => { setEditing(t); setShowCreate(true); }} className="text-[11px] font-semibold text-fuchsia-700 hover:underline">Edit</button>
                      <button type="button" onClick={() => handleDelete(t)} className="ml-3 text-[11px] font-semibold text-rose-700 hover:underline">Del</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showCreate && (
          <TierEditor
            product={product}
            tier={editing}
            onClose={() => { setShowCreate(false); setEditing(null); }}
            onSaved={async () => { setShowCreate(false); setEditing(null); await load(); }}
          />
        )}
      </div>
    </Modal>
  );
}

function TierEditor({ product, tier, onClose, onSaved }: { product: TicketProduct; tier: TicketTier | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(tier?.name ?? '');
  const [price, setPrice] = useState(tier?.price ?? '0.00');
  const [quantity, setQuantity] = useState(tier?.quantity?.toString() ?? '');
  const [sortOrder, setSortOrder] = useState(tier?.sort_order?.toString() ?? '0');
  const [color, setColor] = useState(tier?.color ?? '');
  const [description, setDescription] = useState(tier?.description ?? '');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { showToast('name is required', 'error'); return; }
    setSaving(true);
    const payload = {
      name,
      price,
      quantity: quantity ? Number(quantity) : null,
      sort_order: Number(sortOrder) || 0,
      color: color || null,
      description: description || null,
    };
    try {
      if (tier) {
        await api.tickets.products.tiers.update(product.ticket_product_id, tier.tier_id, payload);
        showToast('Tier updated');
      } else {
        await api.tickets.products.tiers.create(product.ticket_product_id, payload);
        showToast('Tier created');
      }
      await onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={tier ? 'Edit tier' : 'New tier'} size="md">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-2 md:grid-cols-2">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Adult, VIP)" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (e.g. 25.00)" inputMode="decimal" pattern="^\d+(\.\d{1,2})?$" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Capacity (blank = ∞)" type="number" min="0" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} placeholder="Sort order" type="number" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={color} onChange={(e) => setColor(e.target.value)} placeholder="Color (e.g. Color030)" maxLength={16} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        </div>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" maxLength={255} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-200">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">{saving ? 'Saving…' : (tier ? 'Update' : 'Create')}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- INSTANCES TAB ----------

function InstancesTab() {
  const [tickets, setTickets] = useState<TicketInstance[]>([]);
  const [products, setProducts] = useState<TicketProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [productFilter, setProductFilter] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'' | Status>('');
  const [showIssue, setShowIssue] = useState(false);
  const [issueProductId, setIssueProductId] = useState(0);
  const [issueReason, setIssueReason] = useState('comp');
  const [issueSeatRow, setIssueSeatRow] = useState('');
  const [issueSeatNumber, setIssueSeatNumber] = useState('');
  const [issueSessions, setIssueSessions] = useState<TicketSession[]>([]);
  const [issueTiers, setIssueTiers] = useState<TicketTier[]>([]);
  const [issueSessionId, setIssueSessionId] = useState(0);
  const [issueTierId, setIssueTierId] = useState(0);
  const [issuing, setIssuing] = useState(false);
  const [detail, setDetail] = useState<{ ticket: TicketInstance; redemptions: RedemptionLog[]; qrSvg?: string; qrUrl?: string } | null>(null);

  // Phase 2: reload sessions/tiers whenever the issue product changes
  useEffect(() => {
    if (issueProductId <= 0) {
      setIssueSessions([]); setIssueTiers([]); setIssueSessionId(0); setIssueTierId(0);
      return;
    }
    void (async () => {
      try {
        const [sRes, tRes] = await Promise.all([
          api.tickets.products.sessions.list(issueProductId),
          api.tickets.products.tiers.list(issueProductId),
        ]);
        setIssueSessions((sRes.data?.sessions as unknown as TicketSession[]) ?? []);
        setIssueTiers((tRes.data?.tiers as unknown as TicketTier[]) ?? []);
        setIssueSessionId(0); setIssueTierId(0);
      } catch {
        setIssueSessions([]); setIssueTiers([]);
      }
    })();
  }, [issueProductId]);

  async function loadAll() {
    setLoading(true);
    try {
      const [tRes, pRes] = await Promise.all([
        api.tickets.list(1, 100, productFilter, statusFilter, 0),
        api.tickets.products.list(1, 100, '', ''),
      ]);
      setTickets((tRes.data?.tickets as unknown as TicketInstance[]) ?? []);
      setProducts((pRes.data?.products as unknown as TicketProduct[]) ?? []);
    } catch {
      showToast('Failed to load tickets', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void loadAll(); /* eslint-disable-next-line */ }, [productFilter, statusFilter]);

  async function handleIssue(e: FormEvent) {
    e.preventDefault();
    if (!issueProductId) { showToast('Pick a product', 'error'); return; }
    setIssuing(true);
    try {
      const body: Record<string, unknown> = { ticket_product_id: issueProductId, issuance_reason: issueReason };
      if (issueSessionId > 0) body.session_id = issueSessionId;
      if (issueTierId > 0) body.tier_id = issueTierId;
      if (issueSeatRow && issueSeatNumber) {
        body.seat_assignment = { row: issueSeatRow, seat: issueSeatNumber };
      }
      const res = await api.tickets.issue(body);
      const newTicket = res.data?.ticket as unknown as TicketInstance | undefined;
      showToast(`Issued ${newTicket?.code ?? 'ticket'}`);
      setShowIssue(false);
      setIssueProductId(0);
      setIssueSessionId(0);
      setIssueTierId(0);
      setIssueSeatRow('');
      setIssueSeatNumber('');
      await loadAll();
      if (newTicket) await openDetail(newTicket);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Issue failed', 'error');
    } finally {
      setIssuing(false);
    }
  }

  async function openDetail(t: TicketInstance) {
    try {
      const [det, qr] = await Promise.all([
        api.tickets.get(t.ticket_id),
        api.tickets.qr(t.ticket_id),
      ]);
      const ticket = (det.data?.ticket as unknown as TicketInstance) ?? t;
      const redemptions = (det.data?.redemptions as unknown as RedemptionLog[]) ?? [];
      const qrSvg = qr.data?.svg as unknown as string | undefined;
      const qrUrl = qr.data?.url as unknown as string | undefined;
      setDetail({ ticket, redemptions, qrSvg, qrUrl });
    } catch {
      setDetail({ ticket: t, redemptions: [] });
    }
  }

  async function refreshDetail() {
    if (!detail) return;
    await openDetail(detail.ticket);
    await loadAll();
  }

  async function action(target: 'revoke' | 'refund', reason: string) {
    if (!detail) return;
    try {
      if (target === 'revoke') {
        await api.tickets.revoke(detail.ticket.ticket_id, { reason });
        showToast('Revoked');
      } else {
        const res = await api.tickets.refund(detail.ticket.ticket_id, { reason });
        const data = res.data as { refund_amount?: string; reversed_tenders?: Array<{ payment_type: string; amount: string; kind: string; txn_status: string }> } | undefined;
        const amount = data?.refund_amount ?? '0.00';
        const tenders = data?.reversed_tenders ?? [];
        if (tenders.length === 0) {
          showToast(`Refunded (manual issuance — no tender to reverse)`);
        } else {
          const summary = tenders
            .map((t) => `${t.payment_type} ${t.amount} (${t.kind === 'mno' ? '✓' : 'pending'})`)
            .join(' · ');
          showToast(`Refunded ${amount} — ${summary}`);
        }
      }
      await refreshDetail();
    } catch (err) {
      showToast(err instanceof Error ? err.message : `${target} failed`, 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(Number(e.target.value))}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        >
          <option value={0}>All products</option>
          {products.map((p) => (
            <option key={p.ticket_product_id} value={p.ticket_product_id}>{p.title}</option>
          ))}
        </select>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {(['', 'issued', 'active', 'redeemed', 'refunded', 'revoked', 'expired'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s as '' | Status)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold capitalize ${
                statusFilter === s
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300'
              }`}
            >
              {s === '' ? 'All' : s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowIssue(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700"
        >
          <Plus className="h-4 w-4" />
          Issue ticket
        </button>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-fuchsia-500" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <Ticket className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No tickets issued yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/40">
              <tr>
                <th className="px-4 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Code</th>
                <th className="px-4 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Product</th>
                <th className="px-4 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Status</th>
                <th className="px-4 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Valid</th>
                <th className="px-4 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Issued</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {tickets.map((t) => {
                const style = STATUS_STYLE[t.status];
                return (
                  <tr key={t.ticket_id} onClick={() => openDetail(t)} className="cursor-pointer hover:bg-fuchsia-50/40 dark:hover:bg-fuchsia-900/10">
                    <td className="px-4 py-2 font-mono text-xs">{t.masked_code}</td>
                    <td className="px-4 py-2"><span className="text-xs font-medium text-gray-900 dark:text-white">{t.product_title}</span><br /><span className="text-[10px] text-gray-500">{t.subtype ? SUBTYPE_LABEL[t.subtype] : ''}</span></td>
                    <td className="px-4 py-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>{style.label}</span></td>
                    <td className="px-4 py-2 text-[11px] text-gray-500">{t.valid_from?.slice(0, 10) ?? '—'} → {t.valid_to?.slice(0, 10) ?? '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-gray-500">{formatRelative(t.issued_at)}</td>
                    <td className="px-4 py-2 text-right"><ChevronRight className="inline h-4 w-4 text-gray-400" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={showIssue} onClose={() => !issuing && setShowIssue(false)} title="Issue ticket manually" size="md">
        <form onSubmit={handleIssue} className="space-y-3">
          <select
            value={issueProductId}
            onChange={(e) => setIssueProductId(Number(e.target.value))}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            required
          >
            <option value={0}>— Choose product —</option>
            {products.map((p) => (
              <option key={p.ticket_product_id} value={p.ticket_product_id} disabled={p.sold_out}>
                {p.title} {p.sold_out ? '(SOLD OUT)' : ''}
              </option>
            ))}
          </select>
          <select
            value={issueReason}
            onChange={(e) => setIssueReason(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="comp">Comp / VIP gift</option>
            <option value="replacement">Replacement (lost ticket)</option>
            <option value="gift">Gift</option>
            <option value="test">Test</option>
            <option value="manual">Manual (other)</option>
          </select>
          {issueSessions.length > 0 && (
            <select
              value={issueSessionId}
              onChange={(e) => setIssueSessionId(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value={0}>— Session (optional) —</option>
              {issueSessions.map((s) => (
                <option key={s.session_id} value={s.session_id} disabled={s.sold_out || s.status === 'cancelled' || s.status === 'ended'}>
                  {(s.label ? `${s.label} — ` : '') + s.starts_at}
                  {s.quantity !== null ? ` (${s.quantity_issued}/${s.quantity})` : ''}
                  {s.sold_out ? ' SOLD OUT' : ''}
                </option>
              ))}
            </select>
          )}
          {issueTiers.length > 0 && (
            <select
              value={issueTierId}
              onChange={(e) => setIssueTierId(Number(e.target.value))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value={0}>— Tier (optional) —</option>
              {issueTiers.map((t) => (
                <option key={t.tier_id} value={t.tier_id} disabled={t.sold_out}>
                  {t.name} — {t.price}
                  {t.quantity !== null ? ` (${t.quantity_issued}/${t.quantity})` : ''}
                  {t.sold_out ? ' SOLD OUT' : ''}
                </option>
              ))}
            </select>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Seat row (optional)"
              value={issueSeatRow}
              onChange={(e) => setIssueSeatRow(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
            <input
              placeholder="Seat number"
              value={issueSeatNumber}
              onChange={(e) => setIssueSeatNumber(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => !issuing && setShowIssue(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-200">Cancel</button>
            <button type="submit" disabled={issuing} className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">
              {issuing ? 'Issuing…' : 'Issue'}
            </button>
          </div>
        </form>
      </Modal>

      {detail && (
        <Modal isOpen={true} onClose={() => setDetail(null)} title={`Ticket ${detail.ticket.masked_code}`} size="lg">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-[200px_1fr]">
              <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                <div className="aspect-square w-full bg-white p-2">
                  {detail.qrUrl ? (
                    <QRCode value={detail.qrUrl} size={170} style={{ width: '100%', height: '100%' }} />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-gray-500">No QR</div>
                  )}
                </div>
                <p className="mt-2 text-center font-mono text-[10px] text-gray-500">{detail.ticket.code}</p>
              </div>

              <div className="space-y-2">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Product</p>
                  <p className="text-lg font-bold text-gray-900 dark:text-white">{detail.ticket.product_title}</p>
                  <p className="text-xs text-gray-500">{detail.ticket.subtype ? SUBTYPE_LABEL[detail.ticket.subtype] : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[detail.ticket.status].badge}`}>{STATUS_STYLE[detail.ticket.status].label}</span>
                  <span className="text-[11px] text-gray-500">{detail.ticket.redeem_count} redemption(s)</span>
                </div>
                <div className="text-[11px] text-gray-500">
                  <p>Valid: {detail.ticket.valid_from?.slice(0, 16)} → {detail.ticket.valid_to?.slice(0, 16)}</p>
                  <p>Issued {formatRelative(detail.ticket.issued_at)}</p>
                  {detail.ticket.seat_assignment_json && (
                    <p>Seat: <span className="font-mono">{detail.ticket.seat_assignment_json}</span></p>
                  )}
                </div>
                <a className="block text-[10px] text-blue-600 hover:underline" href={`/ticket/${detail.ticket.code}`} target="_blank" rel="noreferrer">
                  /ticket/{detail.ticket.masked_code} ↗
                </a>
              </div>
            </div>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => action('revoke', 'Operator revoked')} disabled={!['issued', 'active'].includes(detail.ticket.status)} className="rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300">Revoke</button>
              <button type="button" onClick={() => action('refund', 'Operator refunded')} disabled={!['issued', 'active'].includes(detail.ticket.status)} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-900 dark:bg-gray-900 dark:text-amber-300">Refund</button>
            </div>

            {/* Redemption log */}
            <div className="rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-700">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">Redemption attempts ({detail.redemptions.length})</p>
              </div>
              {detail.redemptions.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-gray-500">No attempts yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                  {detail.redemptions.map((r) => {
                    const ok = r.result === 'ok';
                    return (
                      <li key={r.redemption_id} className="flex items-center gap-3 px-3 py-2 text-xs">
                        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-rose-600" />}
                        <div className="flex-1">
                          <p className={`font-semibold ${ok ? 'text-emerald-700' : 'text-rose-700'} dark:text-${ok ? 'emerald' : 'rose'}-300`}>{r.result.replace(/_/g, ' ')}</p>
                          {r.notes && <p className="text-[10px] text-gray-500">{r.notes}</p>}
                        </div>
                        <p className="text-[10px] text-gray-400">{formatRelative(r.occurred_at)}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- REDEEM TAB ----------

function RedeemTab() {
  const [input, setInput] = useState('');
  const [last, setLast] = useState<{ result: RedeemResult; message: string; ticket?: TicketInstance | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function go(e?: FormEvent) {
    e?.preventDefault();
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      const res = await api.tickets.redeem({ token: input.trim(), idempotency_key: `ui-${Date.now()}` });
      const d = res.data as unknown as { result: RedeemResult; message: string; ticket: TicketInstance | null } | undefined;
      if (d) setLast(d);
      setInput('');
    } catch (err) {
      setLast({ result: 'invalid_signature', message: err instanceof Error ? err.message : 'Redemption failed', ticket: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={go} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Scan or paste</p>
        <div className="mt-2 flex gap-2">
          <div className="relative flex-1">
            <ScanLine className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-fuchsia-500" />
            <input
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Paste JWT, full /ticket URL, or short code…"
              className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 font-mono text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <button type="submit" disabled={!input.trim() || busy} className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-600 px-5 py-3 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">
            <Zap className="h-4 w-4" />
            {busy ? 'Verifying…' : 'Redeem'}
          </button>
        </div>
        <p className="mt-2 text-[10px] text-gray-500">
          Accepts raw JWT, full <code>/ticket/&lt;token&gt;</code> URL, or short ticket code (e.g. <code>AN6N2YPQ2DCZ</code>).
        </p>
      </form>

      {last && (
        <div className={`rounded-3xl border-2 p-6 text-center shadow-lg ${
          last.result === 'ok'
            ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/30'
            : ['expired', 'not_yet_valid', 'wrong_location'].includes(last.result)
              ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/30'
              : 'border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-900/30'
        }`}>
          {(() => {
            const meta = REDEEM_RESULT_STYLE[last.result];
            const Icon = meta.icon;
            return (
              <>
                <Icon className={`mx-auto h-20 w-20 ${
                  last.result === 'ok' ? 'text-emerald-600' :
                  ['expired', 'not_yet_valid', 'wrong_location'].includes(last.result) ? 'text-amber-600' : 'text-rose-600'
                }`} />
                <p className={`mt-3 text-2xl font-bold ${
                  last.result === 'ok' ? 'text-emerald-800 dark:text-emerald-200' :
                  ['expired', 'not_yet_valid', 'wrong_location'].includes(last.result) ? 'text-amber-800 dark:text-amber-200' : 'text-rose-800 dark:text-rose-200'
                }`}>{meta.label}</p>
              </>
            );
          })()}
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{last.message}</p>
          {last.ticket && (
            <div className="mt-4 rounded-xl bg-white/80 p-3 text-left text-xs dark:bg-gray-900/60">
              <p className="font-bold text-gray-900 dark:text-white">{last.ticket.product_title}</p>
              <p className="font-mono text-[10px] text-gray-500">{last.ticket.code}</p>
              {last.ticket.subtype && <p className="text-[10px] text-gray-500">{SUBTYPE_LABEL[last.ticket.subtype]}</p>}
              {last.ticket.seat_assignment_json && (
                <p className="mt-1 text-[10px] text-gray-500">Seat: {last.ticket.seat_assignment_json}</p>
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-center text-[10px] text-gray-400">
        <QrCode className="mr-1 inline h-3 w-3" />
        Bring the customer's QR within your scanner/camera. Pasted text also works.
      </p>
    </div>
  );
}
