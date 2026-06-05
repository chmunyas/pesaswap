/**
 * GiftCardDenominationsPage — admin CRUD for preset gift-card amounts per
 * currency. Surfaces as quick-pick chips in the GiftCardsPage create modal.
 *
 * Note: when a card is issued with a denomination, the amount + label are
 * SNAPSHOTTED onto the giftcard row (denomination_amount_snapshot /
 * denomination_label_snapshot) so later edits here never rewrite history.
 *
 * Reachable from the Office sidebar group.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Coins, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';
import { api } from '../lib/api';

interface Denomination {
  denomination_id: number;
  currency: string;
  amount: number;
  label: string | null;
  description: string | null;
  active: boolean;
  sort_order: number;
}

const EMPTY: Denomination = {
  denomination_id: 0,
  currency: 'KES',
  amount: 0,
  label: '',
  description: '',
  active: true,
  sort_order: 0,
};

const CURRENCIES = ['KES', 'USD', 'EUR', 'GBP', 'NGN', 'UGX', 'TZS'];

function normalize(raw: Record<string, unknown>): Denomination {
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

export function GiftCardDenominationsPage() {
  const [rows, setRows] = useState<Denomination[]>([]);
  const [loading, setLoading] = useState(true);
  const [currencyFilter, setCurrencyFilter] = useState<string>('');
  const [editing, setEditing] = useState<Denomination | null>(null);
  const [deleting, setDeleting] = useState<Denomination | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.giftcards.denominations.list(currencyFilter || undefined);
      const list = Array.isArray(res.data?.denominations) ? res.data!.denominations : [];
      setRows(list.map((r) => normalize(r as Record<string, unknown>)));
    } catch {
      showToast('Failed to load denominations', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencyFilter]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (editing.amount <= 0) {
      showToast('Amount must be positive', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        currency: editing.currency,
        amount: editing.amount,
        label: editing.label || undefined,
        description: editing.description || undefined,
        active: editing.active,
        sort_order: editing.sort_order,
      };
      if (editing.denomination_id > 0) {
        await api.giftcards.denominations.update(editing.denomination_id, payload);
        showToast('Denomination updated');
      } else {
        await api.giftcards.denominations.create(payload);
        showToast('Denomination created');
      }
      setEditing(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.giftcards.denominations.delete(deleting.denomination_id);
      showToast('Denomination removed');
      setDeleting(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <Coins className="h-6 w-6" /> Gift Card Denominations
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Preset amounts shown as quick-pick chips when issuing a card. Snapshotted onto the card so later edits don't rewrite history.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY })}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" /> New Denomination
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setCurrencyFilter('')} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${currencyFilter === '' ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-300'}`}>All</button>
        {CURRENCIES.map((c) => (
          <button key={c} type="button" onClick={() => setCurrencyFilter(c)} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${currencyFilter === c ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-300'}`}>{c}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <Coins className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-500">No denominations yet — add some to enable quick-pick.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-[10px] font-mono uppercase tracking-widest text-gray-500 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Sort</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {rows.map((r) => (
                <tr key={r.denomination_id} className="hover:bg-gray-50 dark:hover:bg-gray-900/50">
                  <td className="px-4 py-3 font-mono text-xs font-bold text-gray-700 dark:text-gray-200">{r.currency}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{r.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{r.label ?? `${r.currency} ${r.amount.toLocaleString()}`}</td>
                  <td className="px-4 py-3">{r.active ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200">yes</span> : <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">no</span>}</td>
                  <td className="px-4 py-3 text-gray-500">{r.sort_order}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <button type="button" onClick={() => setEditing(r)} aria-label="Edit" className="rounded-lg border border-gray-200 bg-white p-1.5 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800">
                        <Pencil className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
                      </button>
                      <button type="button" onClick={() => setDeleting(r)} aria-label="Delete" className="rounded-lg border border-rose-200 bg-white p-1.5 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-900/20">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal isOpen={editing !== null} onClose={() => !busy && setEditing(null)} title={editing && editing.denomination_id > 0 ? 'Edit denomination' : 'New denomination'} size="md">
        {editing && (
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Currency" required>
                <select
                  value={editing.currency}
                  onChange={(e) => setEditing({ ...editing, currency: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Amount" required>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={editing.amount}
                  onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </Field>
            </div>
            <Field label="Label (optional)">
              <input
                value={editing.label ?? ''}
                onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                placeholder={`${editing.currency} ${editing.amount.toLocaleString()}`}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>
            <Field label="Description (optional)">
              <input
                value={editing.description ?? ''}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                placeholder="Internal note, e.g. holiday promo"
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>
            <Field label="Sort order">
              <input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm md:max-w-[8rem] dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Active (shown as a quick-pick chip)
            </label>

            <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
              <button type="button" onClick={() => !busy && setEditing(null)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title="Remove denomination" size="sm">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Remove the <span className="font-semibold">{deleting.label ?? `${deleting.currency} ${deleting.amount.toLocaleString()}`}</span> denomination? Already-issued cards keep their snapshotted amount.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
              <button type="button" onClick={remove} disabled={busy} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">Remove</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
      <span className="mb-1 inline-block">{label}{required && <span className="ml-0.5 text-rose-500">*</span>}</span>
      {children}
    </label>
  );
}
