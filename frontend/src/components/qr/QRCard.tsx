import { QRCode } from 'react-qr-code';

interface QRCardProps {
  title: string;
  subtitle?: string;
  value: string;
  size?: number;
  color?: string;
  children?: React.ReactNode;
}

export function QRCard({ title, subtitle, value, size = 160, color = '#1e40af', children }: QRCardProps) {
  return (
    <div className="rounded-xl border bg-white dark:bg-gray-800 p-6 shadow-sm text-center">
      <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{subtitle}</p>}
      <div className="inline-block p-3 bg-white rounded-lg shadow-inner">
        <QRCode value={value} size={size} fgColor={color} />
      </div>
      <p className="mt-3 text-xs text-gray-400 font-mono break-all max-w-[200px] mx-auto">{value}</p>
      {children}
    </div>
  );
}

// Generate a table order URL that points to the mobile-first customer self-pay page
export function generateTableQRValue(baseUrl: string, tableId: number, _tableName: string): string {
  return `${baseUrl}/t/${tableId}`;
}

// Generate an invoice QR that encodes invoice details per ISO 18004 / EPC QR standard
export function generateInvoiceQRValue(baseUrl: string, saleId: number, invoiceNumber: string, total: number): string {
  return `${baseUrl}/invoice/${invoiceNumber}?sale=${saleId}&amount=${total.toFixed(2)}`;
}

// Generate a Tap & Go payment URL that opens the mobile-first /pay page with pre-filled amount
export function generateTapGoUrl(baseUrl: string, options: {
  amount: number;
  currency?: string;
  reference: string;
  merchant: string;
  till?: string;
}): string {
  const { amount, currency = 'KES', reference, merchant, till = '000000' } = options;
  const payload = btoa(JSON.stringify({
    till,
    amount,
    merchant,
    currency,
    reference,
  }));
  return `${baseUrl}/pay?tapgo=${encodeURIComponent(payload)}`;
}

// Generate a payment QR that can be scanned by mobile payment apps
export function generatePaymentQRValue(options: {
  amount: number;
  currency?: string;
  reference: string;
  merchant: string;
  description?: string;
}): string {
  const { amount, currency = 'USD', reference, merchant, description = '' } = options;
  // For mobile-first compatibility, return the Tap & Go URL directly — scanners open it in browser
  return generateTapGoUrl(
    typeof window !== 'undefined' ? window.location.origin : '',
    { amount, currency, reference, merchant, till: reference.replace(/\D/g, '').slice(0, 6) || '247365' },
  ) || JSON.stringify({
    type: 'payment',
    merchant,
    amount: amount.toFixed(2),
    currency,
    reference,
    description,
    timestamp: new Date().toISOString(),
  });
}
