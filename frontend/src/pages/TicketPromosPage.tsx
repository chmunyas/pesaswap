/**
 * TicketPromosPage — Phase 5 admin page for promo-code lifecycle.
 *
 * Lists active promo codes with usage stats, supports create + delete +
 * a dry-run validate panel so operators can sanity-check a code before
 * sharing it.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';

interface Promo {
  code_id: number;
  code: string;
  description: string | null;
  discount_pct: string | null;
  discount_flat: string | null;
  currency: string | null;
  max_uses: number | null;
  used_count: number;
  remaining_uses: number | null;
  starts_at: string | null;
  expires_at: string | null;
  min_amount: string | null;
}

export function TicketPromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [validateCode, setValidateCode] = useState('');
  const [validateAmount, setValidateAmount] = useState('100.00');
  const [validateResult, setValidateResult] = useState<unknown>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await api.tickets.promos.list();
      setPromos((res.data?.promos as unknown as Promo[]) ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Load failed', 'error');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function handleDelete(p: Promo) {
    if (!window.confirm(`Archive promo "${p.code}"?`)) return;
    try {
      await api.tickets.promos.delete(p.code_id);
      showToast('Promo archived');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  async function handleValidate(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api.tickets.promos.validate({ code: validateCode, amount: validateAmount });
      setValidateResult(res.data);
    } catch (err) {
      setValidateResult({ valid: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="h-6 w-6 text-fuchsia-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Promo Codes</h1>
        </div>
        <button type="button" onClick={() => setShowCreate(true)} className="inline-flex items-center gap-1 rounded-lg bg-fuchsia-600 px-3 py-2 text-sm font-bold text-white hover:bg-fuchsia-700">
          <Plus className="h-4 w-4" /> New promo
        </button>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-fuchsia-500" /></div>
      ) : promos.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/40">
          <Tag className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-3 text-sm text-gray-500">No promo codes yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/40">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Code</th>
                <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Discount</th>
                <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Usage</th>
                <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Window</th>
                <th className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">Min spend</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {promos.map((p) => (
                <tr key={p.code_id}>
                  <td className="px-3 py-2 font-mono text-xs">
                    <strong>{p.code}</strong>
                    {p.description && <div className="text-[10px] text-gray-500">{p.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.discount_pct && <span className="font-bold text-emerald-700">{p.discount_pct}%</span>}
                    {p.discount_pct && p.discount_flat && ' + '}
                    {p.discount_flat && <span className="font-bold text-emerald-700">{p.currency ?? ''} {p.discount_flat}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {p.max_uses !== null ? `${p.used_count} / ${p.max_uses}` : `${p.used_count} (∞)`}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-gray-500">
                    {p.starts_at?.slice(0, 16) ?? '—'} → {p.expires_at?.slice(0, 16) ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{p.min_amount ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => handleDelete(p)} className="text-rose-700 hover:text-rose-800">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">Validate (dry run)</h2>
        <p className="text-xs text-gray-500 mt-1">Sanity-check a code + amount without consuming a use.</p>
        <form onSubmit={handleValidate} className="mt-3 flex flex-wrap gap-2">
          <input value={validateCode} onChange={(e) => setValidateCode(e.target.value.toUpperCase())} placeholder="CODE" className="flex-1 min-w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-mono dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={validateAmount} onChange={(e) => setValidateAmount(e.target.value)} placeholder="100.00" className="w-32 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <button type="submit" className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700">Validate</button>
        </form>
        {validateResult !== null && (
          <pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-[11px] dark:bg-gray-900">{JSON.stringify(validateResult, null, 2)}</pre>
        )}
      </div>

      <PromoCreateModal isOpen={showCreate} onClose={() => setShowCreate(false)} onSaved={async () => { setShowCreate(false); await load(); }} />
    </div>
  );
}

function PromoCreateModal({ isOpen, onClose, onSaved }: { isOpen: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [pct, setPct] = useState('');
  const [flat, setFlat] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { code: code.toUpperCase(), description: description || null };
      if (pct) payload.discount_pct = Number(pct);
      if (flat) payload.discount_flat = flat;
      if (maxUses) payload.max_uses = Number(maxUses);
      if (expiresAt) payload.expires_at = expiresAt.replace('T', ' ') + ':00';
      if (minAmount) payload.min_amount = minAmount;
      await api.tickets.promos.create(payload);
      showToast('Promo created');
      setCode(''); setDescription(''); setPct(''); setFlat(''); setMaxUses(''); setExpiresAt(''); setMinAmount('');
      await onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="New promo code" size="md">
      <form onSubmit={handleSubmit} className="space-y-3">
        <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="CODE (e.g. EARLYBIRD20)" pattern="^[A-Z0-9_-]{3,64}$" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-mono dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        <div className="grid gap-2 md:grid-cols-2">
          <input value={pct} onChange={(e) => setPct(e.target.value)} placeholder="% discount (1-100)" type="number" min="1" max="100" step="0.01" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={flat} onChange={(e) => setFlat(e.target.value)} placeholder="Flat discount (e.g. 5.00)" pattern="^\d+(\.\d{1,2})?$" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Max uses (∞)" type="number" min="1" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} placeholder="Expires" type="datetime-local" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          <input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} placeholder="Min spend" pattern="^\d+(\.\d{1,2})?$" className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-gray-700 dark:text-gray-200">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-bold text-white hover:bg-fuchsia-700 disabled:opacity-60">{saving ? 'Saving…' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}
