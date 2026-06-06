/**
 * TenderPicker — choose how to pay an amount.
 *
 * Renders the available tenders in priority order:
 *   1. Card balance (gated by sufficiency vs amount)
 *   2. Default MNO (if card bound)
 *   3. Other MNOs
 *   4. PESASWAP Wallet (mocked balance per customer email)
 *   5. Co-op Bank account
 *   6. Co-op BNPL (3-installment plan, reuses existing BnplCheckout flow)
 *   7. Split: card balance + MNO top-up (only when card is insufficient)
 *
 * On selection, creates a mocked payment intent and surfaces the live
 * `pending → awaiting_pin → completed | failed` lifecycle with a status
 * pill. Cancel button available during pending.
 */

import { useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  CalendarClock,
  Check,
  CreditCard,
  HandCoins,
  Loader2,
  ScanLine,
  Smartphone,
  Wallet,
  X as XIcon,
  XCircle,
} from 'lucide-react';
import { showToast } from '../ui/Toast';
import { playNotificationSound } from '../../lib/realtime';
import {
  giftcardBindingMock,
  type CardBinding,
  type IntentStatus,
  type MnoProvider,
  type PaymentIntent,
  type TenderSource,
} from '../../lib/giftcard-bindings';

export interface TenderPickerCard {
  giftcard_id: number;
  giftcard_number: string;
  masked_code: string;
  value: number;
  currency: string;
  recipient_email?: string | null;
  recipient_name?: string | null;
}

interface Tender {
  source: TenderSource;
  label: string;
  detail: string;
  icon: typeof CreditCard;
  starred?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export function TenderPicker({
  card,
  amount,
  currency = 'KES',
  onComplete,
}: {
  card?: TenderPickerCard | null;
  amount: number;
  currency?: string;
  onComplete?: (intent: PaymentIntent) => void;
}) {
  const [picked, setPicked] = useState<TenderSource | null>(null);
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [running, setRunning] = useState(false);

  const binding = useMemo<CardBinding | null>(() => {
    if (!card) return null;
    return giftcardBindingMock.byCode(card.giftcard_number);
  }, [card]);

  const wallet = useMemo(() => {
    return card?.recipient_email
      ? giftcardBindingMock.walletFor(card.recipient_email, currency)
      : { customer_email: '', balance: 0, currency };
  }, [card?.recipient_email, currency]);

  const tenders = useMemo<Tender[]>(() => {
    const list: Tender[] = [];

    // 1. Card balance — only if a card is presented + has any value.
    if (card) {
      const insufficient = card.value < amount;
      list.push({
        source: 'card_balance',
        label: `Card balance`,
        detail: `${currency} ${card.value.toLocaleString()} available${insufficient ? ` — short ${currency} ${(amount - card.value).toLocaleString()}` : ''}`,
        icon: CreditCard,
        disabled: card.value <= 0,
        disabledReason: card.value <= 0 ? 'Card has no balance' : undefined,
      });
    }

    // 2. Default MNO (if card is bound)
    const defaultMno: MnoProvider | null = binding?.mno_provider ?? null;
    if (defaultMno) {
      list.push({
        source: defaultMno,
        label: `${giftcardBindingMock.mnoLabel(defaultMno)}`,
        detail: `Linked phone ${giftcardBindingMock.maskPhone(binding!.mobile_number)} · STK push`,
        icon: Smartphone,
        starred: true,
      });
    }

    // 3. Other MNOs
    const others: MnoProvider[] = (['mpesa', 'airtel', 'mtn_momo'] as MnoProvider[])
      .filter((p) => p !== defaultMno);
    for (const p of others) {
      list.push({
        source: p,
        label: giftcardBindingMock.mnoLabel(p),
        detail: 'Cashier enters customer phone → STK push',
        icon: Smartphone,
      });
    }

    // 4. PESASWAP Wallet (mock per recipient_email)
    list.push({
      source: 'pesaswap_wallet',
      label: 'PESASWAP Wallet',
      detail: card?.recipient_email
        ? `${currency} ${wallet.balance.toLocaleString()} · in-app biometric auth`
        : 'Customer must be identified',
      icon: Wallet,
      disabled: !card?.recipient_email || wallet.balance < amount,
      disabledReason: !card?.recipient_email
        ? 'Wallet requires customer email on the card'
        : wallet.balance < amount
          ? 'Insufficient wallet balance'
          : undefined,
    });

    // 5. Co-op Bank account
    list.push({
      source: 'coop_bank',
      label: 'Co-op Bank account',
      detail: 'Pre-authorised direct debit · 1-tap',
      icon: Building2,
    });

    // 6. Co-op BNPL
    list.push({
      source: 'coop_bnpl',
      label: 'Co-op BNPL — pay in 3',
      detail: 'Eligibility check → OTP → 3-month plan',
      icon: CalendarClock,
    });

    // 7. Split (only when card balance is positive but insufficient)
    if (card && card.value > 0 && card.value < amount) {
      list.push({
        source: 'split',
        label: 'Split',
        detail: `Card ${currency} ${card.value.toLocaleString()} + MNO ${currency} ${(amount - card.value).toLocaleString()}`,
        icon: HandCoins,
      });
    }

    return list;
  }, [card, amount, currency, binding, wallet]);

  async function authorise(source: TenderSource) {
    setPicked(source);
    setRunning(true);
    setIntent(null);
    try {
      const result = await giftcardBindingMock.createIntent({
        giftcard_code: card?.giftcard_number ?? null,
        amount,
        currency,
        source,
        onStatusChange: (i) => setIntent(i),
      });
      if (result.status === 'completed') {
        playNotificationSound('payment');
        showToast(`Authorised — ${result.mno_txn_ref ?? 'OK'}`);
      } else if (result.status === 'failed') {
        showToast(result.failure_reason ?? 'Payment failed', 'error');
      } else if (result.status === 'cancelled') {
        showToast('Payment cancelled');
      }
      onComplete?.(result);
    } finally {
      setRunning(false);
    }
  }

  async function cancel() {
    if (!intent) return;
    await giftcardBindingMock.cancelIntent(intent.intent_id);
    setIntent({ ...intent, status: 'cancelled', completed_at: new Date().toISOString() });
    setRunning(false);
  }

  function reset() {
    setPicked(null);
    setIntent(null);
    setRunning(false);
  }

  // ---- Active intent view ----
  if (picked && (running || intent)) {
    return <IntentPanel intent={intent} source={picked} amount={amount} currency={currency} onCancel={cancel} onReset={reset} running={running} />;
  }

  // ---- Tender list ----
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Amount due</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white">{currency} {amount.toLocaleString()}</p>
      </div>

      {card && (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
          <ScanLine className="h-4 w-4 text-gray-500" />
          <div className="min-w-0 flex-1 text-[11px]">
            <p className="font-mono font-semibold text-gray-700 dark:text-gray-200">{card.masked_code}</p>
            <p className="text-gray-500">
              {card.recipient_name ?? 'Bearer card'}
              {binding && <> · linked to {giftcardBindingMock.maskPhone(binding.mobile_number)} ({giftcardBindingMock.mnoLabel(binding.mno_provider)})</>}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {tenders.map((t) => (
          <TenderRow key={t.source} tender={t} onPick={() => authorise(t.source)} />
        ))}
      </div>

      <p className="text-[10px] text-gray-500">
        Demo mode — STK pushes, OTPs and PINs are mocked client-side via <code className="font-mono">pesaswap.giftcard.intents</code>. ~92% success rate so you can see both happy and failure paths.
      </p>
    </div>
  );
}

function TenderRow({ tender, onPick }: { tender: Tender; onPick: () => void }) {
  const Icon = tender.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={tender.disabled}
      className="group flex w-full items-start gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-200 disabled:hover:bg-white dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-900/40"
    >
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-gray-600 dark:text-gray-300" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
          {tender.label}
          {tender.starred && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">default</span>
          )}
        </p>
        <p className="mt-0.5 text-[11px] text-gray-500">{tender.disabled ? tender.disabledReason : tender.detail}</p>
      </div>
    </button>
  );
}

function IntentPanel({
  intent,
  source,
  amount,
  currency,
  onCancel,
  onReset,
  running,
}: {
  intent: PaymentIntent | null;
  source: TenderSource;
  amount: number;
  currency: string;
  onCancel: () => void;
  onReset: () => void;
  running: boolean;
}) {
  const status: IntentStatus = intent?.status ?? 'pending';
  const isActive = status === 'pending' || status === 'awaiting_pin';
  const isOk = status === 'completed';
  const isFail = status === 'failed' || status === 'cancelled' || status === 'expired';

  const sourceLabel =
    source === 'card_balance' ? 'Card balance' :
    source === 'mpesa'        ? 'M-Pesa' :
    source === 'airtel'       ? 'Airtel Money' :
    source === 'mtn_momo'     ? 'MTN MoMo' :
    source === 'pesaswap_wallet' ? 'PESASWAP Wallet' :
    source === 'coop_bank'    ? 'Co-op Bank' :
    source === 'coop_bnpl'    ? 'Co-op BNPL' :
                                'Split';

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">{sourceLabel}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white">{currency} {amount.toLocaleString()}</p>
      </div>

      <div
        className={`rounded-lg border p-4 ${
          isOk     ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-900/30' :
          isFail   ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-900/30' :
                     'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-900/30'
        }`}
      >
        <div className="flex items-start gap-3">
          {isOk    && <Check className="mt-0.5 h-5 w-5 text-emerald-600" />}
          {isFail  && <XCircle className="mt-0.5 h-5 w-5 text-rose-600" />}
          {isActive && <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-sky-600" />}
          <div className="min-w-0 flex-1 text-sm">
            <p className={`font-semibold ${isOk ? 'text-emerald-800 dark:text-emerald-200' : isFail ? 'text-rose-800 dark:text-rose-200' : 'text-sky-800 dark:text-sky-200'}`}>
              {status === 'pending'       ? 'Creating intent…' :
               status === 'awaiting_pin'  ? 'Waiting for customer PIN…' :
               status === 'completed'     ? 'Authorised' :
               status === 'failed'        ? 'Failed' :
               status === 'cancelled'     ? 'Cancelled' :
                                            'Expired'}
            </p>
            {status === 'awaiting_pin' && (
              <p className="text-xs text-sky-700 dark:text-sky-300">STK push sent — customer has 60s to enter their PIN.</p>
            )}
            {isOk && intent?.mno_txn_ref && (
              <p className="font-mono text-xs text-emerald-700 dark:text-emerald-300">ref: {intent.mno_txn_ref}</p>
            )}
            {isFail && intent?.failure_reason && (
              <p className="text-xs text-rose-700 dark:text-rose-300">{intent.failure_reason}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {isActive && running && (
          <button type="button" onClick={onCancel} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            <XIcon className="h-3.5 w-3.5" /> Cancel
          </button>
        )}
        {!isActive && (
          <button type="button" onClick={onReset} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700">
            <Banknote className="h-3.5 w-3.5" /> Take another payment
          </button>
        )}
      </div>
    </div>
  );
}
