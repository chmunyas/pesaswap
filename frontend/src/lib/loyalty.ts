/**
 * PESASWAP loyalty tier helper.
 *
 * The LoyaltyCustomer type contract is borrowed from chmunyas/merchantApp
 * (src/components/merchant/features/types.ts) but the tier-evaluation logic
 * is original — merchantApp ships only the type, no implementation.
 *
 * v1 scope (per Tier 2 plan): surface only `tier` + `totalSpent`.
 * `points` and `visits` are derived in a deterministic, demo-friendly way.
 */

export type LoyaltyTier = 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface LoyaltyCustomer {
  phone: string;
  name: string;
  points: number;
  totalSpent: number;
  visits: number;
  tier: LoyaltyTier;
  lastVisit: string;
}

/** Default thresholds (in store currency units, typically KES). Override via setLoyaltyThresholds() if needed. */
export const DEFAULT_LOYALTY_THRESHOLDS: Record<LoyaltyTier, number> = {
  Bronze: 0,
  Silver: 500,
  Gold: 2_000,
  Platinum: 5_000,
};

let activeThresholds: Record<LoyaltyTier, number> = { ...DEFAULT_LOYALTY_THRESHOLDS };

export function setLoyaltyThresholds(next: Partial<Record<LoyaltyTier, number>>): void {
  activeThresholds = { ...activeThresholds, ...next };
}

export function getLoyaltyThresholds(): Record<LoyaltyTier, number> {
  return { ...activeThresholds };
}

/** Pure tier evaluator — no side-effects, no I/O. */
export function getTier(totalSpent: number): LoyaltyTier {
  if (!Number.isFinite(totalSpent) || totalSpent < 0) return 'Bronze';
  if (totalSpent >= activeThresholds.Platinum) return 'Platinum';
  if (totalSpent >= activeThresholds.Gold) return 'Gold';
  if (totalSpent >= activeThresholds.Silver) return 'Silver';
  return 'Bronze';
}

/** Deterministic points (1 point per 100 spent). Demo-friendly, no backend needed. */
export function getPoints(totalSpent: number): number {
  if (!Number.isFinite(totalSpent) || totalSpent < 0) return 0;
  return Math.floor(totalSpent / 100);
}

/** Distance to the next tier (negative = already at top). */
export function getProgressToNextTier(totalSpent: number): {
  current: LoyaltyTier;
  next: LoyaltyTier | null;
  remaining: number;
  pct: number;
} {
  const current = getTier(totalSpent);
  const order: LoyaltyTier[] = ['Bronze', 'Silver', 'Gold', 'Platinum'];
  const idx = order.indexOf(current);
  const next = idx < order.length - 1 ? order[idx + 1] : null;

  if (!next) {
    return { current, next: null, remaining: 0, pct: 100 };
  }

  const currentThreshold = activeThresholds[current];
  const nextThreshold = activeThresholds[next];
  const span = nextThreshold - currentThreshold;
  const into = Math.max(0, totalSpent - currentThreshold);
  const pct = span > 0 ? Math.min(100, (into / span) * 100) : 0;
  const remaining = Math.max(0, nextThreshold - totalSpent);

  return { current, next, remaining, pct };
}

/** Tailwind classes per tier (badge background + text). */
export function getTierClasses(tier: LoyaltyTier): { badge: string; dot: string } {
  switch (tier) {
    case 'Platinum':
      return {
        badge: 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white',
        dot: 'bg-fuchsia-400',
      };
    case 'Gold':
      return {
        badge: 'bg-gradient-to-r from-amber-400 to-yellow-500 text-amber-950',
        dot: 'bg-amber-500',
      };
    case 'Silver':
      return {
        badge: 'bg-gradient-to-r from-slate-300 to-slate-400 text-slate-900',
        dot: 'bg-slate-400',
      };
    case 'Bronze':
    default:
      return {
        badge: 'bg-gradient-to-r from-orange-300 to-amber-600 text-orange-950',
        dot: 'bg-amber-700',
      };
  }
}

/** Build a LoyaltyCustomer view from an OSPOS customer record. */
export function toLoyaltyCustomer(input: {
  first_name: string;
  last_name: string;
  phone_number: string;
  total_spent: number;
  last_visit: string;
  visits?: number;
}): LoyaltyCustomer {
  const totalSpent = Number(input.total_spent) || 0;
  return {
    phone: input.phone_number,
    name: `${input.first_name} ${input.last_name}`.trim(),
    points: getPoints(totalSpent),
    totalSpent,
    visits: input.visits ?? 0,
    tier: getTier(totalSpent),
    lastVisit: input.last_visit,
  };
}
