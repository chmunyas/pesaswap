/**
 * giftcard-name — derive a human-readable display name for a gift card.
 *
 * The schema gives us recipient_name, sender_name, value, currency, and
 * created_at. Strings like "GC-A1B2-C3D4-E5F6" are useful for lookups
 * but unkind to a cashier scanning a list of 200 cards. This helper
 * computes a friendly name that surfaces who, who-from, how much, and
 * when — in roughly that order of importance.
 *
 * Examples:
 *   {sender: 'Bob', recipient: 'Alice', value: 1000, currency: 'KES'}
 *     → "Bob → Alice · KES 1,000"
 *   {sender: null, recipient: 'Alice', value: 5000, currency: 'KES', date: '2026-06-06'}
 *     → "Gift for Alice · KES 5,000 · 6 Jun"
 *   {sender: 'Bob', value: 1000, currency: 'KES'}
 *     → "Gift from Bob · KES 1,000"
 *   {value: 1000, currency: 'KES', date: '2026-06-06'}
 *     → "Gift card · KES 1,000 · 6 Jun"
 *
 * The fall-through ensures we always return a non-empty string. Callers
 * decide whether to prefix the masked code separately.
 */

interface NameInput {
  sender?: string | null;
  recipient?: string | null;
  value: number;
  currency: string;
  /** ISO date or undefined; only included when both names are absent. */
  date?: string | null;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  // Intl.DateTimeFormat('en-GB', …) gives "6 Jun" — terse, no year unless
  // it differs from the current year.
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  }).format(d);
}

function formatAmount(value: number, currency: string): string {
  // We don't use Intl.NumberFormat with `style: 'currency'` here because it
  // wants ISO 4217 codes only; KES/UGX/TZS work but custom currencies
  // (rare but possible) would crash. Manual formatting is simpler.
  return `${currency} ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function giftcardDisplayName(input: NameInput): string {
  const sender = input.sender?.trim();
  const recipient = input.recipient?.trim();
  const amount = formatAmount(input.value, input.currency);
  const date = shortDate(input.date);

  if (sender && recipient) {
    return `${sender} → ${recipient} · ${amount}`;
  }
  if (recipient) {
    return date
      ? `Gift for ${recipient} · ${amount} · ${date}`
      : `Gift for ${recipient} · ${amount}`;
  }
  if (sender) {
    return date
      ? `Gift from ${sender} · ${amount} · ${date}`
      : `Gift from ${sender} · ${amount}`;
  }
  return date ? `Gift card · ${amount} · ${date}` : `Gift card · ${amount}`;
}
