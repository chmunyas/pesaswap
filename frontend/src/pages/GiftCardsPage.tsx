import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { showToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { formatCurrency, formatDate } from '../lib/utils';

interface GiftCardRecord {
  giftcard_id: number;
  card_number: string;
  balance: number;
  original_value: number;
  status: 'Active' | 'Used' | 'Expired';
  issue_date: string;
}

interface GiftCardFormState {
  card_number: string;
  value: string;
}

const EMPTY_FORM: GiftCardFormState = {
  card_number: '',
  value: '0',
};

const MOCK_GIFTCARDS: GiftCardRecord[] = [
  { giftcard_id: 1001, card_number: '5589 1122 3344 7788', balance: 45, original_value: 50, status: 'Active', issue_date: '2026-05-28T10:00:00' },
  { giftcard_id: 1002, card_number: '5589 1122 3344 7799', balance: 0, original_value: 25, status: 'Used', issue_date: '2026-05-14T16:20:00' },
  { giftcard_id: 1003, card_number: '5589 1122 3344 7801', balance: 75, original_value: 75, status: 'Active', issue_date: '2026-06-01T09:35:00' },
  { giftcard_id: 1004, card_number: '5589 1122 3344 7812', balance: 12.5, original_value: 30, status: 'Active', issue_date: '2026-04-30T13:45:00' },
  { giftcard_id: 1005, card_number: '5589 1122 3344 7823', balance: 0, original_value: 40, status: 'Expired', issue_date: '2026-03-02T11:10:00' },
  { giftcard_id: 1006, card_number: '5589 1122 3344 7834', balance: 18, original_value: 20, status: 'Active', issue_date: '2026-05-24T15:05:00' },
];

function normalizeGiftCard(raw: Record<string, unknown>): GiftCardRecord {
  const status = String(raw.status ?? 'Active');

  return {
    giftcard_id: Number(raw.giftcard_id ?? raw.id ?? 0),
    card_number: String(raw.card_number ?? '0000 0000 0000 0000'),
    balance: Number(raw.balance ?? raw.value ?? 0),
    original_value: Number(raw.original_value ?? raw.value ?? 0),
    status: status === 'Used' || status === 'Expired' ? status : 'Active',
    issue_date: String(raw.issue_date ?? raw.created_at ?? new Date().toISOString()),
  };
}

function maskCardNumber(cardNumber: string): string {
  return cardNumber.replace(/\d(?=\d{4})/g, '•');
}

export function GiftCardsPage() {
  const [giftCards, setGiftCards] = useState<GiftCardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [usingMockData, setUsingMockData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<GiftCardRecord | null>(null);
  const [form, setForm] = useState<GiftCardFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadGiftCards = async () => {
    try {
      const response = await api.giftcards.list(1, 100);
      const source = Array.isArray(response.data.giftcards)
        ? response.data.giftcards
        : Array.isArray(response.data.data)
          ? response.data.data
          : Array.isArray(response.data)
            ? response.data
            : [];
      const payload = source.filter((card): card is Record<string, unknown> => typeof card === 'object' && card !== null);

      if (payload.length > 0) {
        setGiftCards(payload.map(normalizeGiftCard));
        setUsingMockData(false);
      } else {
        setGiftCards(MOCK_GIFTCARDS);
        setUsingMockData(true);
      }
    } catch {
      setGiftCards(MOCK_GIFTCARDS);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGiftCards();
  }, []);

  const filteredCards = useMemo(() => {
    const query = search.toLowerCase();

    return giftCards.filter((card) => {
      const matchesSearch = card.card_number.toLowerCase().includes(query);
      const matchesStatus = status === 'all' || card.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [giftCards, search, status]);

  const stats = useMemo(() => {
    const activeCards = giftCards.filter((card) => card.status === 'Active');
    const usedThisMonth = giftCards.filter((card) => card.status === 'Used').length;

    return {
      totalActive: activeCards.length,
      totalOutstanding: activeCards.reduce((total, card) => total + card.balance, 0),
      usedThisMonth,
    };
  }, [giftCards]);

  const handleFormChange = (name: string, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async () => {
    if (!form.card_number.trim()) {
      showToast('Card number is required', 'error');
      return;
    }

    const payload = {
      giftcard_number: form.card_number.trim(),
      value: Number(form.value) || 0,
    };

    setSubmitting(true);

    try {
      if (usingMockData) {
        setGiftCards((current) => [{ giftcard_id: Math.max(0, ...current.map((card) => card.giftcard_id)) + 1, balance: payload.value, original_value: payload.value, status: 'Active', issue_date: new Date().toISOString(), card_number: form.card_number.trim() }, ...current]);
        showToast('Gift card issued locally');
      } else {
        await api.giftcards.create(payload);
        await loadGiftCards();
        showToast('Gift card issued successfully');
      }

      setForm(EMPTY_FORM);
      setIsModalOpen(false);
    } catch {
      showToast('Failed to issue gift card', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!cardToDelete) return;

    setSubmitting(true);

    try {
      if (usingMockData) {
        setGiftCards((current) => current.filter((card) => card.giftcard_id !== cardToDelete.giftcard_id));
        showToast('Gift card deactivated locally');
      } else {
        await api.giftcards.delete(cardToDelete.giftcard_id);
        await loadGiftCards();
        showToast('Gift card deactivated successfully');
      }

      setCardToDelete(null);
    } catch {
      showToast('Failed to deactivate gift card', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gift Cards</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Track balances, newly issued cards, and redemption performance.</p>
        </div>
        <button type="button" onClick={() => setIsModalOpen(true)} className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
          <Plus className="h-4 w-4" />
          Issue Card
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Total Active</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{stats.totalActive}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Value Outstanding</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{formatCurrency(stats.totalOutstanding)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">Cards Used This Month</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{stats.usedThisMonth}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_minmax(180px,240px)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by card number..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">All status</option>
            <option value="Active">Active</option>
            <option value="Used">Used</option>
            <option value="Expired">Expired</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredCards.map((card) => (
            <div key={card.giftcard_id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-xl bg-blue-500/10 p-3 text-blue-500">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${card.status === 'Active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : card.status === 'Used' ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>
                    {card.status}
                  </span>
                  <button type="button" onClick={() => setCardToDelete(card)} className="rounded-lg p-2 text-gray-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-xs uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">Card number</p>
                <p className="mt-2 font-mono text-lg font-semibold text-gray-900 dark:text-white">{maskCardNumber(card.card_number)}</p>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/60">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Balance</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(card.balance)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-900/60">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Original value</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(card.original_value)}</p>
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
                <span>Issued</span>
                <span className="font-medium text-gray-900 dark:text-white">{formatDate(card.issue_date)}</span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Wallet className="h-4 w-4 text-blue-500" />
                {usingMockData ? 'Demo data mode enabled.' : 'Ready for POS redemption and balance checks.'}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Issue Card" size="md">
        <div className="space-y-4">
          <FormField label="Card Number" name="card_number" value={form.card_number} onChange={handleFormChange} required />
          <FormField label="Value" name="value" value={form.value} onChange={handleFormChange} type="number" required />
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-70">
              {submitting ? 'Saving...' : 'Issue Card'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={cardToDelete !== null} onClose={() => setCardToDelete(null)} title="Deactivate Gift Card" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Deactivate gift card <span className="font-semibold text-gray-900 dark:text-white">{cardToDelete?.card_number}</span>?</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setCardToDelete(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleDelete} disabled={submitting} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600 disabled:opacity-70">
              {submitting ? 'Deactivating...' : 'Deactivate'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
