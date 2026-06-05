import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useTheme } from '../../hooks/useTheme';
import { MobileBottomNav } from './MobileBottomNav';
import { useI18n, LOCALE_LABELS, type Locale } from '../../lib/i18n';
import { Activity, ChefHat, Coffee, FileText, Languages, Calendar, Globe2, ScanLine, Smartphone, Ticket } from 'lucide-react';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  MessageSquareText,
  LogOut,
  Sun,
  Moon,
  Store,
  Menu,
  Boxes,
  Truck,
  BarChart3,
  ClipboardList,
  CreditCard,
  Mail,
  Receipt,
  Wallet,
  Settings,
  QrCode,
} from 'lucide-react';
import { useState } from 'react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'main' },
  { to: '/pos', icon: ShoppingCart, label: 'Point of Sale', group: 'main' },
  { to: '/sales', icon: Receipt, label: 'Sales', group: 'main' },
  { to: '/items', icon: Package, label: 'Items', group: 'main' },
  { to: '/item-kits', icon: Boxes, label: 'Item Kits', group: 'main' },
  { to: '/customers', icon: Users, label: 'Customers', group: 'main' },
  { to: '/suppliers', icon: Truck, label: 'Suppliers', group: 'main' },
  { to: '/receivings', icon: ClipboardList, label: 'Receivings', group: 'main' },
  { to: '/giftcards', icon: CreditCard, label: 'Gift Cards', group: 'main' },
  { to: '/tickets', icon: Ticket, label: 'Ticketing', group: 'main' },
  { to: '/tickets/dashboard', icon: Activity, label: 'Gate Dashboard', group: 'main' },
  { to: '/checkin', icon: ScanLine, label: 'Gate Scanner', group: 'main' },
  { to: '/qr', icon: QrCode, label: 'QR Codes', group: 'main' },
  { to: '/kds', icon: ChefHat, label: 'Kitchen Display', group: 'main' },
  { to: '/kds?destination=bar', icon: Coffee, label: 'Bar Display', group: 'main' },
  { to: '/reservations', icon: Calendar, label: 'Reservations', group: 'main' },
  { to: '/invoices', icon: FileText, label: 'Invoices', group: 'office' },
  { to: '/payment-summary', icon: Wallet, label: 'Payment Summary', group: 'office' },
  { to: '/fx', icon: Globe2, label: 'FX Converter', group: 'office' },
  { to: '/expenses', icon: Wallet, label: 'Expenses', group: 'office' },
  { to: '/cashups', icon: Wallet, label: 'Cashups', group: 'office' },
  { to: '/reports', icon: BarChart3, label: 'Reports', group: 'office' },
  { to: '/messages', icon: Mail, label: 'Messages', group: 'office' },
  { to: '/office', icon: Settings, label: 'Office', group: 'office' },
  { to: '/preview', icon: Smartphone, label: 'Mobile Preview', group: 'ai' },
  { to: '/ai', icon: MessageSquareText, label: 'AI Assistant', group: 'ai' },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { locale, setLocale } = useI18n();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 transform bg-hsl(var(--card)) border-r border-hsl(var(--border)) transition-transform duration-200 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ backgroundColor: 'hsl(var(--card))' }}
      >
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center gap-3 border-b px-6">
            <Store className="h-8 w-8 text-blue-500" />
            <div>
              <h1 className="text-lg font-bold leading-none">PESASWAP</h1>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">Modern POS</span>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 overflow-y-auto p-4 space-y-6">
            <div className="space-y-1">
              {navItems.filter(i => i.group === 'main').map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>

            <div>
              <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Office</p>
              <div className="space-y-1">
                {navItems.filter(i => i.group === 'office').map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>

            <div>
              <p className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">AI</p>
              <div className="space-y-1">
                {navItems.filter(i => i.group === 'ai').map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                          : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          </nav>

          {/* Footer */}
          <div className="border-t p-4 space-y-2">
            {/* Language selector */}
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-[hsl(var(--muted-foreground))]">
              <Languages className="h-4 w-4 shrink-0" />
              <select
                value={locale}
                onChange={(e) => setLocale(e.target.value as Locale)}
                className="flex-1 bg-transparent text-sm focus:outline-none cursor-pointer"
              >
                {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
                  <option key={l} value={l} className="bg-[hsl(var(--card))]">
                    {LOCALE_LABELS[l]}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={toggle}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
            <button
              onClick={logout}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
            >
              <LogOut className="h-5 w-5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden rounded-lg p-2 hover:bg-[hsl(var(--muted))]"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-4 ml-auto">
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              Welcome, <strong className="text-[hsl(var(--foreground))]">{user?.first_name || 'Admin'}</strong>
            </span>
            <div className="h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-medium">
              {user?.first_name?.[0] || 'A'}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6 pb-20 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav — only on small screens */}
      <MobileBottomNav />
    </div>
  );
}
