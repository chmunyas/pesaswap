import { useEffect, useMemo, useState } from 'react';
import { Paperclip, Plus, Search, Trash2, Upload, Wallet } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { showToast } from '../components/ui/Toast';
import { BulkImportModal } from '../components/bulk/BulkImportModal';
import { BULK_SCHEMAS } from '../components/bulk/schemas';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';

interface ExpenseRecord {
  expense_id: number;
  date: string;
  category: 'Rent' | 'Supplies' | 'Utilities' | 'Payroll' | 'Other';
  amount: number;
  payment_type: string;
  description: string;
  employee: string;
  has_receipt: boolean;
}

interface ExpenseFormState {
  date: string;
  category: ExpenseRecord['category'];
  amount: string;
  payment_type: string;
  description: string;
}

const EMPTY_FORM: ExpenseFormState = {
  date: new Date().toISOString().slice(0, 10),
  category: 'Other',
  amount: '0',
  payment_type: 'Cash',
  description: '',
};

const MOCK_EXPENSES: ExpenseRecord[] = [
  { expense_id: 1, date: '2026-06-02T09:00:00', category: 'Supplies', amount: 186.4, payment_type: 'Cash', description: 'Paper cups and napkins restock', employee: 'Fatima Omar', has_receipt: true },
  { expense_id: 2, date: '2026-06-01T17:30:00', category: 'Payroll', amount: 2480, payment_type: 'Bank Transfer', description: 'Weekend staff payroll batch', employee: 'Grace Mensah', has_receipt: false },
  { expense_id: 3, date: '2026-06-01T10:10:00', category: 'Utilities', amount: 322.8, payment_type: 'Card', description: 'Electricity bill payment', employee: 'Leo Grant', has_receipt: true },
  { expense_id: 4, date: '2026-05-31T13:20:00', category: 'Other', amount: 74, payment_type: 'Cash', description: 'POS terminal cleaning supplies', employee: 'Naomi Carter', has_receipt: true },
  { expense_id: 5, date: '2026-05-30T08:15:00', category: 'Rent', amount: 4200, payment_type: 'Bank Transfer', description: 'June storefront rent', employee: 'Leo Grant', has_receipt: true },
  { expense_id: 6, date: '2026-05-29T15:40:00', category: 'Supplies', amount: 128.9, payment_type: 'Cash', description: 'Printer paper and labels', employee: 'Fatima Omar', has_receipt: true },
];

const CATEGORY_OPTIONS: Array<'all' | ExpenseRecord['category']> = ['all', 'Rent', 'Supplies', 'Utilities', 'Payroll', 'Other'];
const PAYMENT_OPTIONS = ['Cash', 'Card', 'Bank Transfer', 'Mobile Money'];

function normalizeExpense(raw: Record<string, unknown>): ExpenseRecord {
  const category = String(raw.category ?? 'Other');

  return {
    expense_id: Number(raw.expense_id ?? raw.id ?? 0),
    date: String(raw.date ?? raw.expense_date ?? new Date().toISOString()),
    category: CATEGORY_OPTIONS.includes(category as ExpenseRecord['category']) ? (category as ExpenseRecord['category']) : 'Other',
    amount: Number(raw.amount ?? 0),
    payment_type: String(raw.payment_type ?? raw.payment_method ?? 'Cash'),
    description: String(raw.description ?? 'Expense entry'),
    employee: String(raw.employee ?? raw.employee_name ?? 'Staff'),
    has_receipt: Boolean(raw.has_receipt ?? raw.receipt_url),
  };
}

export function ExpensesPage() {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<typeof CATEGORY_OPTIONS[number]>('all');
  const [usingMockData, setUsingMockData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expenseToDelete, setExpenseToDelete] = useState<ExpenseRecord | null>(null);
  const [form, setForm] = useState<ExpenseFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);

  const loadExpenses = async () => {
    try {
      const response = await api.expenses.list(1, 100);
      const source = Array.isArray(response.data.expenses)
        ? response.data.expenses
        : Array.isArray(response.data.data)
          ? response.data.data
          : Array.isArray(response.data)
            ? response.data
            : [];
      const payload = source.filter((expense): expense is Record<string, unknown> => typeof expense === 'object' && expense !== null);

      if (payload.length > 0) {
        setExpenses(payload.map(normalizeExpense));
        setUsingMockData(false);
      } else {
        setExpenses(MOCK_EXPENSES);
        setUsingMockData(true);
      }
    } catch {
      setExpenses(MOCK_EXPENSES);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadExpenses();
  }, []);

  const filteredExpenses = useMemo(() => {
    const query = search.toLowerCase();

    return expenses.filter((expense) => {
      const matchesCategory = category === 'all' || expense.category === category;
      const matchesSearch = [expense.description, expense.employee, expense.category, expense.payment_type]
        .some((value) => value.toLowerCase().includes(query));
      return matchesCategory && matchesSearch;
    });
  }, [category, expenses, search]);

  const monthlyTotal = filteredExpenses.reduce((total, expense) => total + expense.amount, 0);

  const handleFormChange = (name: string, value: string) => {
    setForm((current) => ({ ...current, [name]: value } as ExpenseFormState));
  };

  const handleSubmit = async () => {
    if (!form.description.trim()) {
      showToast('Description is required', 'error');
      return;
    }

    const payload = {
      date: form.date,
      category: form.category,
      amount: Number(form.amount) || 0,
      payment_type: form.payment_type,
      description: form.description.trim(),
    };

    setSubmitting(true);

    try {
      if (usingMockData) {
        setExpenses((current) => [{ expense_id: Math.max(0, ...current.map((expense) => expense.expense_id)) + 1, employee: 'Current User', has_receipt: false, ...payload }, ...current]);
        showToast('Expense added locally');
      } else {
        await api.expenses.create(payload);
        await loadExpenses();
        showToast('Expense created successfully');
      }

      setForm(EMPTY_FORM);
      setIsModalOpen(false);
    } catch {
      showToast('Failed to create expense', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!expenseToDelete) return;

    setSubmitting(true);

    try {
      if (usingMockData) {
        setExpenses((current) => current.filter((expense) => expense.expense_id !== expenseToDelete.expense_id));
        showToast('Expense deleted locally');
      } else {
        await api.expenses.delete(expenseToDelete.expense_id);
        await loadExpenses();
        showToast('Expense deleted successfully');
      }

      setExpenseToDelete(null);
    } catch {
      showToast('Failed to delete expense', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Expenses</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Capture store costs and keep monthly spend visible to managers.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowBulkImport(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            <Upload className="h-4 w-4" />
            Import CSV
          </button>
          <button type="button" onClick={() => setIsModalOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
            <Plus className="h-4 w-4" />
            Add Expense
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gradient-to-r from-blue-500 to-indigo-500 p-5 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-white/15 p-3">
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm text-blue-100">Monthly total</p>
            <p className="mt-1 text-2xl font-semibold">{formatCurrency(monthlyTotal)}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search descriptions, employees, or payment types..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                className={`rounded-full px-3 py-2 text-xs font-medium transition ${category === option ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'}`}
              >
                {option === 'all' ? 'All categories' : option}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/60">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Payment Type</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Receipt</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
                {filteredExpenses.map((expense) => (
                  <tr key={expense.expense_id} className="transition hover:bg-gray-50/80 dark:hover:bg-gray-900/40">
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-300">{formatDate(expense.date)}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{expense.category}</span>
                    </td>
                    <td className="px-4 py-4 font-semibold text-gray-900 dark:text-white">{formatCurrency(expense.amount)}</td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-300">{expense.payment_type}</td>
                    <td className="px-4 py-4 text-gray-900 dark:text-white">{expense.description}</td>
                    <td className="px-4 py-4">
                      <div className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                        <Paperclip className={`h-3.5 w-3.5 ${expense.has_receipt ? 'text-blue-500' : 'text-gray-400'}`} />
                        {expense.has_receipt ? 'Attached' : 'Missing'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <button type="button" onClick={() => setExpenseToDelete(expense)} className="rounded-lg p-2 text-gray-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Expense" size="lg">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Date" name="date" value={form.date} onChange={handleFormChange} type="text" />
            <FormField label="Category" name="category" value={form.category} onChange={handleFormChange} type="select" options={CATEGORY_OPTIONS.filter((option) => option !== 'all').map((option) => ({ value: option, label: option }))} />
            <FormField label="Amount" name="amount" value={form.amount} onChange={handleFormChange} type="number" />
            <FormField label="Payment Type" name="payment_type" value={form.payment_type} onChange={handleFormChange} type="select" options={PAYMENT_OPTIONS.map((option) => ({ value: option, label: option }))} />
            <div className="md:col-span-2">
              <FormField label="Description" name="description" value={form.description} onChange={handleFormChange} type="textarea" required />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-70">
              {submitting ? 'Saving...' : 'Create Expense'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={expenseToDelete !== null} onClose={() => setExpenseToDelete(null)} title="Delete Expense" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Are you sure you want to delete this expense entry?</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setExpenseToDelete(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleDelete} disabled={submitting} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600 disabled:opacity-70">
              {submitting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>

      <BulkImportModal
        isOpen={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        {...BULK_SCHEMAS.expenses}
        onDone={async () => { await loadExpenses(); }}
      />
    </div>
  );
}
