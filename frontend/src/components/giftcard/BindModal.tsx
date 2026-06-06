/**
 * BindModal — cashier-facing modal to bind a gift card to a customer's phone.
 *
 * Once bound, redemptions can be authorised via STK push to the linked
 * number. Binding state is fully mocked client-side via
 * frontend/src/lib/giftcard-bindings.ts.
 */

import { useState, type FormEvent } from 'react';
import { Loader2, ShieldCheck, Smartphone, XCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { showToast } from '../ui/Toast';
import {
  giftcardBindingMock,
  type CardBinding,
  type MnoProvider,
} from '../../lib/giftcard-bindings';

const PROVIDERS: Array<{ value: MnoProvider; label: string; hint: string }> = [
  { value: 'mpesa',    label: 'M-Pesa',       hint: 'Safaricom (KE) — Daraja sandbox' },
  { value: 'airtel',   label: 'Airtel Money', hint: 'Airtel Africa' },
  { value: 'mtn_momo', label: 'MTN MoMo',     hint: 'Mobile Money Open API' },
];

export function BindModal({
  giftcardCode,
  prefillPhone,
  onClose,
  onBound,
}: {
  giftcardCode: string;
  prefillPhone?: string | null;
  onClose: () => void;
  onBound: (binding: CardBinding) => void;
}) {
  const [phone, setPhone] = useState(prefillPhone ?? '');
  const [provider, setProvider] = useState<MnoProvider>('mpesa');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sending' | 'awaiting' | 'success' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    setStatus('sending');
    try {
      // 200ms "sending request" then awaiting-PIN state for the rest.
      setTimeout(() => setStatus('awaiting'), 200);
      const binding = await giftcardBindingMock.bind({
        giftcard_code: giftcardCode,
        mobile_number: phone,
        mno_provider: provider,
      });
      setStatus('success');
      showToast(`Card linked to ${giftcardBindingMock.maskPhone(binding.mobile_number)}`);
      onBound(binding);
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'STK push failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal isOpen={true} onClose={() => (busy ? undefined : onClose())} title={`Bind card to phone — ${giftcardCode}`} size="md">
      {status === 'success' ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-900/30">
            <p className="flex items-center gap-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4" /> Card linked
            </p>
            <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
              Future redemptions on <span className="font-mono">{giftcardCode}</span> can now be authorised via STK push to <span className="font-mono">{giftcardBindingMock.maskPhone(phone)}</span> ({giftcardBindingMock.mnoLabel(provider)}).
            </p>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Done</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <p className="font-semibold">How NFC binding works</p>
            <p className="mt-0.5">
              The card stays a bearer instrument until you bind it. After binding, the customer authorises each
              redemption via a PIN prompt on their phone — so a lost card cannot be drained without their PIN.
            </p>
          </div>

          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
            Customer phone number<span className="ml-0.5 text-rose-500">*</span>
            <div className="mt-1 flex items-center rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900">
              <Smartphone className="h-4 w-4 text-gray-400" />
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+254 7XX XXX XXX"
                className="ml-2 w-full bg-transparent py-2 text-sm outline-none dark:text-white"
              />
            </div>
          </label>

          <div>
            <p className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-300">Mobile money provider</p>
            <div className="grid gap-2 md:grid-cols-3">
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProvider(p.value)}
                  className={`rounded-lg border p-3 text-left transition ${
                    provider === p.value
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40'
                      : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{p.label}</p>
                  <p className="text-[10px] text-gray-500">{p.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {status === 'awaiting' && (
            <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-900/30">
              <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-sky-600" />
              <div className="text-xs text-sky-800 dark:text-sky-200">
                <p className="font-semibold">Waiting for the customer's PIN…</p>
                <p>STK push sent to {giftcardBindingMock.maskPhone(phone)}. They have 60s.</p>
              </div>
            </div>
          )}

          {status === 'failed' && error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-900/30">
              <XCircle className="mt-0.5 h-4 w-4 text-rose-600" />
              <div className="text-xs text-rose-800 dark:text-rose-200">
                <p className="font-semibold">STK push failed</p>
                <p>{error}</p>
                <p className="mt-1">You can retry, change the number, or leave the card unbound.</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
              Skip — leave as bearer card
            </button>
            <button type="submit" disabled={busy || !phone} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? (status === 'sending' ? 'Sending…' : 'Awaiting PIN…') : 'Send STK push'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
