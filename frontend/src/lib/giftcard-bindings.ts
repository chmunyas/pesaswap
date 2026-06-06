/**
 * Gift-card binding + tender + intent mock library.
 *
 * Pure client-side mock that simulates the real backend flows we'll build
 * later (`giftcard_bindings`, `giftcard_payment_intents`, MNO webhooks).
 * Backed by localStorage under the `pesaswap.giftcard.*` namespace so the
 * demo survives page reloads.
 *
 * Pattern matches frontend/src/lib/coop-bnpl.ts and frontend/src/lib/walkout.ts —
 * the cashier UX is fully demo-able today, and swapping the mock for a real
 * API client is a single file change.
 */

const BINDINGS_KEY = 'pesaswap.giftcard.bindings';
const INTENTS_KEY = 'pesaswap.giftcard.intents';
const WALLETS_KEY = 'pesaswap.giftcard.wallets';
const OTP_KEY = 'pesaswap.giftcard.otp';

// Lift the % up if you want fewer demo failures.
const STK_SUCCESS_RATE = 0.92;
// Pretend the MNO callback arrives between these bounds (ms).
const STK_MIN_LATENCY_MS = 1500;
const STK_MAX_LATENCY_MS = 3500;

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
  giftcard_code: string;
  mobile_number: string;
  mno_provider: MnoProvider;
  status: BindingStatus;
  bound_at: string;
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
  intent_id: string;
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

interface OtpRecord {
  giftcard_code: string;
  action: 'unbind' | 'disable';
  code: string;
  expires_at: number;
}

// ---------- low-level localStorage I/O ----------

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be full or disabled (Safari private mode) — silently fail.
  }
}

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomLatencyMs(): number {
  return STK_MIN_LATENCY_MS + Math.floor(Math.random() * (STK_MAX_LATENCY_MS - STK_MIN_LATENCY_MS));
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return phone;
  return `+${digits.slice(0, -7).padEnd(3, '*')} ••• ${digits.slice(-4)}`;
}

function mnoLabel(provider: MnoProvider): string {
  if (provider === 'mpesa') return 'M-Pesa';
  if (provider === 'airtel') return 'Airtel Money';
  return 'MTN MoMo';
}

// ---------- public API ----------

export const giftcardBindingMock = {
  // ----- bindings -----
  list(): CardBinding[] {
    return load<CardBinding[]>(BINDINGS_KEY, []);
  },

  byCode(code: string): CardBinding | null {
    const all = this.list();
    const upper = code.toUpperCase();
    return all.find((b) => b.giftcard_code === upper && b.status === 'active') ?? null;
  },

  /**
   * Cashier-initiated binding. Returns a Promise that resolves when the
   * mocked STK push callback comes back. Throws on PIN decline / timeout.
   */
  async bind(args: {
    giftcard_code: string;
    mobile_number: string;
    mno_provider: MnoProvider;
  }): Promise<CardBinding> {
    const code = args.giftcard_code.toUpperCase();
    const phone = args.mobile_number.replace(/\s+/g, '');
    if (!/^\+?\d{9,15}$/.test(phone)) {
      throw new Error('Mobile number must be 9-15 digits, optionally with leading +.');
    }
    // Persist a 'pending' record so the UI can show the in-flight state
    // even if the user refreshes mid-flow.
    const pending: CardBinding = {
      giftcard_code: code,
      mobile_number: phone,
      mno_provider: args.mno_provider,
      status: 'pending',
      bound_at: new Date().toISOString(),
      last_used_at: null,
      pin_attempts: 0,
    };
    const upserted = upsertBinding(pending);

    await sleep(randomLatencyMs());

    // 90%+ success in demo; otherwise emit a realistic MNO failure mode.
    if (Math.random() > STK_SUCCESS_RATE) {
      upserted.pin_attempts++;
      upserted.status = 'pending';  // keep, so the user can retry
      saveBindings(replaceBinding(upserted));
      const reason = rand(['PIN_DECLINED', 'TIMEOUT', 'NO_NETWORK'] as const);
      throw new Error(
        reason === 'PIN_DECLINED' ? 'Customer declined the PIN prompt.' :
        reason === 'TIMEOUT'      ? 'STK push timed out — phone may be offline.' :
                                    'Phone reported no network signal.',
      );
    }

    upserted.status = 'active';
    saveBindings(replaceBinding(upserted));
    return upserted;
  },

  async unbind(code: string): Promise<void> {
    const upper = code.toUpperCase();
    const all = this.list().map((b) =>
      b.giftcard_code === upper ? { ...b, status: 'disabled' as BindingStatus } : b,
    );
    saveBindings(all);
  },

  // ----- payment intents -----
  intents(): PaymentIntent[] {
    return load<PaymentIntent[]>(INTENTS_KEY, []);
  },

  /**
   * Create an intent + start the mocked authorisation flow. The Promise
   * resolves with the final intent (completed/failed/cancelled).
   */
  async createIntent(args: {
    giftcard_code?: string | null;
    amount: number;
    currency: string;
    source: TenderSource;
    onStatusChange?: (intent: PaymentIntent) => void;
  }): Promise<PaymentIntent> {
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      throw new Error('Amount must be positive.');
    }

    const intent: PaymentIntent = {
      intent_id: newId('intent'),
      giftcard_code: args.giftcard_code?.toUpperCase() ?? null,
      amount: args.amount,
      currency: args.currency,
      source: args.source,
      status: 'pending',
      mno_request_id: null,
      mno_txn_ref: null,
      failure_code: null,
      failure_reason: null,
      created_at: new Date().toISOString(),
      completed_at: null,
    };
    saveIntent(intent);
    args.onStatusChange?.(intent);

    // Card balance + wallet sources skip the PIN step (no STK push).
    const needsPin =
      args.source === 'mpesa' ||
      args.source === 'airtel' ||
      args.source === 'mtn_momo' ||
      args.source === 'coop_bank' ||
      args.source === 'coop_bnpl';

    if (needsPin) {
      intent.status = 'awaiting_pin';
      intent.mno_request_id = newId('mno_req');
      saveIntent(intent);
      args.onStatusChange?.(intent);
      await sleep(randomLatencyMs());
    } else {
      // wallet/balance-style sources just take a moment to "settle"
      await sleep(600);
    }

    // Decide success/fail
    const succeeds = Math.random() <= STK_SUCCESS_RATE;
    if (!succeeds) {
      intent.status = 'failed';
      const failureCode = rand([
        'PIN_DECLINED', 'INSUFFICIENT_FUNDS', 'TIMEOUT', 'CUSTOMER_CANCELLED',
      ] as const);
      intent.failure_code = failureCode;
      intent.failure_reason =
        failureCode === 'PIN_DECLINED'        ? 'Customer declined the PIN prompt.' :
        failureCode === 'INSUFFICIENT_FUNDS'  ? 'Source had insufficient funds.' :
        failureCode === 'TIMEOUT'             ? 'No response within 60s.' :
                                                'Customer cancelled the payment.';
      intent.completed_at = new Date().toISOString();
      saveIntent(intent);
      args.onStatusChange?.(intent);
      return intent;
    }

    intent.status = 'completed';
    intent.mno_txn_ref = newId('MNO').replace('intent_', '').toUpperCase();
    intent.completed_at = new Date().toISOString();
    saveIntent(intent);
    args.onStatusChange?.(intent);

    // Bump the binding's last_used_at on a successful MNO debit.
    if (intent.giftcard_code) {
      const all = giftcardBindingMock.list();
      const updated = all.map((b) =>
        b.giftcard_code === intent.giftcard_code && b.status === 'active'
          ? { ...b, last_used_at: intent.completed_at }
          : b,
      );
      saveBindings(updated);
    }

    return intent;
  },

  async cancelIntent(intentId: string): Promise<void> {
    const list = this.intents();
    const updated = list.map((i) =>
      i.intent_id === intentId && (i.status === 'pending' || i.status === 'awaiting_pin')
        ? { ...i, status: 'cancelled' as IntentStatus, completed_at: new Date().toISOString() }
        : i,
    );
    save(INTENTS_KEY, updated);
  },

  // ----- PESASWAP wallet (mock) -----
  walletFor(customerEmail: string | null | undefined, currency: string = 'KES'): PesaswapWallet {
    if (!customerEmail) return { customer_email: '', balance: 0, currency };
    const all = load<PesaswapWallet[]>(WALLETS_KEY, []);
    const existing = all.find((w) => w.customer_email === customerEmail);
    if (existing) return existing;
    // Bootstrap a demo wallet with a small balance so the option is selectable.
    const fresh: PesaswapWallet = { customer_email: customerEmail, balance: 3500, currency };
    save(WALLETS_KEY, [...all, fresh]);
    return fresh;
  },

  // ----- self-service OTP -----
  sendOtp(args: { giftcard_code: string; action: OtpRecord['action'] }): { phone_last4: string; demo_code: string } {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const record: OtpRecord = {
      giftcard_code: args.giftcard_code.toUpperCase(),
      action: args.action,
      code,
      expires_at: Date.now() + 5 * 60 * 1000,
    };
    save(OTP_KEY, record);
    const binding = giftcardBindingMock.byCode(args.giftcard_code);
    const last4 = binding ? binding.mobile_number.slice(-4) : '????';
    // Returns the code inline because this is a demo — a real backend never
    // would. The UI prefills it so the demo flow is single-tap-completable.
    return { phone_last4: last4, demo_code: code };
  },

  verifyOtp(args: { giftcard_code: string; action: OtpRecord['action']; code: string }): boolean {
    const record = load<OtpRecord | null>(OTP_KEY, null);
    if (!record) return false;
    if (record.giftcard_code !== args.giftcard_code.toUpperCase()) return false;
    if (record.action !== args.action) return false;
    if (record.expires_at < Date.now()) return false;
    return record.code === args.code;
  },

  // ----- helpers re-exported for the UI -----
  maskPhone,
  mnoLabel,
};

// ---------- internal helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveBindings(value: CardBinding[]): void {
  save(BINDINGS_KEY, value);
}

function upsertBinding(b: CardBinding): CardBinding {
  const all = giftcardBindingMock.list();
  const others = all.filter((x) => x.giftcard_code !== b.giftcard_code);
  saveBindings([b, ...others]);
  return b;
}

function replaceBinding(b: CardBinding): CardBinding[] {
  const all = giftcardBindingMock.list();
  return all.map((x) => (x.giftcard_code === b.giftcard_code ? b : x));
}

function saveIntent(i: PaymentIntent): void {
  const all = giftcardBindingMock.intents();
  const others = all.filter((x) => x.intent_id !== i.intent_id);
  save(INTENTS_KEY, [i, ...others].slice(0, 50));  // cap at 50 so it doesn't grow unbounded
}
