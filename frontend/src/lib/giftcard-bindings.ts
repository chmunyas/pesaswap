/**
 * Gift-card binding + payment-intent client. Talks to the real backend
 * shipped in commit 5169ba535 (Phase 6).
 *
 * Replaces the localStorage mock that shipped in c51cebcb1. The public
 * surface intentionally preserves the mock's sync getters (byCode, list,
 * intents, walletFor, mnoLabel, maskPhone) so the existing BindModal,
 * TenderPicker, GiftCardTenderDemoPage and PublicGiftCardSelfServicePage
 * keep working unchanged. Sync getters read from an in-memory cache that
 * the parent component populates via `prime()` BEFORE rendering the
 * consuming component (this is the hydration-cache pattern called out in
 * the rubber-duck blocker #1 — see plan.md).
 *
 * Async actions (bind, unbind, createIntent, cancelIntent, sendOtp,
 * publicUnbind, publicDisable) call the API directly and update the cache
 * on return.
 */

import { api } from './api';

export type MnoProvider = 'mpesa' | 'airtel' | 'mtn_momo';

export type TenderSource =
  | 'card_balance'
  | 'mpesa'
  | 'airtel'
  | 'mtn_momo'
  | 'pesaswap_wallet'
  | 'coop_bank'
  | 'coop_bnpl'
  | 'split';

export type BindingStatus = 'pending' | 'active' | 'disabled';

export interface CardBinding {
  giftcard_code: string;     // legacy mock field — populated from giftcard_number
  mobile_number: string;
  mno_provider: MnoProvider;
  status: BindingStatus;
  bound_at: string | null;
  last_used_at: string | null;
  pin_attempts: number;
}

export type IntentStatus =
  | 'pending'
  | 'awaiting_pin'
  | 'authorised'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export interface PaymentIntent {
  intent_id: string;          // string for backwards-compat with mock — server returns int
  giftcard_code: string | null;
  amount: number;
  currency: string;
  source: TenderSource;
  status: IntentStatus;
  mno_request_id: string | null;
  mno_txn_ref: string | null;
  failure_code: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface PesaswapWallet {
  customer_email: string;
  balance: number;
  currency: string;
}

// ---------- internal cache ----------

interface CachedCard {
  giftcard_id: number;
  binding: CardBinding | null;
}

// Keyed by uppercase giftcard_number.
const cache = new Map<string, CachedCard>();
// Most-recent intents keyed by intent_id (string).
const intentCache = new Map<string, PaymentIntent>();

function normalizeCode(code: string): string {
  return code.toUpperCase().trim();
}

function mnoLabel(provider: MnoProvider): string {
  if (provider === 'mpesa') return 'M-Pesa';
  if (provider === 'airtel') return 'Airtel Money';
  return 'MTN MoMo';
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  return `+${digits.slice(0, -7).padEnd(3, '*')} ••• ${digits.slice(-4)}`;
}

function bindingFromServer(raw: Record<string, unknown>, code: string): CardBinding {
  return {
    giftcard_code: code,
    mobile_number: String(raw.mobile_number ?? ''),
    mno_provider: (String(raw.mno_provider ?? 'mpesa') as MnoProvider),
    status: (String(raw.status ?? 'active') as BindingStatus),
    bound_at: (raw.bound_at as string | null) ?? null,
    last_used_at: (raw.last_used_at as string | null) ?? null,
    pin_attempts: Number(raw.pin_attempts ?? 0),
  };
}

function intentFromServer(raw: Record<string, unknown>, code: string | null): PaymentIntent {
  return {
    intent_id: String(raw.intent_id ?? ''),
    giftcard_code: code,
    amount: Number(raw.amount ?? 0),
    currency: String(raw.currency ?? 'KES'),
    source: (String(raw.source ?? 'card_balance') as TenderSource),
    status: (String(raw.status ?? 'pending') as IntentStatus),
    mno_request_id: (raw.mno_request_id as string | null) ?? null,
    mno_txn_ref: (raw.mno_txn_ref as string | null) ?? null,
    failure_code: (raw.failure_code as string | null) ?? null,
    failure_reason: (raw.failure_reason as string | null) ?? null,
    created_at: String(raw.created_at ?? new Date().toISOString()),
    completed_at: (raw.completed_at as string | null) ?? null,
  };
}

// ---------- public API ----------

export const giftcardBindings = {
  /** Reset everything — call on logout or test teardown. */
  reset(): void {
    cache.clear();
    intentCache.clear();
  },

  /**
   * Hydrate the cache from a giftcard payload that may include
   * `active_binding` (decorated by the backend's `decorate()` method since
   * commit 5169ba535's follow-up). Call this BEFORE rendering any consumer
   * that reads byCode().
   */
  prime(card: { giftcard_id: number; giftcard_number: string; active_binding?: Record<string, unknown> | null }): void {
    const code = normalizeCode(card.giftcard_number);
    const binding = card.active_binding ? bindingFromServer(card.active_binding, code) : null;
    cache.set(code, { giftcard_id: card.giftcard_id, binding });
  },

  /** Convenience for an array of cards — used by GiftCardsPage.refreshBindings(). */
  primeMany(cards: Array<{ giftcard_id: number; giftcard_number: string; active_binding?: Record<string, unknown> | null }>): void {
    for (const c of cards) this.prime(c);
  },

  /** Public-portal hydration by code. Returns the binding (or null). */
  async primeByCode(code: string): Promise<CardBinding | null> {
    try {
      const res = await api.giftcards.publicBinding(code);
      const raw = res.data?.binding;
      const normalized = normalizeCode(code);
      if (!raw) {
        // We don't get giftcard_id from the public endpoint (intentional —
        // PII reduction). Record null binding without id.
        cache.set(normalized, { giftcard_id: -1, binding: null });
        return null;
      }
      const binding = bindingFromServer(raw as Record<string, unknown>, normalized);
      cache.set(normalized, { giftcard_id: -1, binding });
      return binding;
    } catch {
      return null;
    }
  },

  // ----- sync getters (cache-backed) -----
  byCode(code: string): CardBinding | null {
    return cache.get(normalizeCode(code))?.binding ?? null;
  },

  list(): CardBinding[] {
    return Array.from(cache.values()).map((c) => c.binding).filter((b): b is CardBinding => b !== null);
  },

  intents(): PaymentIntent[] {
    return Array.from(intentCache.values()).slice(0, 50);
  },

  /**
   * PESASWAP wallet stub. Real wallet API is a follow-up; for now report
   * a zero balance (the TenderPicker correctly greys out the row when
   * balance < amount, so the demo continues to render gracefully).
   */
  walletFor(customerEmail: string | null | undefined, currency = 'KES'): PesaswapWallet {
    return { customer_email: customerEmail ?? '', balance: 0, currency };
  },

  // ----- async actions: admin -----
  async bind(args: { giftcard_code: string; mobile_number: string; mno_provider: MnoProvider }): Promise<CardBinding> {
    const code = normalizeCode(args.giftcard_code);
    const cached = cache.get(code);
    if (!cached || cached.giftcard_id <= 0) {
      throw new Error('Card must be primed (call prime() with the card object first).');
    }
    const res = await api.giftcards.bind(cached.giftcard_id, {
      mobile_number: args.mobile_number,
      mno_provider: args.mno_provider,
    });
    const raw = (res.data as Record<string, unknown> | undefined)?.binding as Record<string, unknown> | undefined;
    if (!raw) throw new Error('Binding response missing.');
    const binding = bindingFromServer(raw, code);
    cache.set(code, { giftcard_id: cached.giftcard_id, binding });
    return binding;
  },

  async unbind(code: string): Promise<void> {
    const normalized = normalizeCode(code);
    const cached = cache.get(normalized);
    if (!cached || cached.giftcard_id <= 0) {
      throw new Error('Card must be primed before unbind.');
    }
    await api.giftcards.unbind(cached.giftcard_id);
    cache.set(normalized, { giftcard_id: cached.giftcard_id, binding: null });
  },

  /**
   * Create a payment intent. For synchronous sources (card_balance,
   * pesaswap_wallet) the returned intent will already be 'completed'.
   * For MNO/Co-op sources the intent comes back 'awaiting_pin' and the
   * caller should poll showIntent() (or rely on the backend's dev-mode
   * auto-callback that completes the intent in ~2s).
   */
  async createIntent(args: {
    giftcard_code?: string | null;
    amount: number;
    currency: string;
    source: TenderSource;
    onStatusChange?: (intent: PaymentIntent) => void;
  }): Promise<PaymentIntent> {
    if (!args.giftcard_code) {
      throw new Error('Intent creation without a card is not supported in v1.');
    }
    const code = normalizeCode(args.giftcard_code);
    const cached = cache.get(code);
    if (!cached || cached.giftcard_id <= 0) {
      throw new Error('Card must be primed before createIntent.');
    }
    const res = await api.giftcards.createIntent(cached.giftcard_id, {
      amount: args.amount,
      currency: args.currency,
      source: args.source,
    });
    const raw = res.data?.intent as Record<string, unknown> | undefined;
    if (!raw) throw new Error('Intent response missing.');
    let intent = intentFromServer(raw, code);
    intentCache.set(intent.intent_id, intent);
    args.onStatusChange?.(intent);

    // For async sources we poll a few times so the TenderPicker sees the
    // transition without manual refresh. Dev-mode backend auto-completes
    // within ~50ms, so 2-3 polls is enough.
    if (intent.status === 'awaiting_pin' || intent.status === 'pending') {
      for (let i = 0; i < 5; i++) {
        await sleep(800);
        try {
          const poll = await api.giftcards.showIntent(cached.giftcard_id, Number(intent.intent_id));
          const polled = poll.data?.intent as Record<string, unknown> | undefined;
          if (polled) {
            intent = intentFromServer(polled, code);
            intentCache.set(intent.intent_id, intent);
            args.onStatusChange?.(intent);
            if (intent.status === 'completed' || intent.status === 'failed' || intent.status === 'cancelled' || intent.status === 'expired') {
              break;
            }
          }
        } catch {
          break;
        }
      }
    }
    return intent;
  },

  async cancelIntent(intentId: string): Promise<void> {
    const intent = intentCache.get(intentId);
    if (!intent || !intent.giftcard_code) return;
    const cached = cache.get(intent.giftcard_code);
    if (!cached || cached.giftcard_id <= 0) return;
    await api.giftcards.cancelIntent(cached.giftcard_id, Number(intentId));
    intent.status = 'cancelled';
    intent.completed_at = new Date().toISOString();
    intentCache.set(intentId, intent);
  },

  // ----- async actions: public self-service -----
  /** Send a 6-digit OTP to the bound phone for an unbind or disable action. */
  async sendOtp(args: { giftcard_code: string; action: 'unbind' | 'disable' }): Promise<{ phone_last4: string; demo_code: string | null; expires_at: string | null }> {
    const res = await api.giftcards.publicSendOtp(args.giftcard_code, args.action);
    const data = res.data as Record<string, unknown> | undefined;
    const maskedPhone = String(data?.masked_phone ?? '');
    const phone_last4 = maskedPhone.slice(-4) || '????';
    return {
      phone_last4,
      demo_code: (data?.demo_code as string | null) ?? null,
      expires_at: (data?.expires_at as string | null) ?? null,
    };
  },

  /** OTP-gated customer unbind. Returns true on success. */
  async publicUnbind(code: string, otp: string): Promise<void> {
    await api.giftcards.publicUnbind(code, otp);
    cache.delete(normalizeCode(code));
  },

  /** OTP-gated customer disable (freeze the card). */
  async publicDisable(code: string, otp: string): Promise<void> {
    await api.giftcards.publicDisable(code, otp);
    cache.delete(normalizeCode(code));
  },

  // ----- pure helpers re-exported for the UI -----
  maskPhone,
  mnoLabel,
};

// Back-compat alias — existing components import { giftcardBindingMock }.
// New code should use { giftcardBindings } above.
export const giftcardBindingMock = giftcardBindings;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
