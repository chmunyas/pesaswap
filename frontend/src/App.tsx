import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { AppLayout } from './components/layout/AppLayout';
import { ToastContainer } from './components/ui/Toast';
import { LoginPage } from './pages/LoginPage';
import { I18nProvider } from './lib/i18n';

// Lazy-loaded pages — split off the main bundle (named exports wrapped).
const DashboardPage              = lazy(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const PosPage                    = lazy(() => import('./pages/PosPage').then((m) => ({ default: m.PosPage })));
const InventoryPage              = lazy(() => import('./pages/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const CustomersPage              = lazy(() => import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })));
const SalesPage                  = lazy(() => import('./pages/SalesPage').then((m) => ({ default: m.SalesPage })));
const ItemsPage                  = lazy(() => import('./pages/ItemsPage').then((m) => ({ default: m.ItemsPage })));
const ItemKitsPage               = lazy(() => import('./pages/ItemKitsPage').then((m) => ({ default: m.ItemKitsPage })));
const SuppliersPage              = lazy(() => import('./pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })));
const ReportsPage                = lazy(() => import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const ReceivingsPage             = lazy(() => import('./pages/ReceivingsPage').then((m) => ({ default: m.ReceivingsPage })));
const GiftCardsPage              = lazy(() => import('./pages/GiftCardsPage').then((m) => ({ default: m.GiftCardsPage })));
const MessagesPage               = lazy(() => import('./pages/MessagesPage').then((m) => ({ default: m.MessagesPage })));
const ExpensesPage               = lazy(() => import('./pages/ExpensesPage').then((m) => ({ default: m.ExpensesPage })));
const CashupsPage                = lazy(() => import('./pages/CashupsPage').then((m) => ({ default: m.CashupsPage })));
const OfficePage                 = lazy(() => import('./pages/OfficePage').then((m) => ({ default: m.OfficePage })));
const AiAssistantPage            = lazy(() => import('./pages/AiAssistantPage').then((m) => ({ default: m.AiAssistantPage })));
const QRHubPage                  = lazy(() => import('./pages/QRHubPage').then((m) => ({ default: m.QRHubPage })));
const PayPage                    = lazy(() => import('./pages/PayPage').then((m) => ({ default: m.PayPage })));
const TablePayPage               = lazy(() => import('./pages/TablePayPage').then((m) => ({ default: m.TablePayPage })));
const KitchenPage                = lazy(() => import('./pages/KitchenPage').then((m) => ({ default: m.KitchenPage })));
const InvoicesPage               = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })));
const MenuPage                   = lazy(() => import('./pages/MenuPage').then((m) => ({ default: m.MenuPage })));
const PaymentMethodSummaryPage   = lazy(() => import('./pages/PaymentMethodSummaryPage').then((m) => ({ default: m.PaymentMethodSummaryPage })));
const ReservationsPage           = lazy(() => import('./pages/ReservationsPage').then((m) => ({ default: m.ReservationsPage })));
const FxPage                     = lazy(() => import('./pages/FxPage').then((m) => ({ default: m.FxPage })));
const ResetPinPage               = lazy(() => import('./pages/ResetPinPage').then((m) => ({ default: m.ResetPinPage })));
const PreviewPage                = lazy(() => import('./pages/PreviewPage').then((m) => ({ default: m.PreviewPage })));

function FullScreenSpinner() {
  return (
    <div className="flex items-center justify-center h-screen" role="status" aria-label="Loading">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
    </div>
  );
}

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenSpinner />;
  if (!user) return <Navigate to="/login" replace />;

  return <AppLayout />;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) return <FullScreenSpinner />;

  return (
    <Suspense fallback={<FullScreenSpinner />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />

        {/* Public customer-facing mobile pages (no sidebar, no auth) */}
        <Route path="/pay" element={<PayPage />} />
        <Route path="/t/:tableId" element={<TablePayPage />} />
        <Route path="/menu/:tableId" element={<MenuPage />} />
        <Route path="/reset-pin" element={<ResetPinPage />} />
        <Route path="/preview" element={<PreviewPage />} />
        <Route path="/preview/*" element={<PreviewPage />} />

        {/* /bar — convenience shortcut for the bar staff (preserves filter on KDS) */}
        <Route path="/bar" element={<Navigate to="/kds?destination=bar" replace />} />

        <Route element={<ProtectedRoutes />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/pos" element={<PosPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/items" element={<ItemsPage />} />
          <Route path="/item-kits" element={<ItemKitsPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/receivings" element={<ReceivingsPage />} />
          <Route path="/giftcards" element={<GiftCardsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/cashups" element={<CashupsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/office" element={<OfficePage />} />
          <Route path="/qr" element={<QRHubPage />} />
          <Route path="/kds" element={<KitchenPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/payment-summary" element={<PaymentMethodSummaryPage />} />
          <Route path="/reservations" element={<ReservationsPage />} />
          <Route path="/fx" element={<FxPage />} />
          <Route path="/ai" element={<AiAssistantPage />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <AppRoutes />
            <ToastContainer />
          </AuthProvider>
        </I18nProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
