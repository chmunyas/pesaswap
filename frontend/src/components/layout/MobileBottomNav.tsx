import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ShoppingCart, Package, Users, QrCode } from 'lucide-react';

const mobileNavItems = [
  { to: '/', icon: LayoutDashboard, label: 'Home' },
  { to: '/pos', icon: ShoppingCart, label: 'POS' },
  { to: '/items', icon: Package, label: 'Items' },
  { to: '/customers', icon: Users, label: 'People' },
  { to: '/qr', icon: QrCode, label: 'QR' },
];

export function MobileBottomNav() {
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-30 md:hidden bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="grid grid-cols-5">
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
                isActive
                  ? 'text-blue-600 dark:text-blue-400'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'
              }`
            }
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
