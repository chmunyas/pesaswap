import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { ThemeProvider } from './hooks/useTheme';
import { AppLayout } from './components/layout/AppLayout';
import { ToastContainer } from './components/ui/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PosPage } from './pages/PosPage';
import { InventoryPage } from './pages/InventoryPage';
import { CustomersPage } from './pages/CustomersPage';
import { SalesPage } from './pages/SalesPage';
import { ItemsPage } from './pages/ItemsPage';
import { ItemKitsPage } from './pages/ItemKitsPage';
import { SuppliersPage } from './pages/SuppliersPage';
import { ReportsPage } from './pages/ReportsPage';
import { ReceivingsPage } from './pages/ReceivingsPage';
import { GiftCardsPage } from './pages/GiftCardsPage';
import { MessagesPage } from './pages/MessagesPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { CashupsPage } from './pages/CashupsPage';
import { OfficePage } from './pages/OfficePage';
import { AiAssistantPage } from './pages/AiAssistantPage';
import { QRHubPage } from './pages/QRHubPage';
import { PayPage } from './pages/PayPage';
import { TablePayPage } from './pages/TablePayPage';
import { KitchenPage } from './pages/KitchenPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { MenuPage } from './pages/MenuPage';
import { PaymentMethodSummaryPage } from './pages/PaymentMethodSummaryPage';
import { I18nProvider } from './lib/i18n';

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  return (
    <AppLayout />
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      {/* Public customer-facing mobile pages (no sidebar, no auth) */}
      <Route path="/pay" element={<PayPage />} />
      <Route path="/t/:tableId" element={<TablePayPage />} />
      <Route path="/menu/:tableId" element={<MenuPage />} />
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
        <Route path="/ai" element={<AiAssistantPage />} />
      </Route>
    </Routes>
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
