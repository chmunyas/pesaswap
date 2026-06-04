const BNPL_TRANSACTIONS_KEY = "pesaswap.bnpl.transactions";
const BNPL_PENDING_KEY = "pesaswap.bnpl.pending";

export type BNPLEligibilityRequest = {
  nationalId: string;
  amount: number;
  merchantId?: string;
};

export type BNPLEligibilityResponse = {
  eligible: boolean;
  customerName?: string;
  phone?: string;
  creditLimit?: number;
  availableLimit?: number;
  tenure: number[];
  interestRate: number;
  reason?: string;
};

export type BNPLInitiateRequest = {
  nationalId: string;
  amount: number;
  tenure: number;
  merchantId: string;
  orderId: string;
  description: string;
};

export type BNPLInitiateResponse = {
  transactionId: string;
  status: "otp_sent" | "declined";
  otpPhone: string;
  monthlyPayment: number;
  totalPayable: number;
};

export type BNPLVerifyResponse = {
  status: "approved" | "failed" | "expired";
  coopReference?: string;
  settlementDate?: string;
};

export type BNPLTransaction = {
  id: string;
  nationalId: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  tenure: number;
  interestRate: number;
  monthlyPayment: number;
  totalPayable: number;
  status:
    | "checking"
    | "eligible"
    | "otp_sent"
    | "approved"
    | "declined"
    | "active"
    | "completed"
    | "defaulted";
  coopReference?: string;
  merchantPaidAt?: string;
  orderId?: string;
  createdAt: string;
};

type PendingBNPLTransaction = BNPLTransaction & {
  description: string;
  merchantId: string;
};

const FIRST_NAMES = [
  "Akinyi",
  "Brian",
  "Caroline",
  "Dennis",
  "Esther",
  "Faith",
  "George",
  "Hellen",
] as const;
const LAST_NAMES = [
  "Mwangi",
  "Otieno",
  "Wanjiku",
  "Njeri",
  "Kamau",
  "Achieng",
  "Kiptoo",
  "Mutiso",
] as const;

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getStorageItem<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function setStorageItem<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function hashNationalId(nationalId: string) {
  return nationalId.split("").reduce((sum, digit, index) => {
    return sum + Number(digit) * (index + 11);
  }, 0);
}

function getInterestRate(amount: number) {
  if (amount < 5000) return 0;
  if (amount < 20000) return 5;
  return 10;
}

function getCustomerName(nationalId: string) {
  const hash = hashNationalId(nationalId);
  const first = FIRST_NAMES[hash % FIRST_NAMES.length];
  const last = LAST_NAMES[(hash * 3) % LAST_NAMES.length];
  return `${first} ${last}`;
}

function getMaskedPhone(nationalId: string) {
  const hash = hashNationalId(nationalId);
  const suffix = String(100 + (hash % 900));
  return `254***${suffix}`;
}

function getCreditLimit(nationalId: string) {
  const hash = hashNationalId(nationalId);
  const raw = 5000 + ((hash * 137) % 95001);
  return Math.round(raw / 500) * 500;
}

function getAvailableLimit(nationalId: string, amount: number) {
  const creditLimit = getCreditLimit(nationalId);
  const hash = hashNationalId(nationalId);
  const ratio = 0.45 + (hash % 45) / 100;
  const seededLimit = Math.round((creditLimit * ratio) / 100) * 100;
  return Math.min(
    creditLimit,
    Math.max(seededLimit, Math.ceil(amount / 100) * 100),
  );
}

function maskNationalId(nationalId: string) {
  return `****${nationalId.slice(-4)}`;
}

function getPendingTransactions() {
  return getStorageItem<Record<string, PendingBNPLTransaction>>(
    BNPL_PENDING_KEY,
    {},
  );
}

function savePendingTransaction(transaction: PendingBNPLTransaction) {
  const pending = getPendingTransactions();
  pending[transaction.id] = transaction;
  setStorageItem(BNPL_PENDING_KEY, pending);
}

function removePendingTransaction(transactionId: string) {
  const pending = getPendingTransactions();
  delete pending[transactionId];
  setStorageItem(BNPL_PENDING_KEY, pending);
}

export function isValidNationalId(id: string): boolean {
  return /^\d{8}$/.test(id.trim());
}

export function calculateMonthlyPayment(
  amount: number,
  tenure: number,
  rate: number,
): number {
  const months = Math.max(1, Math.round(tenure / 30));
  const totalPayable = amount + amount * (rate / 100);
  return Math.round((totalPayable / months + Number.EPSILON) * 100) / 100;
}

function buildEligibilityResponse(
  req: BNPLEligibilityRequest,
): BNPLEligibilityResponse {
  if (!isValidNationalId(req.nationalId)) {
    return {
      eligible: false,
      tenure: [30, 60, 90],
      interestRate: getInterestRate(req.amount),
      reason: "Enter a valid 8-digit Kenyan National ID.",
    };
  }

  const nationalId = req.nationalId.trim();
  const interestRate = getInterestRate(req.amount);

  if (nationalId.startsWith("0")) {
    return {
      eligible: false,
      tenure: [30, 60, 90],
      interestRate,
      reason: "Co-op Bank could not extend BNPL for this ID today.",
    };
  }

  const creditLimit = getCreditLimit(nationalId);
  const availableLimit = nationalId.match(/^[123]/)
    ? Math.max(req.amount, getAvailableLimit(nationalId, req.amount))
    : getAvailableLimit(nationalId, req.amount);

  return {
    eligible: true,
    customerName: getCustomerName(nationalId),
    phone: getMaskedPhone(nationalId),
    creditLimit,
    availableLimit,
    tenure: [30, 60, 90],
    interestRate,
  };
}

export async function checkEligibility(
  req: BNPLEligibilityRequest,
): Promise<BNPLEligibilityResponse> {
  await delay(1500);
  return buildEligibilityResponse(req);
}

export async function initiateBNPL(
  req: BNPLInitiateRequest,
): Promise<BNPLInitiateResponse> {
  await delay(1000);

  const eligibility = buildEligibilityResponse({
    amount: req.amount,
    merchantId: req.merchantId,
    nationalId: req.nationalId,
  });

  if (
    !eligibility.eligible ||
    !eligibility.customerName ||
    !eligibility.phone
  ) {
    return {
      transactionId: `BNPL-${Date.now()}`,
      status: "declined",
      otpPhone: eligibility.phone || "254***000",
      monthlyPayment: 0,
      totalPayable: 0,
    };
  }

  const transactionId = `BNPL-${Date.now()}-${req.nationalId.slice(-3)}`;
  const interestRate = getInterestRate(req.amount);
  const totalPayable =
    Math.round((req.amount + req.amount * (interestRate / 100)) * 100) / 100;
  const monthlyPayment = calculateMonthlyPayment(
    req.amount,
    req.tenure,
    interestRate,
  );

  savePendingTransaction({
    id: transactionId,
    nationalId: maskNationalId(req.nationalId),
    customerName: eligibility.customerName,
    customerPhone: eligibility.phone,
    amount: req.amount,
    tenure: req.tenure,
    interestRate,
    monthlyPayment,
    totalPayable,
    status: "otp_sent",
    orderId: req.orderId,
    createdAt: new Date().toISOString(),
    description: req.description,
    merchantId: req.merchantId,
  });

  return {
    transactionId,
    status: "otp_sent",
    otpPhone: eligibility.phone,
    monthlyPayment,
    totalPayable,
  };
}

export async function verifyBNPLOtp(
  transactionId: string,
  otp: string,
): Promise<BNPLVerifyResponse> {
  await delay(500);

  const pending = getPendingTransactions()[transactionId];
  if (!pending) {
    return { status: "expired" };
  }

  if (otp.trim() !== "1234") {
    return { status: "failed" };
  }

  const settlementDate = new Date(
    Date.now() + 24 * 60 * 60 * 1000,
  ).toISOString();
  const coopReference = `COOP-${Date.now().toString().slice(-8)}`;
  const approvedTransaction: BNPLTransaction = {
    ...pending,
    coopReference,
    status: "approved",
  };

  saveBNPLTransaction(approvedTransaction);
  removePendingTransaction(transactionId);

  return {
    status: "approved",
    coopReference,
    settlementDate,
  };
}

export function getBNPLTransactions(): BNPLTransaction[] {
  return getStorageItem<BNPLTransaction[]>(BNPL_TRANSACTIONS_KEY, []);
}

export function saveBNPLTransaction(txn: BNPLTransaction): void {
  const existing = getBNPLTransactions().filter((entry) => entry.id !== txn.id);
  setStorageItem(BNPL_TRANSACTIONS_KEY, [txn, ...existing]);
}
