/**
 * ItemKitsPage — full CRUD over OSPOS item_kits + item_kit_items, exposing
 * every option the backend supports:
 *
 *   - Basic:      name, kit number, description
 *   - Pricing:    kit_discount + kit_discount_type (percent / fixed)
 *   - Behaviour:  price_option (sum of items / kit price only / kit + stock items)
 *                 print_option (print all / priced only / kit name only)
 *   - Composition: searchable item picker — add child items with quantity +
 *                 sequence; backend validates item_id FK and replaces children
 *                 atomically in a transaction on every save.
 *
 * Empty/loading/error states. Falls back to mock data only if the API is
 * unreachable (not for empty list — empty list shows an empty-state).
 */

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Boxes,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';
import type { Item } from '../types';

type DiscountType = 0 | 1;       // 0 = PERCENT, 1 = FIXED
type PriceOption = 0 | 1 | 2;    // 0 = sum of items, 1 = kit only, 2 = kit + stock
type PrintOption = 0 | 1 | 2;    // 0 = all, 1 = priced only, 2 = kit name only

interface KitChildRaw {
  item_id: number | string;
  item_name?: string;
  item_number?: string | null;
  quantity: number | string;
  kit_sequence?: number | string;
  unit_price?: number | string | null;
}

interface KitChild {
  item_id: number;
  item_name: string;
  item_number: string | null;
  unit_price: number;
  quantity: number;
  kit_sequence: number;
}

interface ItemKit {
  item_kit_id: number;
  item_kit_number: string | null;
  name: string;
  description: string;
  kit_discount: number;
  kit_discount_type: DiscountType;
  price_option: PriceOption;
  print_option: PrintOption;
  item_count: number;
  individual_total: number;
  kit_price: number;
}

interface ItemKitForm {
  name: string;
  item_kit_number: string;
  description: string;
  kit_discount: string;
  kit_discount_type: DiscountType;
  price_option: PriceOption;
  print_option: PrintOption;
  items: KitChild[];
}

const EMPTY_FORM: ItemKitForm = {
  name: '',
  item_kit_number: '',
  description: '',
  kit_discount: '0',
  kit_discount_type: 0,
  price_option: 0,
  print_option: 0,
  items: [],
};

const PRICE_OPTION_LABELS: Record<PriceOption, string> = {
  0: 'Sum of items',
  1: 'Kit price only',
  2: 'Kit + stock items',
};

const PRINT_OPTION_LABELS: Record<PrintOption, string> = {
  0: 'Print all',
  1: 'Print priced only',
  2: 'Print kit name only',
};

const MOCK_KITS: ItemKit[] = [
  {
    item_kit_id: -1,
    item_kit_number: 'K-DEMO-1',
    name: 'Breakfast Bundle (demo)',
    description: 'Cappuccino + croissant + juice',
    kit_discount: 15,
    kit_discount_type: 0,
    price_option: 0,
    print_option: 0,
    item_count: 3,
    individual_total: 13.75,
    kit_price: 11.69,
  },
];

function normalizeKit(raw: Record<string, unknown>): ItemKit {
  return {
    item_kit_id: Number(raw.item_kit_id ?? 0),
    item_kit_number: raw.item_kit_number == null ? null : String(raw.item_kit_number),
    name: String(raw.name ?? 'Untitled kit'),
    description: String(raw.description ?? ''),
    kit_discount: Number(raw.kit_discount ?? 0),
    kit_discount_type: (Number(raw.kit_discount_type ?? 0) === 1 ? 1 : 0) as DiscountType,
    price_option: (Math.min(2, Math.max(0, Number(raw.price_option ?? 0))) as PriceOption),
    print_option: (Math.min(2, Math.max(0, Number(raw.print_option ?? 0))) as PrintOption),
    item_count: Number(raw.item_count ?? 0),
    individual_total: Number(raw.individual_total ?? 0),
    kit_price: Number(raw.kit_price ?? 0),
  };
}

function normalizeKitChild(raw: KitChildRaw): KitChild {
  return {
    item_id: Number(raw.item_id),
    item_name: String(raw.item_name ?? `Item ${raw.item_id}`),
    item_number: raw.item_number == null ? null : String(raw.item_number),
    unit_price: Number(raw.unit_price ?? 0),
    quantity: Number(raw.quantity ?? 1),
    kit_sequence: Number(raw.kit_sequence ?? 0),
  };
}

export function ItemKitsPage() {
  const [kits, setKits] = useState<ItemKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<ItemKit | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ItemKitForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState<ItemKit | null>(null);

  async function loadKits() {
    setLoading(true);
    try {
      const res = await api.itemKits.list(1, 50, search);
      const raw = Array.isArray(res.data?.item_kits) ? res.data!.item_kits! : [];
      setKits(raw.map((r) => normalizeKit(r as Record<string, unknown>)));
      setUsingMock(false);
    } catch {
      setKits(MOCK_KITS);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadKits();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  async function openEdit(kit: ItemKit) {
    setEditing(kit);
    setShowForm(true);
    try {
      const res = await api.itemKits.get(kit.item_kit_id);
      const data = res.data;
      if (!data) return;
      const k = data.item_kit as unknown as Record<string, unknown>;
      const items = (data.items as unknown as KitChildRaw[]).map(normalizeKitChild);
      setForm({
        name: String(k.name ?? ''),
        item_kit_number: k.item_kit_number == null ? '' : String(k.item_kit_number),
        description: String(k.description ?? ''),
        kit_discount: String(k.kit_discount ?? 0),
        kit_discount_type: (Number(k.kit_discount_type ?? 0) === 1 ? 1 : 0) as DiscountType,
        price_option: (Math.min(2, Math.max(0, Number(k.price_option ?? 0))) as PriceOption),
        print_option: (Math.min(2, Math.max(0, Number(k.print_option ?? 0))) as PrintOption),
        items,
      });
    } catch {
      showToast('Failed to load kit details', 'error');
    }
  }

  function closeForm() {
    if (saving) return;
    setShowForm(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      showToast('Kit name is required', 'error');
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      item_kit_number: form.item_kit_number.trim(),
      description: form.description.trim(),
      kit_discount: Number(form.kit_discount) || 0,
      kit_discount_type: form.kit_discount_type,
      price_option: form.price_option,
      print_option: form.print_option,
      items: form.items.map((c, idx) => ({
        item_id: c.item_id,
        quantity: c.quantity,
        kit_sequence: idx,
      })),
    };
    try {
      if (editing) {
        await api.itemKits.update(editing.item_kit_id, payload);
        showToast('Kit updated');
      } else {
        await api.itemKits.create(payload);
        showToast('Kit created');
      }
      setShowForm(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await loadKits();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      showToast(msg, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    try {
      await api.itemKits.delete(deleting.item_kit_id);
      showToast('Kit deleted');
      setDeleting(null);
      await loadKits();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      showToast(msg, 'error');
    }
  }

  // Live preview of pricing from form state (so the operator sees the
  // discount applied as they type).
  const formPricing = useMemo(() => {
    const sum = form.items.reduce((s, c) => s + c.unit_price * c.quantity, 0);
    const discount = Number(form.kit_discount) || 0;
    let kitPrice = sum;
    if (discount > 0) {
      kitPrice -= form.kit_discount_type === 0 ? sum * (discount / 100) : discount;
    }
    if (kitPrice < 0) kitPrice = 0;
    return { sum: round2(sum), kitPrice: round2(kitPrice) };
  }, [form.items, form.kit_discount, form.kit_discount_type]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Item Kits</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Bundle multiple items into a single sellable kit with discount + pricing rules.
            {usingMock && <span className="ml-2 text-amber-600 dark:text-amber-400">(demo data — API unreachable)</span>}
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          Create Kit
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search kits by name, kit number, or description..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : kits.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <Boxes className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-500">No kits yet. Create one to bundle items at a discount.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            <Plus className="h-4 w-4" />
            Create your first kit
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {kits.map((kit) => {
            const savings = kit.individual_total - kit.kit_price;
            const savingsPct = kit.individual_total > 0
              ? Math.round((savings / kit.individual_total) * 100)
              : 0;
            return (
              <div
                key={kit.item_kit_id}
                className="flex flex-col rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {kit.item_kit_number && (
                      <div className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        {kit.item_kit_number}
                      </div>
                    )}
                    <h2 className="mt-2 truncate text-lg font-semibold text-gray-900 dark:text-white" title={kit.name}>
                      {kit.name}
                    </h2>
                    {kit.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{kit.description}</p>
                    )}
                  </div>
                  <div className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                    <Boxes className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/60">
                    <p className="text-gray-500">Items</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{kit.item_count}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/60">
                    <p className="text-gray-500">Discount</p>
                    <p className="font-semibold text-gray-900 dark:text-white">
                      {kit.kit_discount > 0
                        ? kit.kit_discount_type === 0
                          ? `${kit.kit_discount}%`
                          : formatCurrency(kit.kit_discount)
                        : '—'}
                    </p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/60">
                    <p className="text-gray-500">Pricing</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{PRICE_OPTION_LABELS[kit.price_option]}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/60">
                    <p className="text-gray-500">Receipt</p>
                    <p className="font-semibold text-gray-900 dark:text-white">{PRINT_OPTION_LABELS[kit.print_option]}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900 dark:bg-emerald-900/10">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Kit price</span>
                    <span className="font-bold text-gray-900 dark:text-white">{formatCurrency(kit.kit_price)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-gray-500 dark:text-gray-400">Individual total</span>
                    <span className="font-medium text-gray-700 line-through dark:text-gray-300">{formatCurrency(kit.individual_total)}</span>
                  </div>
                  {savings > 0 && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <Tag className="h-3 w-3" />
                      Save {formatCurrency(savings)} ({savingsPct}%) per kit
                    </div>
                  )}
                </div>

                <div className="mt-auto flex gap-2 pt-4">
                  <button
                    type="button"
                    onClick={() => openEdit(kit)}
                    disabled={kit.item_kit_id < 0}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(kit)}
                    disabled={kit.item_kit_id < 0}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-900/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      <Modal
        isOpen={showForm}
        onClose={closeForm}
        title={editing ? `Edit kit: ${editing.name}` : 'Create new kit'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
                Kit name <span className="text-rose-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                maxLength={255}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Kit number (optional)</label>
              <input
                value={form.item_kit_number}
                onChange={(e) => setForm({ ...form, item_kit_number: e.target.value })}
                maxLength={255}
                placeholder="e.g. K-001"
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              maxLength={255}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Discount</label>
              <div className="mt-1 flex gap-2">
                <input
                  type="number"
                  value={form.kit_discount}
                  onChange={(e) => setForm({ ...form, kit_discount: e.target.value })}
                  min={0}
                  step="0.01"
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                <select
                  value={form.kit_discount_type}
                  onChange={(e) => setForm({ ...form, kit_discount_type: Number(e.target.value) as DiscountType })}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value={0}>%</option>
                  <option value={1}>fixed</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Price option</label>
              <select
                value={form.price_option}
                onChange={(e) => setForm({ ...form, price_option: Number(e.target.value) as PriceOption })}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                <option value={0}>Sum of items (discount applied)</option>
                <option value={1}>Kit price only</option>
                <option value={2}>Kit + stock items</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">Receipt option</label>
              <select
                value={form.print_option}
                onChange={(e) => setForm({ ...form, print_option: Number(e.target.value) as PrintOption })}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                <option value={0}>Print all child items</option>
                <option value={1}>Print priced items only</option>
                <option value={2}>Print kit name only</option>
              </select>
            </div>
          </div>

          <ItemPicker
            selected={form.items}
            onChange={(items) => setForm({ ...form, items })}
          />

          <div className="flex items-center justify-between rounded-xl bg-emerald-50 px-4 py-3 dark:bg-emerald-900/20">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                Live preview
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Individual total: <span className="font-semibold line-through">{formatCurrency(formPricing.sum)}</span>
              </p>
            </div>
            <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-300">{formatCurrency(formPricing.kitPrice)}</p>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              type="button"
              onClick={closeForm}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create kit'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm modal */}
      <Modal
        isOpen={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete kit"
        size="sm"
      >
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Delete <span className="font-semibold">{deleting.name}</span>? Its{' '}
              {deleting.item_count} child item link{deleting.item_count === 1 ? '' : 's'} will be removed.
              Items themselves stay in the catalogue.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleting(null)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700"
              >
                Delete kit
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------- helpers ----------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface ItemPickerProps {
  selected: KitChild[];
  onChange: (next: KitChild[]) => void;
}

function ItemPicker({ selected, onChange }: ItemPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await api.items.list(1, 10, query.trim());
        if (cancelled) return;
        const list = (res.data?.items ?? []) as Item[];
        setResults(list);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query]);

  function addItem(item: Item) {
    if (selected.some((s) => s.item_id === item.item_id)) {
      showToast('Already added — adjust quantity instead', 'error');
      return;
    }
    onChange([
      ...selected,
      {
        item_id: item.item_id,
        item_name: item.name,
        item_number: null,
        unit_price: Number(item.unit_price ?? 0),
        quantity: 1,
        kit_sequence: selected.length,
      },
    ]);
    setQuery('');
    setResults([]);
  }

  function updateQuantity(itemId: number, qty: number) {
    if (qty <= 0) {
      onChange(selected.filter((s) => s.item_id !== itemId));
      return;
    }
    onChange(selected.map((s) => (s.item_id === itemId ? { ...s, quantity: qty } : s)));
  }

  function removeItem(itemId: number) {
    onChange(selected.filter((s) => s.item_id !== itemId));
  }

  function reorder(itemId: number, delta: -1 | 1) {
    const idx = selected.findIndex((s) => s.item_id === itemId);
    if (idx < 0) return;
    const target = idx + delta;
    if (target < 0 || target >= selected.length) return;
    const next = [...selected];
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next);
  }

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
        Kit composition ({selected.length} item{selected.length === 1 ? '' : 's'})
      </p>

      <div className="relative mt-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search items by name to add..."
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
        />
        {(results.length > 0 || searching) && (
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {searching && (
              <p className="px-3 py-2 text-xs text-gray-500">Searching…</p>
            )}
            {results.map((it) => (
              <button
                key={it.item_id}
                type="button"
                onClick={() => addItem(it)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-blue-50 dark:hover:bg-blue-900/30"
              >
                <span className="truncate text-gray-800 dark:text-gray-100">{it.name}</span>
                <span className="ml-2 shrink-0 font-mono text-xs text-gray-500">
                  {formatCurrency(Number(it.unit_price ?? 0))}
                </span>
              </button>
            ))}
            {!searching && results.length === 0 && query.length >= 2 && (
              <p className="px-3 py-2 text-xs text-gray-500">No items match "{query}".</p>
            )}
          </div>
        )}
      </div>

      {selected.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-500 dark:border-gray-700">
          No items yet. A kit needs at least one item to be useful.
        </p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {selected.map((c, idx) => (
            <div
              key={c.item_id}
              className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-1.5 text-sm dark:bg-gray-900/60"
            >
              <span className="w-5 text-center text-[10px] font-mono text-gray-500">{idx + 1}</span>
              <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-100" title={c.item_name}>
                {c.item_name}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-gray-500">
                {formatCurrency(c.unit_price)}
              </span>
              <input
                type="number"
                value={c.quantity}
                onChange={(e) => updateQuantity(c.item_id, Number(e.target.value))}
                step="0.01"
                min={0}
                className="w-16 rounded border border-gray-200 bg-white px-2 py-1 text-right text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => reorder(c.item_id, -1)}
                  disabled={idx === 0}
                  aria-label="Move up"
                  className="text-[10px] text-gray-500 hover:text-gray-800 disabled:opacity-30 dark:hover:text-gray-200"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => reorder(c.item_id, 1)}
                  disabled={idx === selected.length - 1}
                  aria-label="Move down"
                  className="text-[10px] text-gray-500 hover:text-gray-800 disabled:opacity-30 dark:hover:text-gray-200"
                >
                  ▼
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeItem(c.item_id)}
                aria-label="Remove from kit"
                className="rounded p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
