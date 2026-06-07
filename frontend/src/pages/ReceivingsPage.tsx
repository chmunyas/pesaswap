import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { ClipboardList, Plus, Search, Trash2, Truck, X as XIcon } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';

interface ReceivingRecord {
  receiving_id: number;
  date: string;
  supplier: string;
  items_count: number;
  total_cost: number;
  status: 'Complete' | 'Pending';
}

interface DraftLine {
  item_id: string;
  description: string;
  quantity: string;
  cost_price: string;
}

const MOCK_RECEIVINGS: ReceivingRecord[] = [
  { receiving_id: 6201, date: '2026-06-02T08:10:00', supplier: 'Blue Ridge Roasters', items_count: 12, total_cost: 684, status: 'Complete' },
  { receiving_id: 6200, date: '2026-06-01T14:32:00', supplier: 'FreshFields Dairy', items_count: 8, total_cost: 126, status: 'Complete' },
  { receiving_id: 6199, date: '2026-06-01T09:18:00', supplier: 'Cafe Essentials Ltd', items_count: 20, total_cost: 238, status: 'Pending' },
  { receiving_id: 6198, date: '2026-05-31T16:04:00', supplier: 'Golden Crust Bakery', items_count: 10, total_cost: 198, status: 'Complete' },
  { receiving_id: 6197, date: '2026-05-30T11:42:00', supplier: 'Leaf & Bean Traders', items_count: 14, total_cost: 412, status: 'Complete' },
  { receiving_id: 6196, date: '2026-05-29T15:16:00', supplier: 'Urban Deli Supply', items_count: 6, total_cost: 173, status: 'Pending' },
  { receiving_id: 6195, date: '2026-05-28T10:28:00', supplier: 'Summit Beverage Co.', items_count: 16, total_cost: 256, status: 'Complete' },
];

function normalizeReceiving(raw: Record<string, unknown>): ReceivingRecord {
  return {
    receiving_id: Number(raw.receiving_id ?? raw.id ?? 0),
    date: String(raw.date ?? raw.receiving_time ?? new Date().toISOString()),
    supplier: String(raw.supplier ?? raw.supplier_name ?? 'Supplier'),
    items_count: Number(raw.items_count ?? 0),
    total_cost: Number(raw.total_cost ?? raw.total ?? 0),
    status: String(raw.status ?? 'Complete') === 'Pending' ? 'Pending' : 'Complete',
  };
}

export function ReceivingsPage() {
  const [receivings, setReceivings] = useState<ReceivingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [paymentType, setPaymentType] = useState('cash');
  const [comment, setComment] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([
    { item_id: '', description: '', quantity: '1', cost_price: '0' },
  ]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.receivings.list();
      const payload = Array.isArray(res.data.receivings)
        ? res.data.receivings.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
        : [];
      setReceivings(payload.length > 0 ? payload.map(normalizeReceiving) : MOCK_RECEIVINGS);
    } catch {
      setReceivings(MOCK_RECEIVINGS);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function updateLine(idx: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((ls) => [...ls, { item_id: '', description: '', quantity: '1', cost_price: '0' }]);
  }
  function removeLine(idx: number) {
    setLines((ls) => ls.length === 1 ? ls : ls.filter((_, i) => i !== idx));
  }

  const draftTotal = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.cost_price) || 0), 0),
    [lines],
  );

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    const itemsPayload = lines
      .map((l) => ({
        item_id: Number(l.item_id),
        description: l.description.trim(),
        quantity: Number(l.quantity),
        cost_price: Number(l.cost_price),
      }))
      .filter((l) => l.item_id > 0 && l.quantity > 0);
    if (itemsPayload.length === 0) {
      setCreateError('Add at least one line with a valid item_id and quantity.');
      return;
    }
    setCreating(true);
    try {
      const j = await api.receivings.create({
        supplier_id: supplierId ? Number(supplierId) : undefined,
        reference: reference || undefined,
        payment_type: paymentType,
        comment: comment || undefined,
        items: itemsPayload,
      });
      if (!j?.success) {
        setCreateError(j?.message ?? 'Could not record receipt.');
        return;
      }
      setShowCreate(false);
      setSupplierId('');
      setReference('');
      setComment('');
      setLines([{ item_id: '', description: '', quantity: '1', cost_price: '0' }]);
      await refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Network error.');
    } finally {
      setCreating(false);
    }
  }

  const filteredReceivings = useMemo(() => {
    const query = search.toLowerCase();

    return receivings.filter((record) => {
      const matchesSearch = record.supplier.toLowerCase().includes(query) || record.receiving_id.toString().includes(query);
      const matchesStatus = status === 'all' || record.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [receivings, search, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Receivings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Monitor incoming shipments, landed costs, and pending supplier deliveries.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" />
          New Receiving
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_minmax(180px,240px)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by receiving ID or supplier..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">All status</option>
            <option value="Complete">Complete</option>
            <option value="Pending">Pending</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                <Truck className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Recent purchase shipments</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{filteredReceivings.length} records available</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/60">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Receiving ID</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">Items</th>
                  <th className="px-4 py-3">Total Cost</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
                {filteredReceivings.map((record) => (
                  <tr key={record.receiving_id} className="transition hover:bg-gray-50/80 dark:hover:bg-gray-900/40">
                    <td className="px-4 py-4 font-semibold text-gray-900 dark:text-white">#{record.receiving_id}</td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-300">{formatDate(record.date)}</td>
                    <td className="px-4 py-4 text-gray-900 dark:text-white">{record.supplier}</td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-300">{record.items_count}</td>
                    <td className="px-4 py-4 font-medium text-gray-900 dark:text-white">{formatCurrency(record.total_cost)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${record.status === 'Complete' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                        {record.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-gray-200 bg-gray-50 px-5 py-4 dark:border-gray-700 dark:bg-gray-900/40">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <ClipboardList className="h-4 w-4 text-blue-500" />
              Pending deliveries should be reviewed before end-of-day close.
            </div>
          </div>
        </div>
      )}

      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
          role="dialog"
          aria-label="New goods receipt"
          onClick={() => !creating && setShowCreate(false)}
        >
          <form
            onSubmit={submitCreate}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">New goods receipt</h2>
              <button
                type="button"
                onClick={() => !creating && setShowCreate(false)}
                aria-label="Close"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="recv-supplier">
                  Supplier ID
                </label>
                <input
                  id="recv-supplier"
                  type="number"
                  min="0"
                  placeholder="0 = walk-in"
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="recv-ref">
                  Reference
                </label>
                <input
                  id="recv-ref"
                  type="text"
                  maxLength={32}
                  placeholder="INV-12345"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="recv-paytype">
                  Payment type
                </label>
                <select
                  id="recv-paytype"
                  value={paymentType}
                  onChange={(e) => setPaymentType(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Line items</p>
              <div className="mt-2 space-y-2">
                {lines.map((l, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <input
                      type="number"
                      min="1"
                      placeholder="Item ID"
                      value={l.item_id}
                      onChange={(e) => updateLine(idx, { item_id: e.target.value })}
                      className="col-span-2 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                    <input
                      type="text"
                      maxLength={30}
                      placeholder="Description (optional)"
                      value={l.description}
                      onChange={(e) => updateLine(idx, { description: e.target.value })}
                      className="col-span-5 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                    <input
                      type="number"
                      step="0.001"
                      min="0.001"
                      placeholder="Qty"
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                      className="col-span-2 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Cost"
                      value={l.cost_price}
                      onChange={(e) => updateLine(idx, { cost_price: e.target.value })}
                      className="col-span-2 rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                    />
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                      className="col-span-1 inline-flex items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-900 dark:bg-gray-900"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={addLine}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800"
                >
                  <Plus className="h-3 w-3" /> Add line
                </button>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                  Total: <span className="font-mono">{formatCurrency(draftTotal)}</span>
                </span>
              </div>
            </div>

            <div className="mt-4">
              <label className="text-[10px] font-mono uppercase tracking-widest text-gray-500" htmlFor="recv-comment">
                Comment
              </label>
              <textarea
                id="recv-comment"
                rows={2}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </div>

            {createError && (
              <p className="mt-3 text-xs font-semibold text-rose-600">{createError}</p>
            )}

            <div className="mt-5 flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
              <button
                type="button"
                onClick={() => !creating && setShowCreate(false)}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creating}
                className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {creating ? 'Recording…' : 'Record receipt'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
