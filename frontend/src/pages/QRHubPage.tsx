import { useState, useEffect } from 'react';
import { QrCode, UtensilsCrossed, FileText, CreditCard, Sparkles } from 'lucide-react';
import { TableQRManager } from '../components/qr/TableQRManager';
import { InvoiceQR } from '../components/qr/InvoiceQR';
import { PaymentQR } from '../components/qr/PaymentQR';

type Tab = 'tables' | 'invoices' | 'payments';

const MOCK_TABLES = [
  { dinner_table_id: 1, name: 'Table 1', status: 0 },
  { dinner_table_id: 2, name: 'Table 2', status: 1 },
  { dinner_table_id: 3, name: 'Table 3', status: 0 },
  { dinner_table_id: 4, name: 'Table 4', status: 0 },
  { dinner_table_id: 5, name: 'Table 5', status: 1 },
  { dinner_table_id: 6, name: 'Table 6', status: 0 },
  { dinner_table_id: 7, name: 'Patio A', status: 0 },
  { dinner_table_id: 8, name: 'Patio B', status: 1 },
  { dinner_table_id: 9, name: 'Bar 1', status: 0 },
  { dinner_table_id: 10, name: 'Bar 2', status: 0 },
];

const MOCK_INVOICES = [
  {
    sale_id: 101,
    invoice_number: 'INV-2026-0042',
    sale_time: '2026-06-02T14:30:00',
    customer_name: 'Sarah Johnson',
    total: 47.50,
    tax: 3.80,
    items: [
      { name: 'Latte', quantity: 2, price: 4.50 },
      { name: 'Croissant', quantity: 3, price: 3.00 },
      { name: 'Sandwich', quantity: 2, price: 7.50 },
      { name: 'Cookie', quantity: 4, price: 2.50 },
    ],
    payment_type: 'Card',
    status: 'Completed',
  },
  {
    sale_id: 102,
    invoice_number: 'INV-2026-0043',
    sale_time: '2026-06-02T15:45:00',
    customer_name: 'Mike Chen',
    total: 23.25,
    tax: 1.86,
    items: [
      { name: 'Espresso', quantity: 3, price: 3.50 },
      { name: 'Muffin', quantity: 2, price: 3.25 },
      { name: 'Green Tea', quantity: 1, price: 2.75 },
    ],
    payment_type: 'Cash',
    status: 'Completed',
  },
  {
    sale_id: 103,
    invoice_number: 'INV-2026-0044',
    sale_time: '2026-06-02T16:20:00',
    customer_name: 'Emma Wilson',
    total: 62.00,
    tax: 4.96,
    items: [
      { name: 'Cappuccino', quantity: 4, price: 4.00 },
      { name: 'Sandwich', quantity: 3, price: 7.50 },
      { name: 'Smoothie', quantity: 2, price: 5.50 },
      { name: 'Salad', quantity: 1, price: 8.50 },
    ],
    payment_type: 'Card',
    status: 'Pending',
  },
];

export function QRHubPage() {
  const [activeTab, setActiveTab] = useState<Tab>('tables');
  const [tables, setTables] = useState(MOCK_TABLES);
  const [selectedInvoice, setSelectedInvoice] = useState(MOCK_INVOICES[0]);

  useEffect(() => {
    // Try to fetch real tables from API
    fetch('/api/dinner-tables')
      .then(r => r.json())
      .then(res => {
        if (res.success && res.data?.length) setTables(res.data);
      })
      .catch(() => {}); // Keep mock data
  }, []);

  const tabs = [
    { id: 'tables' as Tab, label: 'Table Ordering', icon: UtensilsCrossed, desc: 'QR codes for dine-in table ordering' },
    { id: 'invoices' as Tab, label: 'Invoice & Receipt', icon: FileText, desc: 'QR-enabled invoices for customers' },
    { id: 'payments' as Tab, label: 'Payment', icon: CreditCard, desc: 'Scan-to-pay QR for mobile payments' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 p-3 shadow-lg shadow-indigo-500/25">
            <QrCode className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">QR Code Hub</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Tables, Invoicing & Payments — all via QR</p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-200 dark:border-indigo-800 px-3 py-2">
          <Sparkles className="h-4 w-4 text-indigo-500" />
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Contactless Experience</span>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-all ${
              activeTab === tab.id
                ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm'
                : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div className={`rounded-lg p-2 ${
              activeTab === tab.id ? 'bg-indigo-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
            }`}>
              <tab.icon className="h-5 w-5" />
            </div>
            <div>
              <p className={`text-sm font-medium ${
                activeTab === tab.id ? 'text-indigo-700 dark:text-indigo-300' : 'text-gray-900 dark:text-white'
              }`}>
                {tab.label}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{tab.desc}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'tables' && (
          <TableQRManager tables={tables} storeName="PESASWAP" />
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-6">
            {/* Invoice selector */}
            <div className="flex items-center gap-3 overflow-x-auto pb-2">
              {MOCK_INVOICES.map(inv => (
                <button
                  key={inv.sale_id}
                  onClick={() => setSelectedInvoice(inv)}
                  className={`flex-shrink-0 rounded-lg border px-4 py-2 text-sm transition ${
                    selectedInvoice.sale_id === inv.sale_id
                      ? 'border-blue-300 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700 text-blue-700 dark:text-blue-300'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {inv.invoice_number}
                </button>
              ))}
            </div>

            {/* Invoice display */}
            <div className="max-w-md mx-auto">
              <InvoiceQR invoice={selectedInvoice} storeName="PESASWAP" storeAddress="123 Main Street, Anytown" />
            </div>

            {/* Info */}
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4">
              <h4 className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-1">How Invoice QR Works</h4>
              <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
                <li>• Each sale generates a unique QR code linked to its invoice</li>
                <li>• Customers scan to view their digital receipt on their phone</li>
                <li>• QR encodes sale ID, invoice number, and total for verification</li>
                <li>• Print receipts with embedded QR for paperless record-keeping</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'payments' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Active Payment QR */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">Active Payment Request</h3>
                <PaymentQR
                  saleId={103}
                  amount={62.00}
                  merchantName="PESASWAP"
                  invoiceNumber="INV-2026-0044"
                />
              </div>

              {/* How it works */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">How Payment QR Works</h3>
                
                <div className="space-y-3">
                  {[
                    { step: '1', title: 'Generate', desc: 'A unique payment QR is created for each sale with the exact amount' },
                    { step: '2', title: 'Scan', desc: 'Customer scans QR with their mobile payment app (Apple Pay, Google Pay, etc.)' },
                    { step: '3', title: 'Pay', desc: 'Payment is processed securely through the payment gateway' },
                    { step: '4', title: 'Confirm', desc: 'POS automatically detects payment and marks the sale as complete' },
                  ].map(item => (
                    <div key={item.step} className="flex gap-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-white text-sm font-bold">
                        {item.step}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{item.title}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Integration note */}
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 p-4">
                  <h4 className="text-sm font-medium text-emerald-700 dark:text-emerald-300 mb-1">💡 Integration Ready</h4>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">
                    The payment QR encodes standardized payment data (amount, reference, merchant). 
                    Connect your payment gateway (Stripe, Square, PayPal) to enable real scan-to-pay functionality.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
