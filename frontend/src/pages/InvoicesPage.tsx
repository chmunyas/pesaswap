import { useState, useMemo } from 'react';
import {
  FileText,
  Plus,
  Trash2,
  Send,
  Globe2,
  Calendar,
  Lock,
  Repeat,
  Receipt,
} from 'lucide-react';

type Currency = 'KES' | 'USD' | 'EUR' | 'GBP' | 'TZS' | 'UGX';

type InvoiceLine = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
};

type Customer = {
  name: string;
  email: string;
  phone: string;
};

// Mocked FX rates (real implementation would call /api/fx)
const FX_RATES: Record<Currency, number> = {
  KES: 1,
  USD: 129.5,
  EUR: 140.2,
  GBP: 163.8,
  TZS: 0.052,
  UGX: 0.034,
};

const CURRENCY_SYMBOLS: Record<Currency, string> = {
  KES: 'KES',
  USD: '$',
  EUR: '€',
  GBP: '£',
  TZS: 'TSh',
  UGX: 'USh',
};

export function InvoiceCreator({
  onIssue,
  onCancel,
}: {
  onIssue?: (invoice: {
    customer: Customer;
    lines: InvoiceLine[];
    currency: Currency;
    total: number;
    dueDate: string;
    fxLocked: boolean;
    partial: number;
    recurring: 'none' | 'weekly' | 'monthly';
    note: string;
  }) => void;
  onCancel?: () => void;
}) {
  const [customer, setCustomer] = useState<Customer>({ name: '', email: '', phone: '' });
  const [lines, setLines] = useState<InvoiceLine[]>([
    { id: '1', description: '', quantity: 1, unitPrice: 0 },
  ]);
  const [currency, setCurrency] = useState<Currency>('KES');
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [fxLocked, setFxLocked] = useState(false);
  const [partial, setPartial] = useState(0);
  const [recurring, setRecurring] = useState<'none' | 'weekly' | 'monthly'>('none');
  const [note, setNote] = useState('');

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
    [lines],
  );
  const tax = useMemo(() => Math.round(subtotal * 0.16 * 100) / 100, [subtotal]);
  const total = useMemo(() => subtotal + tax, [subtotal, tax]);

  const equivalentKes = useMemo(() => total * FX_RATES[currency], [total, currency]);
  const sym = CURRENCY_SYMBOLS[currency];

  function addLine() {
    setLines((cur) => [
      ...cur,
      { id: String(Date.now()), description: '', quantity: 1, unitPrice: 0 },
    ]);
  }

  function removeLine(id: string) {
    setLines((cur) => (cur.length === 1 ? cur : cur.filter((l) => l.id !== id)));
  }

  function updateLine(id: string, patch: Partial<InvoiceLine>) {
    setLines((cur) => cur.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function handleIssue() {
    if (!customer.name || lines.every((l) => !l.description)) return;
    onIssue?.({
      customer,
      lines,
      currency,
      total,
      dueDate,
      fxLocked,
      partial,
      recurring,
      note,
    });
  }

  const canIssue = customer.name && lines.some((l) => l.description && l.quantity > 0 && l.unitPrice > 0);

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-blue-600" />
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">New Invoice</h2>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm font-mono text-gray-900 dark:text-white"
          >
            {(Object.keys(FX_RATES) as Currency[]).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            onClick={() => setFxLocked(!fxLocked)}
            title={fxLocked ? 'FX rate locked' : 'Lock current FX rate'}
            className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold ${
              fxLocked
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
            }`}
          >
            <Lock className="h-3.5 w-3.5" />
            {fxLocked ? 'FX locked' : 'Lock FX'}
          </button>
        </div>
      </div>

      {/* Customer */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Bill to</p>
        <input
          type="text"
          value={customer.name}
          onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
          placeholder="Customer name"
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="email"
            value={customer.email}
            onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
            placeholder="Email"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
          <input
            type="tel"
            value={customer.phone}
            onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
            placeholder="Phone"
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
        </div>
      </div>

      {/* Line items */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Items</p>
          <button onClick={addLine} className="flex items-center gap-1 text-xs text-blue-600 font-medium">
            <Plus className="h-3.5 w-3.5" />
            Add line
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((line) => (
            <div key={line.id} className="grid grid-cols-12 gap-2 items-center">
              <input
                type="text"
                value={line.description}
                onChange={(e) => updateLine(line.id, { description: e.target.value })}
                placeholder="Description"
                className="col-span-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
              />
              <input
                type="number"
                min={0}
                value={line.quantity}
                onChange={(e) => updateLine(line.id, { quantity: Number(e.target.value) })}
                className="col-span-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-sm font-mono text-right text-gray-900 dark:text-white"
              />
              <input
                type="number"
                min={0}
                step={0.01}
                value={line.unitPrice}
                onChange={(e) => updateLine(line.id, { unitPrice: Number(e.target.value) })}
                placeholder="Price"
                className="col-span-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-sm font-mono text-right text-gray-900 dark:text-white"
              />
              <button
                onClick={() => removeLine(line.id)}
                disabled={lines.length === 1}
                className="col-span-1 text-red-500 disabled:opacity-30 flex justify-center"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            Due date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
          />
        </div>
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 flex items-center gap-1.5">
            <Repeat className="h-3.5 w-3.5" />
            Recurring
          </label>
          <select
            value={recurring}
            onChange={(e) => setRecurring(e.target.value as 'none' | 'weekly' | 'monthly')}
            className="mt-1.5 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="none">One-time</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Partial payment now ({sym})</label>
        <input
          type="number"
          min={0}
          max={total}
          step={0.01}
          value={partial}
          onChange={(e) => setPartial(Math.min(total, Math.max(0, Number(e.target.value))))}
          placeholder="0 (collect full amount later)"
          className="mt-1.5 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm font-mono text-gray-900 dark:text-white"
        />
        <p className="text-[10px] text-gray-500 mt-1">Customer pays {sym} {partial.toLocaleString()} now, {sym} {(total - partial).toLocaleString()} on {dueDate}</p>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-gray-500">Note (optional)</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Thank you for your business!"
          className="mt-1.5 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm text-gray-900 dark:text-white resize-none"
        />
      </div>

      {/* Totals + FX */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-4 space-y-2">
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>Subtotal</span>
          <span className="font-mono">{sym} {subtotal.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>Tax (16%)</span>
          <span className="font-mono">{sym} {tax.toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-base font-bold text-gray-900 dark:text-white pt-1 border-t border-gray-200 dark:border-gray-800">
          <span>Total</span>
          <span className="font-mono">{sym} {total.toLocaleString()}</span>
        </div>
        {currency !== 'KES' && (
          <div className="flex justify-between text-xs text-gray-500 pt-1">
            <span className="flex items-center gap-1">
              <Globe2 className="h-3 w-3" />
              ≈ KES at {fxLocked ? 'locked' : 'live'} rate
            </span>
            <span className="font-mono">KES {equivalentKes.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleIssue}
          disabled={!canIssue}
          className="flex-1 rounded-lg bg-blue-600 text-white px-4 py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-blue-700"
        >
          <Send className="h-4 w-4" />
          {partial > 0 ? `Collect ${sym} ${partial.toLocaleString()} now` : 'Issue invoice'}
        </button>
      </div>
    </div>
  );
}

// Page wrapper for use as a route
export function InvoicesPage() {
  const [issued, setIssued] = useState<Array<{ id: string; customer: string; total: number; currency: string; status: string; date: string }>>([
    { id: 'INV-001', customer: 'Acme Coffee Ltd', total: 12500, currency: 'KES', status: 'Paid', date: '2026-06-02' },
    { id: 'INV-002', customer: 'Blue Skies Hotel', total: 47800, currency: 'KES', status: 'Pending', date: '2026-06-01' },
    { id: 'INV-003', customer: 'Daniel Mwangi', total: 235.5, currency: 'USD', status: 'Overdue', date: '2026-05-20' },
  ]);
  const [showCreator, setShowCreator] = useState(false);

  if (showCreator) {
    return (
      <div className="space-y-4">
        <InvoiceCreator
          onCancel={() => setShowCreator(false)}
          onIssue={(inv) => {
            const newId = `INV-${String(issued.length + 1).padStart(3, '0')}`;
            setIssued((prev) => [
              {
                id: newId,
                customer: inv.customer.name,
                total: inv.total,
                currency: inv.currency,
                status: inv.partial > 0 ? 'Partially Paid' : 'Pending',
                date: new Date().toISOString().slice(0, 10),
              },
              ...prev,
            ]);
            setShowCreator(false);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Invoices</h1>
          <p className="text-sm text-gray-500">Multi-currency invoicing with FX lock and partial payments</p>
        </div>
        <button
          onClick={() => setShowCreator(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2.5 text-sm font-medium hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New invoice
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-950 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Invoice</th>
              <th className="px-4 py-3 text-left">Customer</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-right">Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {issued.map((inv) => (
              <tr key={inv.id} className="hover:bg-gray-50 dark:hover:bg-gray-950">
                <td className="px-4 py-3 font-mono text-xs text-gray-900 dark:text-white">
                  <div className="flex items-center gap-2">
                    <Receipt className="h-3.5 w-3.5 text-gray-400" />
                    {inv.id}
                  </div>
                </td>
                <td className="px-4 py-3 text-gray-900 dark:text-white">{inv.customer}</td>
                <td className="px-4 py-3 text-right font-mono text-gray-900 dark:text-white">
                  {inv.currency} {inv.total.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                      inv.status === 'Paid'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                        : inv.status === 'Overdue'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                    }`}
                  >
                    {inv.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">{inv.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
