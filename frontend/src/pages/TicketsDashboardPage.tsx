/**
 * TicketsDashboardPage — Phase 4 live gate-operations dashboard.
 *
 * Polls /api/tickets/dashboard every 5 seconds. Filters by product
 * (and optionally session). Renders big KPIs and a status histogram
 * suitable for projection on a backstage / control-room monitor.
 */

import { useEffect, useMemo, useState } from 'react';
import { Activity, Calendar, CheckCircle2, Clock, RotateCw, Ticket } from 'lucide-react';
import { api } from '../lib/api';

interface DashboardData {
  totals: {
    issued: number;
    active: number;
    redeemed: number;
    refunded: number;
    revoked: number;
    expired: number;
    total: number;
  };
  scans_per_5min: number;
  no_show_estimate: number;
  redemption_rate: number;
  as_of: string;
}

interface Product { ticket_product_id: number; title: string; }
interface Session { session_id: number; label: string | null; starts_at: string; }

export function TicketsDashboardPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [productId, setProductId] = useState(0);
  const [sessionId, setSessionId] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load product list once
  useEffect(() => {
    void (async () => {
      try {
        const res = await api.tickets.products.list(1, 100, '', '');
        setProducts((res.data?.products as unknown as Product[]) ?? []);
      } catch {
        setError('Failed to load products');
      }
    })();
  }, []);

  // Reload session list when product changes
  useEffect(() => {
    setSessionId(0);
    if (productId <= 0) { setSessions([]); return; }
    void (async () => {
      try {
        const res = await api.tickets.products.sessions.list(productId);
        setSessions((res.data?.sessions as unknown as Session[]) ?? []);
      } catch {
        setSessions([]);
      }
    })();
  }, [productId]);

  // Dashboard polling
  useEffect(() => {
    let cancelled = false;
    const fetchOnce = async () => {
      try {
        const res = await api.tickets.dashboard(productId, sessionId);
        if (!cancelled) {
          setData(res.data as unknown as DashboardData);
          setLoading(false);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Dashboard load failed');
          setLoading(false);
        }
      }
    };
    void fetchOnce();
    if (paused) return () => { cancelled = true; };
    const id = window.setInterval(fetchOnce, 5000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [productId, sessionId, paused]);

  const histogram = useMemo(() => {
    if (!data) return [];
    const t = data.totals;
    return [
      { key: 'redeemed', label: 'Redeemed', value: t.redeemed, color: 'bg-emerald-500' },
      { key: 'active',   label: 'Active',   value: t.active,   color: 'bg-blue-500' },
      { key: 'issued',   label: 'Issued',   value: t.issued,   color: 'bg-fuchsia-500' },
      { key: 'refunded', label: 'Refunded', value: t.refunded, color: 'bg-amber-500' },
      { key: 'revoked',  label: 'Revoked',  value: t.revoked,  color: 'bg-rose-500' },
      { key: 'expired',  label: 'Expired',  value: t.expired,  color: 'bg-gray-400' },
    ];
  }, [data]);
  const max = useMemo(() => histogram.reduce((m, h) => Math.max(m, h.value), 1), [histogram]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-fuchsia-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Live Gate Dashboard</h1>
        </div>
        <button type="button" onClick={() => setPaused((p) => !p)} className="inline-flex items-center gap-1 rounded-lg bg-gray-900 text-white px-3 py-1.5 text-xs font-bold">
          {paused ? <><RotateCw className="h-3.5 w-3.5" /> Resume</> : <><Clock className="h-3.5 w-3.5" /> Pause polling</>}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select value={productId} onChange={(e) => setProductId(Number(e.target.value))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
          <option value={0}>All products</option>
          {products.map((p) => <option key={p.ticket_product_id} value={p.ticket_product_id}>{p.title}</option>)}
        </select>
        {sessions.length > 0 && (
          <select value={sessionId} onChange={(e) => setSessionId(Number(e.target.value))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white">
            <option value={0}>All sessions</option>
            {sessions.map((s) => <option key={s.session_id} value={s.session_id}>{(s.label ?? '') + ' ' + s.starts_at}</option>)}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-900/20 dark:text-rose-300">{error}</div>
      )}

      {loading || !data ? (
        <div className="flex h-64 items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-fuchsia-500" /></div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi icon={<Ticket className="h-5 w-5" />} label="Total sold" value={data.totals.total} accent="bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300" />
            <Kpi icon={<CheckCircle2 className="h-5 w-5" />} label="Redeemed" value={data.totals.redeemed} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" />
            <Kpi icon={<Activity className="h-5 w-5" />} label="Scans / 5 min" value={data.scans_per_5min} accent="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" />
            <Kpi icon={<Calendar className="h-5 w-5" />} label="No-show estimate" value={data.no_show_estimate} accent="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" />
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900 dark:text-white">Status histogram</h2>
              <p className="text-xs text-gray-500">Redemption rate: <strong>{data.redemption_rate}%</strong></p>
            </div>
            <div className="mt-4 space-y-2">
              {histogram.map((h) => (
                <div key={h.key} className="flex items-center gap-2">
                  <span className="w-20 text-[11px] uppercase font-semibold text-gray-500">{h.label}</span>
                  <div className="flex-1 h-3 rounded-full bg-gray-100 dark:bg-gray-900 overflow-hidden">
                    <div className={`h-full ${h.color}`} style={{ width: `${(h.value / max) * 100}%` }} />
                  </div>
                  <span className="w-12 text-right text-xs font-bold text-gray-900 dark:text-white">{h.value}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-[10px] text-gray-400">
            Updated {new Date(data.as_of).toLocaleTimeString()} · polling every 5 s {paused && '(paused)'}
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className={`inline-flex items-center justify-center rounded-lg p-2 ${accent}`}>{icon}</div>
      <p className="mt-3 text-[11px] uppercase font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">{value.toLocaleString()}</p>
    </div>
  );
}
