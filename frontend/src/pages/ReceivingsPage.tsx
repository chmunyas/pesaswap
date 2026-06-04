import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, Search, Truck } from 'lucide-react';
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

  useEffect(() => {
    api.receivings.list()
      .then((res) => {
        const payload = Array.isArray(res.data.receivings)
          ? res.data.receivings.filter((record): record is Record<string, unknown> => typeof record === 'object' && record !== null)
          : [];

        setReceivings(payload.length > 0 ? payload.map(normalizeReceiving) : MOCK_RECEIVINGS);
      })
      .catch(() => setReceivings(MOCK_RECEIVINGS))
      .finally(() => setLoading(false));
  }, []);

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
        <button className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
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
    </div>
  );
}
