import { QRCode } from 'react-qr-code';
import { generateInvoiceQRValue } from './QRCard';
import { formatCurrency } from '../../lib/utils';
import { Printer, FileText, Copy, Check } from 'lucide-react';
import { useState } from 'react';

interface InvoiceData {
  sale_id: number;
  invoice_number: string;
  sale_time: string;
  customer_name: string;
  total: number;
  tax: number;
  items: { name: string; quantity: number; price: number }[];
  payment_type: string;
  status: string;
}

interface InvoiceQRProps {
  invoice: InvoiceData;
  baseUrl?: string;
  storeName?: string;
  storeAddress?: string;
}

export function InvoiceQR({ invoice, baseUrl = window.location.origin, storeName = 'PESASWAP', storeAddress = '' }: InvoiceQRProps) {
  const [copied, setCopied] = useState(false);
  const qrValue = generateInvoiceQRValue(baseUrl, invoice.sale_id, invoice.invoice_number, invoice.total);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(qrValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice ${invoice.invoice_number}</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; }
            .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 16px; margin-bottom: 16px; }
            .header h1 { margin: 0; font-size: 24px; }
            .header p { margin: 4px 0; color: #666; font-size: 12px; }
            .invoice-info { display: flex; justify-content: space-between; margin-bottom: 16px; font-size: 12px; }
            table { width: 100%; border-collapse: collapse; font-size: 13px; }
            th, td { padding: 8px 4px; text-align: left; border-bottom: 1px solid #eee; }
            th { font-weight: 600; }
            .total-row td { border-top: 2px solid #000; font-weight: bold; font-size: 16px; }
            .qr-section { text-align: center; margin-top: 24px; padding-top: 16px; border-top: 1px dashed #ccc; }
            .qr-section p { font-size: 11px; color: #666; margin-top: 8px; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>${storeName}</h1>
            ${storeAddress ? `<p>${storeAddress}</p>` : ''}
            <p>Invoice #${invoice.invoice_number}</p>
          </div>
          <div class="invoice-info">
            <div><strong>Customer:</strong> ${invoice.customer_name || 'Walk-in'}</div>
            <div><strong>Date:</strong> ${new Date(invoice.sale_time).toLocaleDateString()}</div>
          </div>
          <table>
            <thead><tr><th>Item</th><th>Qty</th><th style="text-align:right">Amount</th></tr></thead>
            <tbody>
              ${invoice.items.map(item => `<tr><td>${item.name}</td><td>${item.quantity}</td><td style="text-align:right">$${(item.quantity * item.price).toFixed(2)}</td></tr>`).join('')}
              <tr><td colspan="2">Tax</td><td style="text-align:right">$${invoice.tax.toFixed(2)}</td></tr>
              <tr class="total-row"><td colspan="2">Total</td><td style="text-align:right">$${invoice.total.toFixed(2)}</td></tr>
            </tbody>
          </table>
          <div class="qr-section">
            <p>Scan for digital receipt</p>
            <div id="qr-print"></div>
            <p>Payment: ${invoice.payment_type} | Status: ${invoice.status}</p>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="rounded-xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      {/* Invoice Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">Invoice</p>
            <h3 className="text-lg font-bold">#{invoice.invoice_number}</h3>
          </div>
          <FileText className="h-8 w-8 opacity-60" />
        </div>
      </div>

      <div className="p-6">
        {/* Customer & Date */}
        <div className="flex justify-between text-sm mb-4">
          <div>
            <p className="text-gray-500 dark:text-gray-400">Customer</p>
            <p className="font-medium text-gray-900 dark:text-white">{invoice.customer_name || 'Walk-in'}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-500 dark:text-gray-400">Date</p>
            <p className="font-medium text-gray-900 dark:text-white">{new Date(invoice.sale_time).toLocaleDateString()}</p>
          </div>
        </div>

        {/* Items */}
        <div className="border-t border-b py-3 mb-3 space-y-2">
          {invoice.items.map((item, i) => (
            <div key={i} className="flex justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-300">{item.name} × {item.quantity}</span>
              <span className="font-medium">{formatCurrency(item.quantity * item.price)}</span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="space-y-1 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Tax</span>
            <span>{formatCurrency(invoice.tax)}</span>
          </div>
          <div className="flex justify-between text-base font-bold">
            <span>Total</span>
            <span className="text-blue-600">{formatCurrency(invoice.total)}</span>
          </div>
        </div>

        {/* QR Code */}
        <div className="text-center pt-4 border-t border-dashed">
          <p className="text-xs text-gray-500 mb-3">Scan for digital receipt & verification</p>
          <div className="inline-block p-3 bg-white rounded-lg shadow-inner">
            <QRCode value={qrValue} size={140} fgColor="#1e40af" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={handleCopyLink}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-xs font-medium text-white hover:bg-blue-600 transition"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Invoice
          </button>
        </div>
      </div>
    </div>
  );
}
