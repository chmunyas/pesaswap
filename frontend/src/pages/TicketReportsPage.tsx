/**
 * TicketReportsPage — Phase 5 ticket reports.
 *
 * 3 tabs: Sales (daily issuance grouped by product), Redemptions (scan
 * velocity + result histogram), No-shows (sold but never scanned).
 */

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { api } from '../lib/api';

type Tab = 'sales' | 'redemptions' | 'noshows';

interface SalesRow extends Record<string, string> { ticket_product_id: string; title: string; subtype: string; day: string; issued_count: string; }
interface RedemptionRow { result: string; count: string; }
interface HourRow { hour: string; ok: string; total: string; }
interface NoShowRow extends Record<string, string> { ticket_product_id: string; title: string; subtype: string; no_shows: string; redeemed: string; total: string; }

const TODAY = new Date().toISOString().slice(0, 10);
const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 86400 * 1000).toISOString().slice(0, 10);

export function TicketReportsPage() {
  const [tab, setTab] = useState<Tab>('sales');
  const [from, setFrom] = useState(THIRTY_DAYS_AGO);
  const [to, setTo] = useState(TODAY);
  const [salesRows, setSalesRows] = useState<SalesRow[]>([]);
  const [redResult, setRedResult] = useState<RedemptionRow[]>([]);
  const [redHour, setRedHour] = useState<HourRow[]>([]);
  const [noShows, setNoShows] = useState<NoShowRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      if (tab === 'sales') {
        const res = await api.tickets.reports.sales(from + ' 00:00:00', to + ' 23:59:59');
        setSalesRows((res.data?.rows as unknown as SalesRow[]) ?? []);
      } else if (tab === 'redemptions') {
        const fr = tab === 'redemptions' ? SEVEN_DAYS_AGO : from;
        const res = await api.tickets.reports.redemptions(fr + ' 00:00:00', to + ' 23:59:59');
        setRedResult((res.data?.by_result as unknown as RedemptionRow[]) ?? []);
        setRedHour((res.data?.by_hour as unknown as HourRow[]) ?? []);
      } else {
        const res = await api.tickets.reports.noShows();
        setNoShows((res.data?.rows as unknown as NoShowRow[]) ?? []);
      }
    } catch {
      // ignore — render empty
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [tab, from, to]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-fuchsia-600" />
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ticket Reports</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['sales', 'redemptions', 'noshows'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${tab === t ? 'bg-fuchsia-600 text-white' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
          >
            {t === 'noshows' ? 'No-shows' : t}
          </button>
        ))}
        {tab !== 'noshows' && (
          <>
            <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
            <input value={to} onChange={(e) => setTo(e.target.value)} type="date" className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" />
          </>
        )}
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-fuchsia-500" /></div>
      ) : tab === 'sales' ? (
        <ReportTable rows={salesRows} cols={['day', 'title', 'subtype', 'issued_count']} headers={['Day', 'Product', 'Subtype', 'Issued']} />
      ) : tab === 'redemptions' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-sm font-bold mb-2 text-gray-900 dark:text-white">By result</h3>
            <ul className="space-y-1 text-xs">
              {redResult.map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400">{r.result}</span>
                  <strong className="text-gray-900 dark:text-white">{r.count}</strong>
                </li>
              ))}
              {redResult.length === 0 && <li className="text-gray-500 text-xs">No redemptions in window.</li>}
            </ul>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <h3 className="text-sm font-bold mb-2 text-gray-900 dark:text-white">By hour</h3>
            <ul className="space-y-1 text-xs">
              {redHour.slice(-24).map((r, i) => (
                <li key={i} className="flex justify-between">
                  <span className="text-gray-600 dark:text-gray-400 font-mono">{r.hour.slice(11, 16)}</span>
                  <strong className="text-gray-900 dark:text-white">{r.ok} / {r.total}</strong>
                </li>
              ))}
              {redHour.length === 0 && <li className="text-gray-500 text-xs">No redemptions.</li>}
            </ul>
          </div>
        </div>
      ) : (
        <ReportTable rows={noShows} cols={['title', 'subtype', 'redeemed', 'no_shows', 'total']} headers={['Product', 'Subtype', 'Redeemed', 'No-show', 'Total']} />
      )}
    </div>
  );
}

function ReportTable<T extends Record<string, string>>({ rows, cols, headers }: { rows: T[]; cols: string[]; headers: string[] }) {
  if (rows.length === 0) {
    return <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/40">No data in window.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-900/40">
          <tr>
            {headers.map((h) => <th key={h} className="px-3 py-2 text-left text-[10px] font-mono uppercase text-gray-500">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c} className="px-3 py-1.5 text-xs">{r[c] ?? '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
