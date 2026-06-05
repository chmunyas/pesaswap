import { useEffect, useMemo, useState } from 'react';
import { Lock, LockOpen, Search, Trash2, Wallet } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { showToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';

type CashupStatus = 'Open' | 'Balanced' | 'Over' | 'Short';

interface CashupRecord {
  cashup_id: number;
  open_date: string;
  close_date: string | null;
  open_employee_name: string;
  close_employee_name: string;
  open_amount_cash: number;
  transfer_amount_cash: number;
  closed_amount_cash: number;
  closed_amount_card: number;
  closed_amount_check: number;
  closed_amount_due: number;
  closed_amount_total: number;
  cash_sales: number;
  cash_refunds: number;
  cash_expenses: number;
  expected_cash: number;
  variance: number;
  description: string;
  is_open: boolean;
  status: CashupStatus;
}

interface OpenFormState {
  open_amount_cash: string;
  description: string;
}

interface CloseFormState {
  closed_amount_cash: string;
  closed_amount_card: string;
  closed_amount_check: string;
  closed_amount_due: string;
  transfer_amount_cash: string;
  note: string;
}

const EMPTY_OPEN_FORM: OpenFormState = {
  open_amount_cash: '0',
  description: '',
};

const EMPTY_CLOSE_FORM: CloseFormState = {
  closed_amount_cash: '0',
  closed_amount_card: '0',
  closed_amount_check: '0',
  closed_amount_due: '0',
  transfer_amount_cash: '0',
  note: '',
};

// Within ±0.50 currency units we treat the till as balanced (rounding tolerance).
const BALANCE_TOLERANCE = 0.5;

const MOCK_CASHUPS: CashupRecord[] = [
  {
    cashup_id: 5101,
    open_date: '2026-06-02T09:00:00',
    close_date: '2026-06-02T18:05:00',
    open_employee_name: 'Naomi Carter',
    close_employee_name: 'Naomi Carter',
    open_amount_cash: 200,
    transfer_amount_cash: 0,
    closed_amount_cash: 1248.5,
    closed_amount_card: 0,
    closed_amount_check: 0,
    closed_amount_due: 0,
    closed_amount_total: 1248.5,
    cash_sales: 1048.5,
    cash_refunds: 0,
    cash_expenses: 0,
    expected_cash: 1248.5,
    variance: 0,
    description: 'Register 1 — opening float 200',
    is_open: false,
    status: 'Balanced',
  },
  {
    cashup_id: 5100,
    open_date: '2026-06-02T09:10:00',
    close_date: '2026-06-02T17:58:00',
    open_employee_name: 'Amina Yusuf',
    close_employee_name: 'Amina Yusuf',
    open_amount_cash: 150,
    transfer_amount_cash: 0,
    closed_amount_cash: 982.2,
    closed_amount_card: 0,
    closed_amount_check: 0,
    closed_amount_due: 0,
    closed_amount_total: 982.2,
    cash_sales: 825,
    cash_refunds: 0,
    cash_expenses: 0,
    expected_cash: 975,
    variance: 7.2,
    description: 'Register 2',
    is_open: false,
    status: 'Over',
  },
  {
    cashup_id: 5099,
    open_date: '2026-06-01T09:00:00',
    close_date: '2026-06-01T18:12:00',
    open_employee_name: 'Moses Kimani',
    close_employee_name: 'Moses Kimani',
    open_amount_cash: 200,
    transfer_amount_cash: 0,
    closed_amount_cash: 1090.8,
    closed_amount_card: 0,
    closed_amount_check: 0,
    closed_amount_due: 0,
    closed_amount_total: 1090.8,
    cash_sales: 895.3,
    cash_refunds: 0,
    cash_expenses: 0,
    expected_cash: 1095.3,
    variance: -4.5,
    description: 'Register 1',
    is_open: false,
    status: 'Short',
  },
];

function classifyVariance(variance: number, isOpen: boolean): CashupStatus {
  if (isOpen) return 'Open';
  if (Math.abs(variance) <= BALANCE_TOLERANCE) return 'Balanced';
  return variance > 0 ? 'Over' : 'Short';
}

function normalizeCashup(raw: Record<string, unknown>): CashupRecord {
  const variance = Number(raw.variance ?? 0);
  const isOpen = Boolean(raw.is_open ?? !raw.close_date);
  return {
    cashup_id: Number(raw.cashup_id ?? 0),
    open_date: String(raw.open_date ?? new Date().toISOString()),
    close_date: raw.close_date ? String(raw.close_date) : null,
    open_employee_name: String(raw.open_employee_name ?? 'Cashier'),
    close_employee_name: String(raw.close_employee_name ?? raw.open_employee_name ?? 'Cashier'),
    open_amount_cash: Number(raw.open_amount_cash ?? 0),
    transfer_amount_cash: Number(raw.transfer_amount_cash ?? 0),
    closed_amount_cash: Number(raw.closed_amount_cash ?? 0),
    closed_amount_card: Number(raw.closed_amount_card ?? 0),
    closed_amount_check: Number(raw.closed_amount_check ?? 0),
    closed_amount_due: Number(raw.closed_amount_due ?? 0),
    closed_amount_total: Number(raw.closed_amount_total ?? 0),
    cash_sales: Number(raw.cash_sales ?? 0),
    cash_refunds: Number(raw.cash_refunds ?? 0),
    cash_expenses: Number(raw.cash_expenses ?? 0),
    expected_cash: Number(raw.expected_cash ?? 0),
    variance,
    description: String(raw.description ?? ''),
    is_open: isOpen,
    status: classifyVariance(variance, isOpen),
  };
}

function getStatusClass(status: CashupStatus): string {
  if (status === 'Open') return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-900/20 dark:text-sky-300';
  if (status === 'Balanced') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300';
  if (status === 'Over') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300';
  return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-300';
}

function getDotClass(status: CashupStatus): string {
  if (status === 'Open') return 'bg-sky-500';
  if (status === 'Balanced') return 'bg-emerald-500';
  if (status === 'Over') return 'bg-amber-500';
  return 'bg-rose-500';
}

function parseAmount(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function CashupsPage() {
  const [cashups, setCashups] = useState<CashupRecord[]>([]);
  const [openShift, setOpenShift] = useState<CashupRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CashupStatus>('all');

  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CashupRecord | null>(null);
  const [openForm, setOpenForm] = useState<OpenFormState>(EMPTY_OPEN_FORM);
  const [closeForm, setCloseForm] = useState<CloseFormState>(EMPTY_CLOSE_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadCashups = async () => {
    try {
      const response = await api.cashups.list();
      const list = Array.isArray(response.data.cashups)
        ? response.data.cashups.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
        : [];

      if (list.length > 0) {
        setCashups(list.map(normalizeCashup));
        setUsingMockData(false);
      } else {
        setCashups(MOCK_CASHUPS);
        setUsingMockData(true);
      }

      const openRaw = response.data.open;
      setOpenShift(openRaw && typeof openRaw === 'object' ? normalizeCashup(openRaw) : null);
    } catch {
      setCashups(MOCK_CASHUPS);
      setOpenShift(null);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCashups();
  }, []);

  const filteredCashups = useMemo(() => {
    const query = search.toLowerCase();
    return cashups.filter((record) => {
      const matchesSearch = [
        record.open_employee_name,
        record.close_employee_name,
        record.description,
        String(record.cashup_id),
      ].some((value) => value.toLowerCase().includes(query));
      const matchesStatus = statusFilter === 'all' || record.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [cashups, search, statusFilter]);

  const handleOpenFormChange = (name: string, value: string) => {
    setOpenForm((current) => ({ ...current, [name]: value } as OpenFormState));
  };

  const handleCloseFormChange = (name: string, value: string) => {
    setCloseForm((current) => ({ ...current, [name]: value } as CloseFormState));
  };

  const expectedCashLive = useMemo(() => {
    if (!openShift) return 0;
    return openShift.expected_cash + parseAmount(closeForm.transfer_amount_cash);
  }, [openShift, closeForm.transfer_amount_cash]);

  const varianceLive = useMemo(() => {
    return parseAmount(closeForm.closed_amount_cash) - expectedCashLive;
  }, [closeForm.closed_amount_cash, expectedCashLive]);

  const handleOpenTill = async () => {
    if (openShift) {
      showToast('A cashup is already open — close it first.', 'error');
      return;
    }
    const amount = parseAmount(openForm.open_amount_cash);
    setSubmitting(true);
    try {
      if (usingMockData) {
        const id = Math.max(0, ...cashups.map((c) => c.cashup_id)) + 1;
        const newRow: CashupRecord = {
          cashup_id: id,
          open_date: new Date().toISOString(),
          close_date: null,
          open_employee_name: 'Current User',
          close_employee_name: 'Current User',
          open_amount_cash: amount,
          transfer_amount_cash: 0,
          closed_amount_cash: 0,
          closed_amount_card: 0,
          closed_amount_check: 0,
          closed_amount_due: 0,
          closed_amount_total: 0,
          cash_sales: 0,
          cash_refunds: 0,
          cash_expenses: 0,
          expected_cash: amount,
          variance: 0,
          description: openForm.description.trim(),
          is_open: true,
          status: 'Open',
        };
        setCashups((current) => [newRow, ...current]);
        setOpenShift(newRow);
        showToast('Till opened locally');
      } else {
        await api.cashups.open({
          open_amount_cash: amount,
          description: openForm.description.trim(),
        });
        await loadCashups();
        showToast('Till opened');
      }
      setOpenForm(EMPTY_OPEN_FORM);
      setOpenModal(false);
    } catch {
      showToast('Failed to open till', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseTill = async () => {
    if (!openShift) {
      showToast('No open cashup to close.', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        closed_amount_cash: parseAmount(closeForm.closed_amount_cash),
        closed_amount_card: parseAmount(closeForm.closed_amount_card),
        closed_amount_check: parseAmount(closeForm.closed_amount_check),
        closed_amount_due: parseAmount(closeForm.closed_amount_due),
        transfer_amount_cash: parseAmount(closeForm.transfer_amount_cash),
        note: closeForm.note.trim(),
      };
      if (usingMockData) {
        const expected = openShift.expected_cash + payload.transfer_amount_cash;
        const variance = payload.closed_amount_cash - expected;
        const closed: CashupRecord = {
          ...openShift,
          close_date: new Date().toISOString(),
          close_employee_name: 'Current User',
          closed_amount_cash: payload.closed_amount_cash,
          closed_amount_card: payload.closed_amount_card,
          closed_amount_check: payload.closed_amount_check,
          closed_amount_due: payload.closed_amount_due,
          closed_amount_total:
            payload.closed_amount_cash + payload.closed_amount_card + payload.closed_amount_check + payload.closed_amount_due,
          transfer_amount_cash: payload.transfer_amount_cash,
          expected_cash: expected,
          variance,
          description: payload.note
            ? `${openShift.description ? `${openShift.description} | ` : ''}Close: ${payload.note}`
            : openShift.description,
          is_open: false,
          status: classifyVariance(variance, false),
        };
        setCashups((current) => current.map((c) => (c.cashup_id === closed.cashup_id ? closed : c)));
        setOpenShift(null);
        showToast('Till closed locally');
      } else {
        await api.cashups.close(openShift.cashup_id, payload);
        await loadCashups();
        showToast('Till closed');
      }
      setCloseForm(EMPTY_CLOSE_FORM);
      setCloseModal(false);
    } catch {
      showToast('Failed to close till', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      if (usingMockData) {
        setCashups((current) => current.filter((c) => c.cashup_id !== deleteTarget.cashup_id));
        if (openShift && openShift.cashup_id === deleteTarget.cashup_id) setOpenShift(null);
        showToast('Cashup removed locally');
      } else {
        await api.cashups.delete(deleteTarget.cashup_id);
        await loadCashups();
        showToast('Cashup removed');
      }
      setDeleteTarget(null);
    } catch {
      showToast('Failed to remove cashup', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const statusOptions: Array<'all' | CashupStatus> = ['all', 'Open', 'Balanced', 'Over', 'Short'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cashups</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Open the till at the start of a shift and close it at the end — variance is calculated from real sales, refunds and expenses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOpenModal(true)}
            disabled={openShift !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <LockOpen className="h-4 w-4" />
            Open Till
          </button>
          <button
            type="button"
            onClick={() => {
              setCloseForm(EMPTY_CLOSE_FORM);
              setCloseModal(true);
            }}
            disabled={openShift === null}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Lock className="h-4 w-4" />
            Close Till
          </button>
        </div>
      </div>

      {usingMockData && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
          Showing sample data — the cashup API returned no rows or is unavailable. Actions on this screen will only update the local view.
        </div>
      )}

      {openShift && (
        <div className="rounded-xl border border-sky-200 bg-gradient-to-r from-sky-500 to-indigo-500 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-white/15 p-3">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-sky-100">Open shift</p>
                <p className="mt-1 text-lg font-semibold">
                  #{openShift.cashup_id} · {openShift.open_employee_name}
                </p>
                <p className="text-xs text-sky-100">Opened {formatDate(openShift.open_date)}</p>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3 md:max-w-2xl md:grid-cols-4">
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-sky-100">Opening</p>
                <p className="text-sm font-semibold">{formatCurrency(openShift.open_amount_cash)}</p>
              </div>
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-sky-100">Cash sales</p>
                <p className="text-sm font-semibold">{formatCurrency(openShift.cash_sales)}</p>
              </div>
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-sky-100">Expenses</p>
                <p className="text-sm font-semibold">{formatCurrency(openShift.cash_expenses)}</p>
              </div>
              <div className="rounded-lg bg-white/15 px-3 py-2">
                <p className="text-[11px] uppercase tracking-wide text-sky-100">Expected</p>
                <p className="text-sm font-semibold">{formatCurrency(openShift.expected_cash)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_minmax(180px,240px)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by employee, description, or cashup ID..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | CashupStatus)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All status' : option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : filteredCashups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
          No cashups match the current filters.
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="relative space-y-5 before:absolute before:left-[15px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-gray-200 dark:before:bg-gray-700">
            {filteredCashups.map((record) => (
              <div key={record.cashup_id} className="relative pl-10">
                <span
                  className={`absolute left-0 top-5 h-8 w-8 rounded-full border-4 border-white dark:border-gray-800 ${getDotClass(record.status)}`}
                />
                <div className={`rounded-xl border p-5 shadow-sm ${getStatusClass(record.status)}`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">{record.open_employee_name}</h2>
                        {record.close_employee_name && record.close_employee_name !== record.open_employee_name && (
                          <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm dark:bg-gray-800 dark:text-gray-200">
                            Closed by {record.close_employee_name}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-sm opacity-80">
                        Opened {formatDate(record.open_date)}
                        {record.close_date ? ` · Closed ${formatDate(record.close_date)}` : ' · Still open'} · Cashup #{record.cashup_id}
                      </p>
                      {record.description && (
                        <p className="mt-1 text-xs italic opacity-70">{record.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2 rounded-xl bg-white/80 px-4 py-3 shadow-sm dark:bg-gray-800/80">
                        <Wallet className="h-4 w-4" />
                        <span className="text-sm font-semibold">{record.status}</span>
                      </div>
                      {!record.is_open && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(record)}
                          className="rounded-lg bg-white/80 p-2 text-gray-500 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 dark:bg-gray-800/80 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                          aria-label={`Remove cashup #${record.cashup_id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                    <div className="rounded-lg bg-white/70 p-4 shadow-sm dark:bg-gray-800/80">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Opening</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(record.open_amount_cash)}</p>
                    </div>
                    <div className="rounded-lg bg-white/70 p-4 shadow-sm dark:bg-gray-800/80">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Counted cash</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(record.closed_amount_cash)}</p>
                    </div>
                    <div className="rounded-lg bg-white/70 p-4 shadow-sm dark:bg-gray-800/80">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Expected</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(record.expected_cash)}</p>
                    </div>
                    <div className="rounded-lg bg-white/70 p-4 shadow-sm dark:bg-gray-800/80">
                      <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Variance</p>
                      <p className="mt-2 text-lg font-semibold text-gray-900 dark:text-white">
                        {record.variance > 0 ? '+' : ''}
                        {formatCurrency(record.variance)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal isOpen={openModal} onClose={() => setOpenModal(false)} title="Open Till" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Record the opening cash float for the new shift. Only one cashup can be open at a time.
          </p>
          <FormField
            label="Opening cash float"
            name="open_amount_cash"
            value={openForm.open_amount_cash}
            onChange={handleOpenFormChange}
            type="number"
            required
          />
          <FormField
            label="Description (optional)"
            name="description"
            value={openForm.description}
            onChange={handleOpenFormChange}
            type="textarea"
            placeholder="Register 1, opening notes..."
          />
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setOpenModal(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleOpenTill}
              disabled={submitting}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-600 disabled:opacity-70"
            >
              {submitting ? 'Opening...' : 'Open Till'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={closeModal} onClose={() => setCloseModal(false)} title="Close Till" size="lg">
        <div className="space-y-4">
          {openShift ? (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm dark:border-gray-700 dark:bg-gray-900/50">
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Opening cash</p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(openShift.open_amount_cash)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Cash sales</p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(openShift.cash_sales)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Cash expenses</p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(openShift.cash_expenses)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Expected cash</p>
                    <p className="mt-1 font-semibold text-gray-900 dark:text-white">{formatCurrency(expectedCashLive)}</p>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  label="Counted cash"
                  name="closed_amount_cash"
                  value={closeForm.closed_amount_cash}
                  onChange={handleCloseFormChange}
                  type="number"
                  required
                />
                <FormField
                  label="Card receipts"
                  name="closed_amount_card"
                  value={closeForm.closed_amount_card}
                  onChange={handleCloseFormChange}
                  type="number"
                />
                <FormField
                  label="Cheque receipts"
                  name="closed_amount_check"
                  value={closeForm.closed_amount_check}
                  onChange={handleCloseFormChange}
                  type="number"
                />
                <FormField
                  label="Amounts due / on account"
                  name="closed_amount_due"
                  value={closeForm.closed_amount_due}
                  onChange={handleCloseFormChange}
                  type="number"
                />
                <FormField
                  label="Cash transferred out"
                  name="transfer_amount_cash"
                  value={closeForm.transfer_amount_cash}
                  onChange={handleCloseFormChange}
                  type="number"
                />
                <div
                  className={`rounded-lg border p-4 text-sm ${
                    Math.abs(varianceLive) <= BALANCE_TOLERANCE
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-900/20 dark:text-emerald-300'
                      : varianceLive > 0
                        ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300'
                        : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-300'
                  }`}
                >
                  <p className="text-xs uppercase tracking-wide opacity-80">Live variance</p>
                  <p className="mt-2 text-xl font-semibold">
                    {varianceLive > 0 ? '+' : ''}
                    {formatCurrency(varianceLive)}
                  </p>
                  <p className="mt-1 text-xs">
                    {Math.abs(varianceLive) <= BALANCE_TOLERANCE
                      ? 'Balanced within tolerance.'
                      : varianceLive > 0
                        ? 'Drawer is over expected cash.'
                        : 'Drawer is short of expected cash.'}
                  </p>
                </div>
              </div>
              <FormField
                label="Closing note (optional)"
                name="note"
                value={closeForm.note}
                onChange={handleCloseFormChange}
                type="textarea"
                placeholder="Explain shortages, overages, or anything unusual..."
              />
              <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setCloseModal(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCloseTill}
                  disabled={submitting}
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-70"
                >
                  {submitting ? 'Closing...' : 'Close Till'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300">No open cashup to close.</p>
          )}
        </div>
      </Modal>

      <Modal isOpen={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Remove Cashup" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Remove cashup #{deleteTarget?.cashup_id ?? ''}? This soft-deletes the record but keeps the underlying sales.
          </p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={submitting}
              className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600 disabled:opacity-70"
            >
              {submitting ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
