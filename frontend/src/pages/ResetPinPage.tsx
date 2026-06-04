/**
 * ResetPinPage — public mobile-first PIN reset flow.
 *
 * Steps:  phone → 6-digit SMS code → new 4-digit PIN (twice) → success
 *
 * Per rubber-duck feedback:
 *   - PIN value is NEVER persisted to localStorage (only a benign reset count).
 *   - SMS code is 6 digits (matches real SMS UX); PIN is 4 digits (matches /pay).
 *   - a11y: inputMode, autoComplete (incl. "one-time-code" for SMS),
 *     focus-first-invalid, Enter to advance.
 *   - Success copy makes it explicit this is a demo — no backend PIN was changed.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Lock,
  Phone,
  RotateCcw,
  Shield,
  Smartphone,
} from 'lucide-react';
import { playNotificationSound } from '../lib/realtime';
import { useI18n } from '../lib/i18n';

type Step = 'phone' | 'code' | 'newpin' | 'success';

const SMS_LENGTH = 6;
const PIN_LENGTH = 4;
const RESET_COUNT_KEY = 'pesaswap.pin.resetCount';

function incrementResetCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const current = Number(window.localStorage.getItem(RESET_COUNT_KEY) || '0') + 1;
    window.localStorage.setItem(RESET_COUNT_KEY, String(current));
    return current;
  } catch {
    return 0;
  }
}

export function ResetPinPage() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState<string[]>(() => Array.from({ length: SMS_LENGTH }, () => ''));
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [resetCount, setResetCount] = useState(0);
  const smsRefs = useRef<Array<HTMLInputElement | null>>([]);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const newPinRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (step === 'phone') phoneRef.current?.focus();
    if (step === 'code') smsRefs.current[0]?.focus();
    if (step === 'newpin') newPinRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== 'code' || resendCountdown <= 0) return;
    const timer = window.setTimeout(() => setResendCountdown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCountdown, step]);

  function startReset() {
    if (phone.length < 9) {
      setError('Enter a valid phone number');
      phoneRef.current?.focus();
      return;
    }
    setError('');
    setLoading(true);
    // Mock SMS send delay
    setTimeout(() => {
      setLoading(false);
      setSmsCode(Array.from({ length: SMS_LENGTH }, () => ''));
      setResendCountdown(30);
      setStep('code');
    }, 800);
  }

  function updateSmsDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    setSmsCode((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < SMS_LENGTH - 1) smsRefs.current[index + 1]?.focus();
  }

  function handleSmsKeyDown(e: KeyboardEvent<HTMLInputElement>, index: number) {
    if (e.key === 'Backspace' && !smsCode[index] && index > 0) {
      smsRefs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') verifyCode();
  }

  function verifyCode() {
    const code = smsCode.join('');
    if (code.length < SMS_LENGTH) {
      setError(`Enter the ${SMS_LENGTH}-digit code from your SMS`);
      return;
    }
    setError('');
    setLoading(true);
    // Demo: any 6-digit code is accepted; in production this would call the backend
    setTimeout(() => {
      setLoading(false);
      setNewPin('');
      setConfirmPin('');
      setStep('newpin');
    }, 500);
  }

  function savePin() {
    if (newPin.length !== PIN_LENGTH) {
      setError(`PIN must be exactly ${PIN_LENGTH} digits`);
      newPinRef.current?.focus();
      return;
    }
    if (newPin !== confirmPin) {
      setError('PINs do not match');
      return;
    }
    setError('');
    setLoading(true);
    // Demo: no backend write; we never persist the PIN value itself,
    // only a benign reset counter so the success screen shows context.
    setTimeout(() => {
      const count = incrementResetCount();
      setResetCount(count);
      setLoading(false);
      playNotificationSound('payment');
      setStep('success');
    }, 600);
  }

  function reset() {
    setStep('phone');
    setPhone('');
    setSmsCode(Array.from({ length: SMS_LENGTH }, () => ''));
    setNewPin('');
    setConfirmPin('');
    setError('');
  }

  return (
    <div
      className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-900 text-white px-4 py-2 mb-4 dark:bg-white dark:text-gray-900">
            <Shield className="h-4 w-4" />
            <span className="text-sm font-bold font-mono">PESASWAP · Reset PIN</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {step === 'phone' && (
          <div className="space-y-5">
            <div className="rounded-3xl bg-white dark:bg-gray-900 p-6 text-center space-y-3 border border-gray-200 dark:border-gray-800">
              <div className="h-16 w-16 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto">
                <Phone className="h-8 w-8 text-blue-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Reset your PIN</h2>
                <p className="text-sm text-gray-500 mt-1">
                  We'll send a verification code to your phone
                </p>
              </div>
            </div>

            <label htmlFor="reset-phone" className="block">
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                Phone number
              </span>
              <div className="mt-1 flex gap-2">
                <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-950 px-3 py-3 flex items-center">
                  <span className="text-sm font-mono font-bold text-gray-900 dark:text-white">+254</span>
                </div>
                <input
                  id="reset-phone"
                  ref={phoneRef}
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
                  onKeyDown={(e) => { if (e.key === 'Enter') startReset(); }}
                  placeholder="7XX XXX XXX"
                  inputMode="tel"
                  autoComplete="tel-national"
                  aria-label="Phone number"
                  className="flex-1 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 dark:text-white"
                />
              </div>
            </label>

            <button
              onClick={startReset}
              disabled={phone.length < 9 || loading}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
            >
              <Smartphone className="h-5 w-5" />
              {loading ? 'Sending code…' : 'Send verification code'}
            </button>

            <p className="text-center text-[10px] text-gray-500">
              You will receive a 6-digit code by SMS within ~30 seconds.
            </p>
          </div>
        )}

        {step === 'code' && (
          <div className="space-y-5">
            <div className="rounded-3xl bg-white dark:bg-gray-900 p-6 text-center space-y-3 border border-gray-200 dark:border-gray-800">
              <div className="h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto">
                <Smartphone className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Enter the code</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Sent to +254 {phone.slice(0, 3)}***{phone.slice(-3)}
                </p>
                <p className="text-[10px] text-gray-400 mt-1">Demo: any 6-digit code is accepted</p>
              </div>
            </div>

            <div className="grid grid-cols-6 gap-2">
              {smsCode.map((digit, index) => (
                <input
                  key={`sms-${index}`}
                  ref={(el) => { smsRefs.current[index] = el; }}
                  value={digit}
                  onChange={(e) => updateSmsDigit(index, e.target.value)}
                  onKeyDown={(e) => handleSmsKeyDown(e, index)}
                  inputMode="numeric"
                  autoComplete={index === 0 ? 'one-time-code' : 'off'}
                  maxLength={1}
                  aria-label={`Digit ${index + 1}`}
                  className="h-14 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-2xl font-bold font-mono text-gray-900 dark:text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
                />
              ))}
            </div>

            <button
              onClick={verifyCode}
              disabled={smsCode.join('').length < SMS_LENGTH || loading}
              className="w-full bg-blue-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-blue-700"
            >
              {loading ? 'Verifying…' : 'Verify code'}
            </button>

            <div className="text-center text-sm">
              <button
                type="button"
                onClick={() => {
                  if (resendCountdown > 0) return;
                  setSmsCode(Array.from({ length: SMS_LENGTH }, () => ''));
                  setResendCountdown(30);
                  smsRefs.current[0]?.focus();
                }}
                disabled={resendCountdown > 0 || loading}
                className="text-blue-600 font-medium disabled:text-gray-400"
              >
                {resendCountdown > 0 ? `Resend in ${resendCountdown}s` : 'Resend code'}
              </button>
            </div>
          </div>
        )}

        {step === 'newpin' && (
          <div className="space-y-5">
            <div className="rounded-3xl bg-white dark:bg-gray-900 p-6 text-center space-y-3 border border-gray-200 dark:border-gray-800">
              <div className="h-16 w-16 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mx-auto">
                <Lock className="h-8 w-8 text-purple-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900 dark:text-white">Create new PIN</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Choose a {PIN_LENGTH}-digit PIN you'll remember
                </p>
              </div>
            </div>

            <label htmlFor="reset-newpin" className="block">
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                New PIN
              </span>
              <input
                id="reset-newpin"
                ref={newPinRef}
                type="password"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                onKeyDown={(e) => { if (e.key === 'Enter') savePin(); }}
                inputMode="numeric"
                autoComplete="new-password"
                aria-label="New PIN"
                className="mt-1 w-full h-14 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-2xl font-bold font-mono text-gray-900 dark:text-white tracking-[0.8em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
            </label>

            <label htmlFor="reset-confirmpin" className="block">
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                Confirm PIN
              </span>
              <input
                id="reset-confirmpin"
                type="password"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                onKeyDown={(e) => { if (e.key === 'Enter') savePin(); }}
                inputMode="numeric"
                autoComplete="new-password"
                aria-label="Confirm PIN"
                className="mt-1 w-full h-14 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-center text-2xl font-bold font-mono text-gray-900 dark:text-white tracking-[0.8em] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
            </label>

            <button
              onClick={savePin}
              disabled={newPin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH || loading}
              className="w-full bg-purple-600 text-white py-4 rounded-2xl text-base font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-purple-700"
            >
              {loading ? 'Saving…' : 'Save new PIN'}
            </button>
          </div>
        )}

        {step === 'success' && (
          <div className="space-y-6">
            <div className="flex flex-col items-center py-8 space-y-4">
              <div className="h-24 w-24 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-14 w-14 text-emerald-600" />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">PIN updated</p>
                <p className="text-sm text-gray-500 mt-2">
                  Demo reset completed — no backend PIN was actually changed.
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-gray-100 dark:bg-gray-900 p-4 space-y-2">
              {[
                ['Phone', `+254 ${phone.slice(0, 3)}***${phone.slice(-3)}`],
                ['Method', 'SMS verification'],
                ['Demo resets on this device', String(resetCount)],
                ['Time', new Date().toLocaleTimeString()],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-[11px]">
                  <span className="text-gray-500">{k}</span>
                  <span className="font-mono font-semibold text-gray-900 dark:text-white">{v}</span>
                </div>
              ))}
            </div>

            <a
              href="/login"
              className="block w-full bg-gray-900 dark:bg-white text-white dark:text-gray-900 py-4 rounded-2xl text-sm font-bold text-center"
            >
              {t('action.continue')} to login
            </a>

            <button
              onClick={reset}
              className="w-full border border-gray-200 dark:border-gray-700 py-3 rounded-2xl text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-900 flex items-center justify-center gap-2"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset another PIN
            </button>
          </div>
        )}

        <p className="mt-6 text-[9px] text-center text-gray-400">
          Powered by PESASWAP · Secure · Encrypted
        </p>
      </div>
    </div>
  );
}
