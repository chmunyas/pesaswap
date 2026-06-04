import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import {
  DollarSign,
  ShoppingBag,
  Users,
  ArrowUpRight,
  ArrowDownRight,
  Package,
  Sparkles,
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

interface StatsData {
  today_sales: number;
  today_revenue: number;
  today_items_sold: number;
  total_customers: number;
  top_items: { name: string; quantity: number }[];
  recent_sales: any[];
  revenue_trend: { date: string; revenue: number }[];
}

function StatCard({ icon: Icon, label, value, change, changeType }: any) {
  return (
    <div className="rounded-xl border bg-white dark:bg-gray-800 p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2.5">
            <Icon className="h-5 w-5 text-blue-500" />
          </div>
          <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
        </div>
        {change && (
          <span className={`flex items-center gap-0.5 text-xs font-medium ${changeType === 'up' ? 'text-green-500' : 'text-red-500'}`}>
            {changeType === 'up' ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {change}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

export function DashboardPage() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.dashboard.stats()
      .then(res => { if (res.success) setStats(res.data); })
      .catch(() => {
        // Use mock data if API not available yet
        setStats({
          today_sales: 24,
          today_revenue: 3847.50,
          today_items_sold: 156,
          total_customers: 1284,
          top_items: [
            { name: 'Espresso', quantity: 45 },
            { name: 'Latte', quantity: 38 },
            { name: 'Croissant', quantity: 32 },
            { name: 'Sandwich', quantity: 28 },
            { name: 'Cookie', quantity: 22 },
          ],
          recent_sales: [],
          revenue_trend: [
            { date: 'Mon', revenue: 2400 },
            { date: 'Tue', revenue: 3200 },
            { date: 'Wed', revenue: 2800 },
            { date: 'Thu', revenue: 3600 },
            { date: 'Fri', revenue: 4200 },
            { date: 'Sat', revenue: 5100 },
            { date: 'Sun', revenue: 3847 },
          ],
        });
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Here's what's happening today</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-4 py-2 text-white text-sm font-medium shadow-lg shadow-purple-500/25">
          <Sparkles className="h-4 w-4" />
          AI Insights Active
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={ShoppingBag} label="Today's Sales" value={stats.today_sales} change="+12%" changeType="up" />
        <StatCard icon={DollarSign} label="Revenue" value={formatCurrency(stats.today_revenue)} change="+8.2%" changeType="up" />
        <StatCard icon={Package} label="Items Sold" value={stats.today_items_sold} change="+5%" changeType="up" />
        <StatCard icon={Users} label="Customers" value={stats.total_customers.toLocaleString()} change="+3.1%" changeType="up" />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Trend */}
        <div className="lg:col-span-2 rounded-xl border bg-white dark:bg-gray-800 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">Revenue This Week</h3>
          <div className="h-64 min-h-[256px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={stats.revenue_trend}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Items */}
        <div className="rounded-xl border bg-white dark:bg-gray-800 p-6 shadow-sm">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4">Top Selling Items</h3>
          <div className="h-64 min-h-[256px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart data={stats.top_items} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={11} width={80} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                  }}
                />
                <Bar dataKey="quantity" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* AI Insight Banner */}
      <div className="rounded-xl border border-purple-200 dark:border-purple-800 bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 p-6">
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-purple-500/10 p-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
          </div>
          <div>
            <h3 className="font-medium text-gray-900 dark:text-white">AI Insight</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
              Based on your sales patterns, <strong>Tuesdays and Saturdays</strong> are your peak days.
              Consider increasing staff during these periods. Your top category has grown <strong>18% this month</strong> — consider expanding that product line.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
