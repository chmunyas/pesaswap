/**
 * GiftCardTenderDemoPage — back-office demo page for the <TenderPicker>.
 *
 * Lets a cashier (or someone giving a demo) scan a gift card code, type the
 * amount due, and pick a tender to authorise. Reachable from the Office nav
 * under "Gift Card Tender Demo". The same `<TenderPicker>` component will be
 * embedded in POS in a follow-up commit.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Banknote, ScanLine, Search } from 'lucide-react';
import { api } from '../lib/api';
import { TenderPicker, type TenderPickerCard } from '../components/giftcard/TenderPicker';

interface GiftCardSummary {
  giftcard_id: number;
  giftcard_number: string;
  masked_code: string;
  value: number;
  currency: string;
  recipient_name: string | null;
  recipient_email: string | null;
  status: string;
}

function normalizeCard(raw: Record<string, unknown>): GiftCardSummary {
  return {
    giftcard_id: Number(raw.giftcard_id ?? 0),
    giftcard_number: String(raw.giftcard_number ?? ''),
    masked_code: String(raw.masked_code ?? '****'),
    value: Number(raw.value ?? 0),
    currency: String(raw.currency ?? 'KES'),
    recipient_name: (raw.recipient_name as string | null) ?? null,
    recipient_email: (raw.recipient_email as string | null) ?? null,
    status: String(raw.status ?? 'active'),
  };
}

export function GiftCardTenderDemoPage() {
  const [allCards, setAllCards] = useState<GiftCardSummary[]>([]);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<GiftCardSummary | null>(null);
  const [amount, setAmount] = useState<string>('1250');
  const [stage, setStage] = useState<'scan' | 'amount' | 'tender'>('scan');

  async function loadCards() {
    try {
      const res = await api.giftcards.list(1, 100, '', 'active');
      const list = Array.isArray(res.data?.giftcards) ? res.data!.giftcards : [];
      setAllCards(list.map((r) => normalizeCard(r as Record<string, unknown>)));
    } catch {
      setAllCards([]);
    }
  }

  useEffect(() => {
    void loadCards();
  }, []);

  const filtered = search
    ? allCards.filter((c) =>
        c.giftcard_number.toLowerCase().includes(search.toLowerCase())
        || (c.recipient_name ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : allCards.slice(0, 12);

  function pickCard(card: GiftCardSummary) {
    setPicked(card);
    setStage('amount');
  }

  function goSkip() {
    setPicked(null);
    setStage('amount');
  }

  function submitAmount(e: FormEvent) {
    e.preventDefault();
    const v = Number(amount);
    if (!Number.isFinite(v) || v <= 0) return;
    setStage('tender');
  }

  function reset() {
    setPicked(null);
    setAmount('1250');
    setStage('scan');
  }

  const tenderCard: TenderPickerCard | null = picked
    ? {
        giftcard_id: picked.giftcard_id,
        giftcard_number: picked.giftcard_number,
        masked_code: picked.masked_code,
        value: picked.value,
        currency: picked.currency,
        recipient_name: picked.recipient_name,
        recipient_email: picked.recipient_email,
      }
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
          <Banknote className="h-6 w-6" /> Take a Payment — Tender Demo
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Cashier UI for the multi-tender gift-card payment flow. Scan a card (or skip for a bearer
          payment), enter the amount, then pick the tender — card balance, M-Pesa, Airtel, MTN MoMo,
          PESASWAP wallet, Co-op direct debit, or Co-op BNPL.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
        <Step n={1} label="Scan card" active={stage === 'scan'} done={stage !== 'scan'} />
        <span>→</span>
        <Step n={2} label="Amount" active={stage === 'amount'} done={stage === 'tender'} />
        <span>→</span>
        <Step n={3} label="Tender" active={stage === 'tender'} />
      </div>

      {stage === 'scan' && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
            <ScanLine className="h-4 w-4" /> Tap a card on the NFC reader
          </p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Or search by code / recipient..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-xs text-gray-500 dark:border-gray-700">
              No active cards yet. Issue one from the Gift Cards page first.
            </p>
          ) : (
            <div className="space-y-1.5">
              {filtered.map((c) => (
                <button
                  key={c.giftcard_id}
                  type="button"
                  onClick={() => pickCard(c)}
                  className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left hover:border-blue-300 hover:bg-blue-50/40 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-900/40"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold text-gray-900 dark:text-white">{c.giftcard_number}</p>
                    <p className="truncate text-[11px] text-gray-500">{c.recipient_name ?? 'Bearer'}</p>
                  </div>
                  <p className="font-semibold text-gray-900 dark:text-white">{c.currency} {c.value.toLocaleString()}</p>
                </button>
              ))}
            </div>
          )}
          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <button
              type="button"
              onClick={goSkip}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Skip — no card, take a regular payment
            </button>
          </div>
        </div>
      )}

      {stage === 'amount' && (
        <form onSubmit={submitAmount} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {tenderCard && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs dark:bg-gray-900">
              <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">Scanned card</p>
              <p className="mt-1 font-mono font-semibold text-gray-900 dark:text-white">{tenderCard.masked_code}</p>
              <p className="text-gray-500">{tenderCard.recipient_name ?? 'Bearer card'} · balance {tenderCard.currency} {tenderCard.value.toLocaleString()}</p>
            </div>
          )}
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
            Amount due
            <input
              autoFocus
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-3 text-xl font-bold dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={reset} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Back</button>
            <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Continue → Tender</button>
          </div>
        </form>
      )}

      {stage === 'tender' && (
        <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <TenderPicker
            card={tenderCard}
            amount={Number(amount) || 0}
            currency={tenderCard?.currency ?? 'KES'}
            onComplete={() => {
              // After a completed intent the user can either reset (return to scan)
              // or stay on the screen to view the result. We keep them here.
            }}
          />
          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <button type="button" onClick={reset} className="text-xs font-semibold text-blue-600 hover:underline">← Start a new payment</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Step({ n, label, active, done }: { n: number; label: string; active?: boolean; done?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${
        done
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
          : active
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-400'
      }`}
    >
      <span className="font-bold">{n}</span>
      <span>{label}</span>
    </span>
  );
}
