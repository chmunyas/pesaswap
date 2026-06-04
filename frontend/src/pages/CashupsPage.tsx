import { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';

interface CashupRecord {
  cashup_id: number;
  date: string;
  employee: string;
  register: string;
  opening_balance: number;
  closing_balance: number;
  difference: number;
  status: 'Balanced' | 'Over' | 'Short';
}

const MOCK_CASHUPS: CashupRecord[] = [
  { cashup_id: 5101, date: '2026-06-02T18:05:00', employee: 'Naomi Carter', register: 'Register 1', opening_balance: 200, closing_balance: 1248.5, difference: 0, status: 'Balanced' },
  { cashup_id: 5100, date: '2026-06-02T17:58:00', employee: 'Amina Yusuf', register: 'Register 2', opening_balance: 150, closing_balance: 982.2, difference: 7.2, status: 'Over' },
  { cashup_id: 5099, date: '2026-06-01T18:12:00', employee: 'Moses Kimani', register: 'Register 1', opening_balance: 200, closing_balance: 1090.8, difference: -4.5, status: 'Short' },
  { cashup_id: 5098, date: '2026-06-01T18:00:00', employee: 'Grace Mensah', register: 'Register 3', opening_balance: 100, closing_balance: 680.3, difference: 0, status: 'Balanced' },
  { cashup_id: 5097, date: '2026-05-31T17:46:00', employee: 'Leo Grant', register: 'Mobile Till', opening_balance: 80, closing_balance: 428.9, difference: 3.1, status: 'Over' },
  { cashup_id: 5096, date: '2026-05-30T18:15:00', employee: 'Fatima Omar', register: 'Register 2', opening_balance: 150, closing_balance: 912.4, difference: 0, status: 'Balanced' },
];

function normalizeCashup(raw: Record<string, unknown>): CashupRecord {
  const difference = Number(raw.difference ?? 0);

  return {
    cashup_id: Number(raw.cashup_id ?? raw.id ?? 0),
    date: String(raw.date ?? raw.cashup_time ?? new Date().toISOString()),
    employee: String(raw.employee ?? raw.employee_name ?? 'Cashier'),
    register: String(raw.register ?? 'Register'),
    opening_balance: Number(raw.opening_balance ?? 0),
    closing_balance: Number(raw.closing_balance ?? 0),
    difference,
    status: difference === 0 ? 'Balanced' : difference > 0 ? 'Over' : 'Short',
  };
}

function getStatusClass(status: CashupRecord['status']): string {
  if (status === 'Balanced') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300';
  if (status === 'Over') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300';
  return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-300';
}

export function CashupsPage() {
  const [cashups, setCashups] = useState<CashupRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');

  useEffect(() => {
    api.cashups.list()
      .then((res) => {
        const payload = Array.isArray(res.data.cashups)
          ? res.data.cashups.filter((record): record is Record<string, unknown> => typeof record === 'object' && record !== null)
          : [];

        setCashups(payload.length > 0 ? payload.map(normalizeCashup) : MOCK_CASHUPS);
      })
      .catch(() => setCashups(MOCK_CASHUPS))
      .finally(() => setLoading(false));
  }, []);

  const filteredCashups = useMemo(() => {
    const query = search.toLowerCase();

    return cashups.filter((record) => {
      const matchesSearch = [record.employee, record.register, record.cashup_id.toString()].some((value) => value.toLowerCase().includes(query));
      const matchesStatus = status === 'all' || record.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [cashups, search, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cashups</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Reconcile drawers, highlight overages and shortages, and keep every shift accountable.</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
          <Plus className="h-4 w-4" />
          New Cashup
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_minmax(180px,240px)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by employee, register, or cashup ID..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">All status</option>
            <option value="Balanced">Balanced</option>
            <option value="Over">Over</option>
            <option value="Short">Short</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="relative space-y-5 before:absolute before:left-[15px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-gray-200 dark:before:bg-gray-700">
            {filteredCashups.map((record) => (
              <div key={record.cashup_id} className="relative pl-10">
                <span className={`absolute left-0 top-5 h-8 w-8 rounded-full border-4 border-white dark:border-gray-800 ${record.status === 'Balanced' ? 'bg-emerald-500' : record.status === 'Over' ? 'bg-amber-500' : 'bg-rose-500'}`} />
                <div className={`rounded-xl border p-5 shadow-sm ${getStatusClass(record.status)}`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">{record.employee}</h2>
                        <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm dark:bg-gray-800 dark:text-gray-200">{record.register}</span>
                      </div>
                      <p className="mt-2 text-sm opacity-80">{formatDate(record.date)} · Cashup #{record.cashup_id}</p>
                    </div>
                    <div className="flex items-center gap-2 rounded-xl bg-white/80 px-4 py-3 shadow-sm dark:bg-gray-800/80">
                      <Wallet className="h-4 w-4" />
                      <span className="text-sm font-semibold">{record.status}</span>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg bg-white/70 p-4 shadow-sm dark:bg-gray-800/80">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Opening</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(record.opening_balance)}</p>
                    </div>
                    <div className="rounded-lg bg-white/70 p-4 shadow-sm dark:bg-gray-800/80">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Closing</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(record.closing_balance)}</p>
                    </div>
                    <div className="rounded-lg bg-white/70 p-4 shadow-sm dark:bg-gray-800/80">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Difference</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{record.difference > 0 ? '+' : ''}{formatCurrency(record.difference)}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
