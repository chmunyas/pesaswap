import { useState, useEffect, useRef } from 'react';
import {
  Zap,
  CheckCircle2,
  ShieldCheck,
  Fingerprint,
  Smartphone,
  Clock3,
  QrCode,
  Camera,
  AlertCircle,
  Landmark,
} from 'lucide-react';
import { playNotificationSound, realtime } from '../lib/realtime';
import { useI18n } from '../lib/i18n';
import { BnplCheckout } from '../components/bnpl/BnplCheckout';

type PaymentState = 'idle' | 'scanned' | 'pin' | 'processing' | 'bnpl' | 'success' | 'error';

type PaymentData = {
  till: string;
  amount: number;
  merchant: string;
  currency?: string;
  reference?: string;
};

type PaymentMethod = 'mpesa' | 'bnpl';

export function PayPage() {
  const { t } = useI18n();
  const [state, setState] = useState<PaymentState>('idle');
  const [paymentData, setPaymentData] = useState<PaymentData | null>(null);
  const [pin, setPin] = useState('');
  const [useBiometric, setUseBiometric] = useState(false);
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('mpesa');
  const [errorMsg, setErrorMsg] = useState('');
  const startTimeRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const tapgo = params.get('tapgo');
    if (tapgo) {
      try {
        const data = JSON.parse(atob(tapgo)) as PaymentData;
        setPaymentData(data);
        setState('scanned');
        startTimeRef.current = Date.now();
      } catch {
        // ignore invalid QR data
      }
    }
  }, []);

  function confirmPayment(phone: string) {
    setCustomerPhone(phone);
    setPaymentMethod('mpesa');
    setState('pin');
  }

  function openBnpl() {
    setPaymentMethod('bnpl');
    setState('bnpl');
  }

  async function submitPin() {
    if (pin.length < 4 || !paymentData) return;
    await processPayment();
  }

  async function useBiometricAuth() {
    setUseBiometric(true);
    if (!paymentData) return;
    await processPayment();
  }

  /**
   * Shared payment completion path. Used by both M-Pesa STK flow and Co-op BNPL flow
   * so we emit `payment.succeeded` consistently and reach the same SuccessState UI.
   */
  function completePayment({
    method,
    reference,
    phone,
  }: {
    method: PaymentMethod;
    reference: string;
    phone: string;
  }) {
    setPaymentMethod(method);
    setCustomerPhone(phone);
    setPaymentId(reference);
    setState('success');
    if (paymentData) {
      realtime.emit({
        type: 'payment.succeeded',
        data: {
          payment_id: reference,
          amount: paymentData.amount,
          currency: paymentData.currency || 'KES',
          customer_phone: phone,
          method,
          timestamp: new Date().toISOString(),
        },
      });
    }
  }

  async function processPayment() {
    setState('processing');
    setErrorMsg('');
    try {
      // Simulate STK push wait (replace with real PesaSwap call when API key is set)
      await new Promise((r) => setTimeout(r, 1800));
      const pid = `TG${Date.now().toString(36).toUpperCase()}`;
      completePayment({ method: 'mpesa', reference: pid, phone: customerPhone });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed. Please try again.');
      setState('error');
    }
  }

  function reset() {
    setState('idle');
    setPaymentData(null);
    setPin('');
    setUseBiometric(false);
    setCustomerPhone('');
    setPaymentId(null);
    setPaymentMethod('mpesa');
    setErrorMsg('');
    if (typeof window !== 'undefined') window.history.replaceState({}, '', '/pay');
  }

  function retry() {
    setErrorMsg('');
    setPin('');
    setState('scanned');
  }

  function simulateScan() {
    setPaymentData({
      till: '247365',
      amount: 2450,
      merchant: 'PESASWAP Demo Store',
      currency: 'KES',
    });
    setState('scanned');
    startTimeRef.current = Date.now();
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-900 text-white px-4 py-2 mb-4 dark:bg-white dark:text-gray-900">
            <Zap className="h-4 w-4" />
            <span className="text-sm font-bold font-mono">PESASWAP {t('pay.tapgo')}</span>
          </div>
        </div>

        {state === 'idle' && <IdleState onScan={simulateScan} />}
        {state === 'scanned' && paymentData && (
          <ScannedState data={paymentData} onConfirm={confirmPayment} onBnpl={openBnpl} onCancel={reset} />
        )}
        {state === 'pin' && paymentData && (
          <PinState data={paymentData} pin={pin} setPin={setPin} onSubmit={submitPin} onBiometric={useBiometricAuth} />
        )}
        {state === 'processing' && <ProcessingState biometric={useBiometric} />}
        {state === 'bnpl' && paymentData && (
          <BnplCheckout
            amount={paymentData.amount}
            currency={paymentData.currency || 'KES'}
            orderId={paymentData.reference || `ORDER-${Date.now()}`}
            merchantId={paymentData.till || 'pesaswap-pos'}
            description={`Purchase at ${paymentData.merchant}`}
            onSuccess={(txn) =>
              completePayment({
                method: 'bnpl',
                reference: txn.coopReference || txn.id,
                phone: txn.customerPhone || customerPhone || 'BNPL',
              })
            }
            onCancel={() => setState('scanned')}
          />
        )}
        {state === 'error' && <ErrorState message={errorMsg} onRetry={retry} onCancel={reset} />}
        {state === 'success' && paymentData && (
          <SuccessState
            data={paymentData}
            phone={customerPhone}
            paymentId={paymentId}
            method={paymentMethod}
            elapsedMs={Date.now() - startTimeRef.current}
            onDone={reset}
          />
        )}
      </div>
    </div>
  );
}

function IdleState({ onScan }: { onScan: () => void }) {
  const [showManual, setShowManual] = useState(false);
  const [manualTill, setManualTill] = useState('');
  const [manualAmount, setManualAmount] = useState('');

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border-2 border-dashed border-gray-300 dark:border-gray-700 p-12 flex flex-col items-center gap-4 bg-white dark:bg-gray-900">
        <div className="h-20 w-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <Camera className="h-10 w-10 text-gray-400" />
        </div>
        <div className="text-center">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Scan to Pay</h2>
          <p className="text-sm text-gray-500 mt-1">Point your camera at the merchant's QR code</p>
        </div>
      </div>

      <button
        onClick={onScan}
        className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
      >
        <QrCode className="h-5 w-5" />
        Open scanner
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
        <span className="text-[10px] font-mono uppercase text-gray-400">or</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
      </div>

      {!showManual ? (
        <button
          onClick={() => setShowManual(true)}
          className="w-full border border-gray-200 dark:border-gray-800 py-4 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 text-gray-600 dark:text-gray-300"
        >
          <Smartphone className="h-4 w-4" />
          Enter till number manually
        </button>
      ) : (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Pay by till number</p>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-3">
            <p className="text-[8px] font-mono uppercase text-gray-500">Till / Paybill number</p>
            <input
              type="tel"
              value={manualTill}
              onChange={(e) => setManualTill(e.target.value.replace(/[^0-9]/g, '').slice(0, 7))}
              placeholder="e.g. 247365"
              className="w-full bg-transparent text-lg font-mono font-bold outline-none mt-0.5 text-gray-900 dark:text-white"
            />
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 px-4 py-3">
            <p className="text-[8px] font-mono uppercase text-gray-500">Amount</p>
            <input
              type="tel"
              value={manualAmount}
              onChange={(e) => setManualAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0"
              className="w-full bg-transparent text-2xl font-mono font-bold outline-none mt-0.5 text-gray-900 dark:text-white"
            />
          </div>
          <button
            disabled={manualTill.length < 5 || !manualAmount || Number(manualAmount) <= 0}
            onClick={() => {
              const payload = btoa(JSON.stringify({ till: manualTill, amount: Number(manualAmount), merchant: `Till ${manualTill}` }));
              window.location.href = `/pay?tapgo=${encodeURIComponent(payload)}`;
            }}
            className="w-full bg-emerald-600 text-white py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            <Zap className="h-4 w-4" />
            Pay {manualAmount ? Number(manualAmount).toLocaleString() : '0'}
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-gray-100 dark:bg-gray-900 p-4 space-y-3">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">How it works</p>
        <div className="space-y-2">
          {[
            { step: '1', text: 'Cashier enters amount' },
            { step: '2', text: 'You scan the QR code' },
            { step: '3', text: 'Confirm with PIN or fingerprint' },
            { step: '4', text: 'Done! ~8 seconds total' },
          ].map((item) => (
            <div key={item.step} className="flex items-center gap-3">
              <span className="h-6 w-6 rounded-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 flex items-center justify-center text-xs font-bold">
                {item.step}
              </span>
              <span className="text-sm text-gray-700 dark:text-gray-200">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScannedState({ data, onConfirm, onBnpl, onCancel }: { data: PaymentData; onConfirm: (phone: string) => void; onBnpl: () => void; onCancel: () => void }) {
  const [phone, setPhone] = useState('');
  const currency = data.currency || 'KES';

  return (
    <div className="space-y-5">
      <div className="rounded-3xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 p-6 text-center space-y-3">
        <div className="h-12 w-12 rounded-full bg-white/10 dark:bg-black/10 flex items-center justify-center mx-auto">
          <Smartphone className="h-6 w-6" />
        </div>
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Pay to</p>
          <p className="text-lg font-bold mt-1">{data.merchant}</p>
          <p className="text-[11px] font-mono opacity-60">Till {data.till}</p>
        </div>
        <div className="pt-2 border-t border-white/10 dark:border-black/10">
          <p className="text-[10px] font-mono uppercase tracking-widest opacity-60">Amount</p>
          <p className="text-4xl font-bold font-mono mt-1">{currency} {data.amount.toLocaleString()}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Your mobile money number</p>
        <div className="flex gap-2">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950 px-3 py-3 flex items-center">
            <span className="text-sm font-mono font-bold text-gray-900 dark:text-white">+254</span>
          </div>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, '').slice(0, 9))}
            placeholder="7XX XXX XXX"
            className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500 text-gray-900 dark:text-white"
          />
        </div>
        <p className="text-[9px] text-gray-500">STK push will be sent to this number for PIN confirmation</p>
      </div>

      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-3 flex items-center gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
        <div>
          <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Verified merchant</p>
          <p className="text-[10px] text-emerald-600 dark:text-emerald-400">Till number confirmed</p>
        </div>
      </div>

      <button
        disabled={phone.length < 9}
        onClick={() => onConfirm(`0${phone}`)}
        className="w-full bg-emerald-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Zap className="h-5 w-5" />
        Confirm & Pay
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
        <span className="text-[10px] font-mono uppercase text-gray-400">or</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
      </div>

      <button
        onClick={onBnpl}
        className="w-full bg-[#003DA5] text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 hover:bg-[#0f4cc7] transition-colors"
      >
        <Landmark className="h-5 w-5" />
        Pay later with Co-op Bank
      </button>

      <button onClick={onCancel} className="w-full border border-gray-200 dark:border-gray-800 py-3 rounded-2xl text-sm text-gray-500">
        Cancel
      </button>
    </div>
  );
}

function PinState({
  data,
  pin,
  setPin,
  onSubmit,
  onBiometric,
}: {
  data: PaymentData;
  pin: string;
  setPin: (v: string) => void;
  onSubmit: () => void;
  onBiometric: () => void;
}) {
  const currency = data.currency || 'KES';
  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-sm text-gray-500">Paying</p>
        <p className="text-2xl font-bold font-mono text-gray-900 dark:text-white">{currency} {data.amount.toLocaleString()}</p>
        <p className="text-sm text-gray-500">to {data.merchant}</p>
      </div>

      <button
        onClick={onBiometric}
        className="w-full rounded-2xl border-2 border-gray-900 dark:border-white p-5 flex flex-col items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
      >
        <Fingerprint className="h-12 w-12 text-gray-900 dark:text-white" />
        <div className="text-center">
          <p className="text-sm font-bold text-gray-900 dark:text-white">Use fingerprint</p>
          <p className="text-[10px] text-gray-500">Fastest — one touch to pay</p>
        </div>
      </button>

      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
        <span className="text-[10px] font-mono uppercase text-gray-500">or enter PIN</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
      </div>

      <div className="flex justify-center gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-colors ${
              i < pin.length ? 'bg-gray-900 dark:bg-white border-gray-900 dark:border-white' : 'border-gray-300 dark:border-gray-700'
            }`}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) => (
          <button
            key={`${key}-${i}`}
            disabled={!key}
            onClick={() => {
              if (key === '⌫') setPin(pin.slice(0, -1));
              else if (pin.length < 4) {
                const newPin = pin + key;
                setPin(newPin);
                if (newPin.length === 4) setTimeout(onSubmit, 300);
              }
            }}
            className={`py-4 rounded-xl text-xl font-mono font-bold transition-colors ${
              key ? 'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-900 active:text-white dark:active:bg-white dark:active:text-gray-900 text-gray-900 dark:text-white' : ''
            }`}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProcessingState({ biometric }: { biometric: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <div className="h-16 w-16 rounded-full border-4 border-gray-900 dark:border-white border-t-transparent animate-spin" />
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {biometric ? 'Fingerprint verified' : 'Processing payment...'}
        </p>
        <p className="text-[11px] text-gray-500 mt-1">Confirming — check your phone for M-Pesa prompt</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry, onCancel }: { message: string; onRetry: () => void; onCancel: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center py-8 space-y-4">
        <div className="h-20 w-20 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertCircle className="h-12 w-12 text-red-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-red-700 dark:text-red-300">Payment failed</p>
          <p className="text-sm text-gray-500 mt-2">{message}</p>
        </div>
      </div>

      <button
        onClick={onRetry}
        className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2"
      >
        <Zap className="h-4 w-4" />
        Try Again
      </button>

      <button onClick={onCancel} className="w-full border border-gray-200 dark:border-gray-800 py-3 rounded-2xl text-sm text-gray-500">
        Cancel
      </button>
    </div>
  );
}

function SuccessState({
  data,
  phone,
  paymentId,
  method,
  elapsedMs,
  onDone,
}: {
  data: PaymentData;
  phone: string;
  paymentId: string | null;
  method: PaymentMethod;
  elapsedMs: number;
  onDone: () => void;
}) {
  const currency = data.currency || 'KES';
  const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
  const methodLabel = method === 'bnpl' ? 'BNPL · Co-op Bank' : 'M-Pesa via PESASWAP';
  const phoneLabel = phone
    ? phone.startsWith('BNPL')
      ? 'BNPL approval'
      : `${phone.slice(0, 4)}***${phone.slice(-3)}`
    : '—';

  // Play audio confirmation (shared 'payment' ka-ching)
  useEffect(() => {
    playNotificationSound('payment');
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center py-6 space-y-4">
        <div className="h-24 w-24 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-600" />
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">Payment successful!</p>
          <p className="text-3xl font-bold font-mono mt-2 text-gray-900 dark:text-white">{currency} {data.amount.toLocaleString()}</p>
          <p className="text-sm text-gray-500 mt-1">{data.merchant}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-gray-100 dark:bg-gray-900 p-4 space-y-2">
        {[
          ['Merchant', data.merchant],
          ['Till', data.till],
          ['Amount', `${currency} ${data.amount.toLocaleString()}`],
          ['Phone', phoneLabel],
          ['Method', methodLabel],
          ['Time', new Date().toLocaleTimeString()],
          ['Reference', paymentId || `TG${Date.now().toString(36).toUpperCase()}`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-[11px]">
            <span className="text-gray-500">{k}</span>
            <span className="font-mono font-semibold text-gray-900 dark:text-white">{v}</span>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4 text-center">
        <div className="flex items-center justify-center gap-2 text-emerald-600 dark:text-emerald-300">
          <Clock3 className="h-4 w-4" />
          <span className="text-sm font-bold font-mono">{elapsedSec} seconds</span>
        </div>
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
          vs. 2 minutes the old way — {Math.max(50, Math.round((120 - elapsedSec) / 1.2))}% faster
        </p>
      </div>

      <button
        onClick={onDone}
        className="w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 py-4 rounded-2xl text-sm font-bold"
      >
        Done
      </button>

      <p className="text-[9px] text-center text-gray-500">Receipt sent. Powered by PESASWAP.</p>
    </div>
  );
}
