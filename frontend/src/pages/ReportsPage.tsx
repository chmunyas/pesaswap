import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BarChart3, Briefcase, Calculator, Package, Receipt, TrendingUp, Users, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
}

interface ReportMetric {
  label: string;
  value: string;
}

interface ReportPreviewRow {
  label: string;
  value: number;
}

const REPORT_CARDS: ReportCard[] = [
  { id: 'sales', title: 'Sales Summary', description: 'Daily revenue, average ticket size, and top payment types.', icon: TrendingUp, accentClass: 'from-blue-500/20 to-cyan-500/20 text-blue-600 dark:text-blue-300' },
  { id: 'inventory', title: 'Inventory Report', description: 'Stock valuation, fast movers, and low-stock watchlist.', icon: Package, accentClass: 'from-emerald-500/20 to-lime-500/20 text-emerald-600 dark:text-emerald-300' },
  { id: 'customers', title: 'Customer Report', description: 'Loyalty trends, repeat visits, and customer lifetime value.', icon: Users, accentClass: 'from-violet-500/20 to-fuchsia-500/20 text-violet-600 dark:text-violet-300' },
  { id: 'employees', title: 'Employee Report', description: 'Sales per shift, register performance, and staffing insights.', icon: Briefcase, accentClass: 'from-amber-500/20 to-orange-500/20 text-amber-600 dark:text-amber-300' },
  { id: 'tax', title: 'Tax Report', description: 'Taxable sales, liabilities, and filing-ready summaries.', icon: Calculator, accentClass: 'from-rose-500/20 to-pink-500/20 text-rose-600 dark:text-rose-300' },
  { id: 'expenses', title: 'Expenses Report', description: 'Operating spend, category totals, and monthly burn overview.', icon: Wallet, accentClass: 'from-slate-500/20 to-gray-500/20 text-slate-600 dark:text-slate-300' },
];

const REPORT_METRICS: ReportMetric[] = [
  { label: 'Revenue in Range', value: formatCurrency(28490) },
  { label: 'Gross Margin', value: '62.4%' },
  { label: 'Transactions', value: '1,284' },
  { label: 'Average Ticket', value: formatCurrency(22.19) },
];

const REPORT_PREVIEWS: Record<string, ReportPreviewRow[]> = {
  sales: [
    { label: 'Mon', value: 4200 },
    { label: 'Tue', value: 3980 },
    { label: 'Wed', value: 4450 },
    { label: 'Thu', value: 5120 },
    { label: 'Fri', value: 5460 },
    { label: 'Sat', value: 6100 },
  ],
  inventory: [
    { label: 'Coffee', value: 24 },
    { label: 'Bakery', value: 12 },
    { label: 'Dairy', value: 8 },
    { label: 'Food', value: 14 },
    { label: 'Supplies', value: 5 },
    { label: 'Tea', value: 7 },
  ],
  customers: [
    { label: 'New', value: 86 },
    { label: 'Returning', value: 204 },
    { label: 'VIP', value: 42 },
    { label: 'Lapsed', value: 19 },
  ],
  employees: [
    { label: 'Amina', value: 126 },
    { label: 'Naomi', value: 118 },
    { label: 'Moses', value: 103 },
    { label: 'Grace', value: 97 },
  ],
  tax: [
    { label: 'Taxable', value: 22480 },
    { label: 'Exempt', value: 1820 },
    { label: 'Collected', value: 1686 },
  ],
  expenses: [
    { label: 'Rent', value: 4200 },
    { label: 'Payroll', value: 9300 },
    { label: 'Utilities', value: 1160 },
    { label: 'Supplies', value: 1860 },
    { label: 'Other', value: 740 },
  ],
};

const REPORT_TABLE_ROWS: Record<string, { label: string; detail: string; amount: string }[]> = {
  sales: [
    { label: 'Best Day', detail: 'Saturday', amount: formatCurrency(6100) },
    { label: 'Top Payment Type', detail: 'Card', amount: '48%' },
    { label: 'Refund Rate', detail: 'This period', amount: '1.8%' },
  ],
  inventory: [
    { label: 'Low Stock SKUs', detail: 'Needs reorder', amount: '12' },
    { label: 'Inventory Value', detail: 'Current on hand', amount: formatCurrency(18240) },
    { label: 'Shrinkage', detail: 'Month to date', amount: '0.9%' },
  ],
  customers: [
    { label: 'Repeat Purchase Rate', detail: 'Within 30 days', amount: '63%' },
    { label: 'Top Segment', detail: 'Morning commuters', amount: '38%' },
    { label: 'Average CLV', detail: 'Active customers', amount: formatCurrency(462) },
  ],
  employees: [
    { label: 'Top Performer', detail: 'Amina', amount: formatCurrency(8420) },
    { label: 'Average Tickets / Shift', detail: 'All staff', amount: '37' },
    { label: 'Upsell Rate', detail: 'Add-on attachment', amount: '24%' },
  ],
  tax: [
    { label: 'Tax Liability', detail: 'Filing period', amount: formatCurrency(1686) },
    { label: 'Primary Tax Band', detail: 'Prepared foods', amount: '7.5%' },
    { label: 'Adjustment Entries', detail: 'Pending review', amount: '3' },
  ],
  expenses: [
    { label: 'Largest Category', detail: 'Payroll', amount: formatCurrency(9300) },
    { label: 'Budget Variance', detail: 'Against target', amount: '+4.1%' },
    { label: 'Receipts Captured', detail: 'This month', amount: '94%' },
  ],
};

export function ReportsPage() {
  const [loading, setLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<string>('sales');
  const [generatedReport, setGeneratedReport] = useState<string>('sales');
  const [startDate, setStartDate] = useState('2026-05-01');
  const [endDate, setEndDate] = useState('2026-06-02');
  const [stats, setStats] = useState<ReportMetric[]>(REPORT_METRICS);

  useEffect(() => {
    api.reports.list()
      .then((res) => {
        const payload = Array.isArray(res.data.stats)
          ? res.data.stats.filter((metric): metric is Record<string, unknown> => typeof metric === 'object' && metric !== null)
          : [];

        if (payload.length > 0) {
          setStats(
            payload.map((metric) => ({
              label: String(metric.label ?? 'Metric'),
              value: String(metric.value ?? '—'),
            })),
          );
          return;
        }

        setStats(REPORT_METRICS);
      })
      .catch(() => setStats(REPORT_METRICS))
      .finally(() => setLoading(false));
  }, []);

  const activePreview = useMemo(() => REPORT_PREVIEWS[generatedReport] ?? REPORT_PREVIEWS.sales, [generatedReport]);
  const activeRows = useMemo(() => REPORT_TABLE_ROWS[generatedReport] ?? REPORT_TABLE_ROWS.sales, [generatedReport]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Generate polished summaries for sales, inventory, tax, and back-office performance.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
            <Receipt className="h-4 w-4 text-blue-500" />
            Ready to export PDF / CSV
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">Start date</label>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">End date</label>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900" />
          </div>
          <button onClick={() => setGeneratedReport(selectedReport)} className="mt-auto inline-flex items-center justify-center rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
            Generate Selected Report
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((metric) => (
              <div key={metric.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400">{metric.label}</p>
                <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{metric.value}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {REPORT_CARDS.map((report) => {
              const Icon = report.icon;
              const isSelected = selectedReport === report.id;

              return (
                <div key={report.id} className={`rounded-xl border bg-white p-5 shadow-sm transition hover:shadow-md dark:bg-gray-800 ${isSelected ? 'border-blue-500 dark:border-blue-500' : 'border-gray-200 dark:border-gray-700'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className={`rounded-xl bg-gradient-to-br p-3 ${report.accentClass}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <button onClick={() => { setSelectedReport(report.id); setGeneratedReport(report.id); }} className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-600">
                      Generate
                    </button>
                  </div>
                  <h2 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">{report.title}</h2>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{report.description}</p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_380px]">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Generated preview</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{REPORT_CARDS.find((report) => report.id === generatedReport)?.title} · {startDate} to {endDate}</p>
                </div>
                <BarChart3 className="h-5 w-5 text-blue-500" />
              </div>
              <div className="mt-6 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activePreview}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.2)" />
                    <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid rgba(148, 163, 184, 0.15)',
                        backgroundColor: '#111827',
                        color: '#f8fafc',
                      }}
                    />
                    <Bar dataKey="value" fill="#3b82f6" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Key findings</h2>
              <div className="mt-5 space-y-4">
                {activeRows.map((row) => (
                  <div key={row.label} className="rounded-xl bg-gray-50 p-4 dark:bg-gray-900/60">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{row.label}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{row.detail}</p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{row.amount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
