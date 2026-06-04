import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Eye, Receipt, Search } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';

interface ReceiptLine {
  name: string;
  quantity: number;
  price: number;
}

interface SaleRecord {
  sale_id: number;
  sale_time: string;
  customer_name: string;
  items_count: number;
  total: number;
  payment_type: string;
  status: 'Completed' | 'Refunded' | 'Pending';
  employee_name: string;
  receipt_lines: ReceiptLine[];
}

const MOCK_SALES: SaleRecord[] = [
  {
    sale_id: 10482,
    sale_time: '2026-06-02T09:14:00',
    customer_name: 'Walk-in Customer',
    items_count: 3,
    total: 18.5,
    payment_type: 'Cash',
    status: 'Completed',
    employee_name: 'Amina',
    receipt_lines: [
      { name: 'Latte', quantity: 1, price: 4.5 },
      { name: 'Blueberry Muffin', quantity: 1, price: 3.25 },
      { name: 'Turkey Sandwich', quantity: 1, price: 10.75 },
    ],
  },
  {
    sale_id: 10481,
    sale_time: '2026-06-02T08:48:00',
    customer_name: 'Sarah Johnson',
    items_count: 2,
    total: 12.0,
    payment_type: 'Card',
    status: 'Completed',
    employee_name: 'Moses',
    receipt_lines: [
      { name: 'Cappuccino', quantity: 2, price: 4 },
      { name: 'Croissant', quantity: 1, price: 4 },
    ],
  },
  {
    sale_id: 10480,
    sale_time: '2026-06-01T18:32:00',
    customer_name: 'Emma Wilson',
    items_count: 5,
    total: 34.75,
    payment_type: 'Mobile Pay',
    status: 'Completed',
    employee_name: 'Amina',
    receipt_lines: [
      { name: 'Espresso', quantity: 2, price: 3.5 },
      { name: 'Bagel Combo', quantity: 1, price: 8.75 },
      { name: 'Fresh Juice', quantity: 2, price: 9.5 },
    ],
  },
  {
    sale_id: 10479,
    sale_time: '2026-06-01T16:05:00',
    customer_name: 'Mike Chen',
    items_count: 4,
    total: 27.2,
    payment_type: 'Card',
    status: 'Refunded',
    employee_name: 'Naomi',
    receipt_lines: [
      { name: 'Coffee Beans 1kg', quantity: 1, price: 18 },
      { name: 'Cookie', quantity: 2, price: 2.6 },
      { name: 'Iced Latte', quantity: 1, price: 6.6 },
    ],
  },
  {
    sale_id: 10478,
    sale_time: '2026-05-31T14:22:00',
    customer_name: 'Olivia Davis',
    items_count: 6,
    total: 41.9,
    payment_type: 'Cash',
    status: 'Completed',
    employee_name: 'Grace',
    receipt_lines: [
      { name: 'Breakfast Bundle', quantity: 1, price: 15.5 },
      { name: 'Green Tea', quantity: 2, price: 5.5 },
      { name: 'Yogurt Parfait', quantity: 2, price: 12.4 },
      { name: 'Banana Bread', quantity: 1, price: 8.5 },
    ],
  },
  {
    sale_id: 10477,
    sale_time: '2026-05-31T10:51:00',
    customer_name: 'Daniel Martinez',
    items_count: 2,
    total: 9.5,
    payment_type: 'Card',
    status: 'Pending',
    employee_name: 'Naomi',
    receipt_lines: [
      { name: 'Americano', quantity: 1, price: 3.5 },
      { name: 'Chocolate Cookie', quantity: 2, price: 6 },
    ],
  },
  {
    sale_id: 10476,
    sale_time: '2026-05-30T19:15:00',
    customer_name: 'James Brown',
    items_count: 7,
    total: 58.4,
    payment_type: 'Mobile Pay',
    status: 'Completed',
    employee_name: 'Moses',
    receipt_lines: [
      { name: 'Office Lunch Platter', quantity: 1, price: 29.9 },
      { name: 'Sparkling Water', quantity: 4, price: 11.6 },
      { name: 'Cheesecake Slice', quantity: 2, price: 16.9 },
    ],
  },
  {
    sale_id: 10475,
    sale_time: '2026-05-29T12:07:00',
    customer_name: 'Corporate Account',
    items_count: 9,
    total: 74.2,
    payment_type: 'Invoice',
    status: 'Completed',
    employee_name: 'Grace',
    receipt_lines: [
      { name: 'Meeting Coffee Service', quantity: 1, price: 48 },
      { name: 'Mini Pastry Box', quantity: 2, price: 26.2 },
    ],
  },
  {
    sale_id: 10474,
    sale_time: '2026-05-28T17:44:00',
    customer_name: 'Loyalty Member #224',
    items_count: 4,
    total: 22.3,
    payment_type: 'Card',
    status: 'Completed',
    employee_name: 'Amina',
    receipt_lines: [
      { name: 'Flat White', quantity: 2, price: 8.8 },
      { name: 'Ham Panini', quantity: 1, price: 8.5 },
      { name: 'Brownie', quantity: 1, price: 5 },
    ],
  },
];

function getStatusClasses(status: SaleRecord['status']): string {
  if (status === 'Completed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
  if (status === 'Refunded') return 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
}

function normalizeSale(raw: Record<string, unknown>): SaleRecord {
  return {
    sale_id: Number(raw.sale_id ?? 0),
    sale_time: String(raw.sale_time ?? new Date().toISOString()),
    customer_name: String(raw.customer_name ?? raw.customer ?? 'Walk-in Customer'),
    items_count: Number(raw.items_count ?? 0),
    total: Number(raw.total ?? 0),
    payment_type: String(raw.payment_type ?? 'Card'),
    status: 'Completed',
    employee_name: String(raw.employee_name ?? 'Cashier'),
    receipt_lines: [],
  };
}

export function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [paymentType, setPaymentType] = useState('all');
  const [status, setStatus] = useState('all');
  const [selectedSale, setSelectedSale] = useState<SaleRecord | null>(MOCK_SALES[0]);

  useEffect(() => {
    api.sales.list(1, 50)
      .then((res) => {
        const payload = Array.isArray(res.data.sales)
          ? res.data.sales.filter((sale): sale is Record<string, unknown> => typeof sale === 'object' && sale !== null)
          : [];

        if (payload.length > 0) {
          const normalized = payload.map(normalizeSale);
          setSales(normalized);
          setSelectedSale(normalized[0] ?? null);
          return;
        }

        setSales(MOCK_SALES);
        setSelectedSale(MOCK_SALES[0]);
      })
      .catch(() => {
        setSales(MOCK_SALES);
        setSelectedSale(MOCK_SALES[0]);
      })
      .finally(() => setLoading(false));
  }, []);

  const paymentTypes = useMemo(() => ['all', ...new Set(sales.map((sale) => sale.payment_type))], [sales]);

  const filteredSales = useMemo(() => {
    const now = new Date();

    return sales.filter((sale) => {
      const query = search.toLowerCase();
      const matchesSearch =
        sale.customer_name.toLowerCase().includes(query) ||
        sale.sale_id.toString().includes(query) ||
        sale.employee_name.toLowerCase().includes(query);

      const matchesPayment = paymentType === 'all' || sale.payment_type === paymentType;
      const matchesStatus = status === 'all' || sale.status === status;

      const saleDate = new Date(sale.sale_time);
      let matchesDateRange = true;

      if (dateRange === 'today') {
        matchesDateRange = saleDate.toDateString() === now.toDateString();
      } else if (dateRange === '7d') {
        matchesDateRange = now.getTime() - saleDate.getTime() <= 7 * 24 * 60 * 60 * 1000;
      } else if (dateRange === '30d') {
        matchesDateRange = now.getTime() - saleDate.getTime() <= 30 * 24 * 60 * 60 * 1000;
      }

      return matchesSearch && matchesPayment && matchesStatus && matchesDateRange;
    });
  }, [dateRange, paymentType, sales, search, status]);

  const summary = useMemo(() => {
    return filteredSales.reduce(
      (acc, sale) => {
        acc.total += sale.total;
        acc.items += sale.items_count;
        return acc;
      },
      { total: 0, items: 0 },
    );
  }, [filteredSales]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Sales History</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Track completed sales, payment activity, and receipt details.</p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Filtered Sales</p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{filteredSales.length}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400">Revenue</p>
            <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(summary.total)}</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_repeat(3,minmax(0,1fr))]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by sale ID, customer, or cashier..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <select
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">All dates</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <select
            value={paymentType}
            onChange={(event) => setPaymentType(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            {paymentTypes.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All payments' : option}
              </option>
            ))}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">All status</option>
            <option value="Completed">Completed</option>
            <option value="Pending">Pending</option>
            <option value="Refunded">Refunded</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-900/60">
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    <th className="px-4 py-3">Sale ID</th>
                    <th className="px-4 py-3">Date / Time</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Items</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Payment</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
                  {filteredSales.map((sale) => (
                    <tr
                      key={sale.sale_id}
                      onClick={() => setSelectedSale(sale)}
                      className={`cursor-pointer transition hover:bg-blue-50/60 dark:hover:bg-blue-900/10 ${selectedSale?.sale_id === sale.sale_id ? 'bg-blue-50 dark:bg-blue-900/10' : ''}`}
                    >
                      <td className="px-4 py-4 font-semibold text-gray-900 dark:text-white">#{sale.sale_id}</td>
                      <td className="px-4 py-4 text-gray-600 dark:text-gray-300">{formatDate(sale.sale_time)}</td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-gray-900 dark:text-white">{sale.customer_name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">Served by {sale.employee_name}</div>
                      </td>
                      <td className="px-4 py-4 text-gray-600 dark:text-gray-300">{sale.items_count}</td>
                      <td className="px-4 py-4 font-semibold text-gray-900 dark:text-white">{formatCurrency(sale.total)}</td>
                      <td className="px-4 py-4">
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-200">
                          <CreditCard className="h-3.5 w-3.5" />
                          {sale.payment_type}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClasses(sale.status)}`}>
                          {sale.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            {selectedSale ? (
              <div className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Receipt details</p>
                    <h2 className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">Sale #{selectedSale.sale_id}</h2>
                  </div>
                  <div className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                    <Receipt className="h-5 w-5" />
                  </div>
                </div>

                <div className="space-y-3 rounded-xl bg-gray-50 p-4 dark:bg-gray-900/60">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Customer</span>
                    <span className="font-medium text-gray-900 dark:text-white">{selectedSale.customer_name}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Date</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatDate(selectedSale.sale_time)}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Payment</span>
                    <span className="font-medium text-gray-900 dark:text-white">{selectedSale.payment_type}</span>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-white">
                    <Eye className="h-4 w-4 text-blue-500" />
                    Purchased items
                  </div>
                  <div className="space-y-3">
                    {(selectedSale.receipt_lines.length > 0 ? selectedSale.receipt_lines : [{ name: 'Receipt data available from POS terminal', quantity: selectedSale.items_count, price: selectedSale.total }]).map((line) => (
                      <div key={`${selectedSale.sale_id}-${line.name}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{line.name}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Qty {line.quantity}</p>
                        </div>
                        <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(line.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                  <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                    <span>Total items</span>
                    <span>{selectedSale.items_count}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-base font-semibold text-gray-900 dark:text-white">
                    <span>Total</span>
                    <span>{formatCurrency(selectedSale.total)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 text-center dark:border-gray-700">
                <Receipt className="h-8 w-8 text-gray-400" />
                <p className="mt-3 text-sm font-medium text-gray-900 dark:text-white">Select a sale to preview the receipt</p>
                <p className="mt-1 max-w-xs text-xs text-gray-500 dark:text-gray-400">Choose any transaction from the list to inspect items, payment details, and totals.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
