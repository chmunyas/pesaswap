import { QRCode } from 'react-qr-code';
import { generatePaymentQRValue } from './QRCard';
import { formatCurrency } from '../../lib/utils';
import { CreditCard, Smartphone, Check, RefreshCw, Clock } from 'lucide-react';
import { useState, useEffect } from 'react';

interface PaymentQRProps {
  saleId: number;
  amount: number;
  currency?: string;
  merchantName?: string;
  invoiceNumber?: string;
  onPaymentConfirmed?: () => void;
}

export function PaymentQR({
  saleId,
  amount,
  currency = 'USD',
  merchantName = 'PESASWAP',
  invoiceNumber = '',
  onPaymentConfirmed,
}: PaymentQRProps) {
  const [status, setStatus] = useState<'pending' | 'processing' | 'confirmed'>('pending');
  const [timeLeft, setTimeLeft] = useState(300); // 5 min expiry

  const qrValue = generatePaymentQRValue({
    amount,
    currency,
    reference: invoiceNumber || `SALE-${saleId}`,
    merchant: merchantName,
    description: `Payment for order #${saleId}`,
  });

  // Countdown timer for QR expiry
  useEffect(() => {
    if (status === 'confirmed') return;
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Simulated payment polling (in production, poll the backend)
  const simulatePayment = () => {
    setStatus('processing');
    setTimeout(() => {
      setStatus('confirmed');
      onPaymentConfirmed?.();
    }, 2000);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (status === 'confirmed') {
    return (
      <div className="rounded-xl border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-4">
          <Check className="h-8 w-8 text-white" />
        </div>
        <h3 className="text-xl font-bold text-green-700 dark:text-green-300">Payment Confirmed!</h3>
        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
          {formatCurrency(amount)} received for order #{saleId}
        </p>
        <p className="text-xs text-green-500 mt-1">Reference: {invoiceNumber || `SALE-${saleId}`}</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">Payment Request</p>
            <h3 className="text-2xl font-bold">{formatCurrency(amount)}</h3>
          </div>
          <Smartphone className="h-8 w-8 opacity-60" />
        </div>
      </div>

      <div className="p-6 text-center">
        {/* Status */}
        {status === 'processing' ? (
          <div className="py-8">
            <RefreshCw className="h-12 w-12 text-blue-500 animate-spin mx-auto mb-4" />
            <p className="text-sm font-medium text-gray-900 dark:text-white">Processing Payment...</p>
            <p className="text-xs text-gray-500">Please wait while we verify</p>
          </div>
        ) : (
          <>
            {/* QR Code */}
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Scan with your mobile payment app
            </p>
            <div className="inline-block p-4 bg-white rounded-xl shadow-inner border-2 border-dashed border-gray-200">
              <QRCode value={qrValue} size={180} fgColor="#059669" />
            </div>

            {/* Timer */}
            <div className="flex items-center justify-center gap-2 mt-4">
              <Clock className="h-4 w-4 text-gray-400" />
              <span className={`text-sm font-mono ${timeLeft < 60 ? 'text-red-500' : 'text-gray-500'}`}>
                Expires in {formatTime(timeLeft)}
              </span>
            </div>

            {/* Payment Details */}
            <div className="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-left text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-500">Merchant</span>
                <span className="font-medium text-gray-900 dark:text-white">{merchantName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Order</span>
                <span className="font-medium text-gray-900 dark:text-white">#{saleId}</span>
              </div>
              {invoiceNumber && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Invoice</span>
                  <span className="font-medium text-gray-900 dark:text-white">{invoiceNumber}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Amount</span>
                <span className="font-bold text-emerald-600">{formatCurrency(amount)}</span>
              </div>
            </div>

            {/* Manual confirm (for demo) */}
            <button
              onClick={simulatePayment}
              className="mt-4 w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-600 transition"
            >
              <CreditCard className="h-4 w-4" />
              Simulate Payment Received
            </button>
            <p className="text-xs text-gray-400 mt-2">
              In production, this confirms automatically when payment is detected
            </p>
          </>
        )}
      </div>
    </div>
  );
}
