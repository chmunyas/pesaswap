/**
 * Walkout risk detection for table service.
 *
 * Concept stolen from chmunyas/merchantApp's TableServiceView walkout detection
 * (lines ~500-510 of features/TableServiceView.tsx): tables open > N minutes
 * with no payment recorded are flagged as "walkout risk".
 *
 * v1 scope:
 *   - LocalStorage-persisted demo tables (no backend yet — OSPOS dinner_tables
 *     doesn't track open-table state at the row level the way we need).
 *   - Pure functions for risk evaluation + alert tracking.
 *   - Alert-once semantics: a table that has already triggered an alert
 *     (key: `id|openedAt`) does not re-alert until openedAt changes.
 *   - Manual "Mark resolved" persists in a separate resolved-set; resolved
 *     tables are excluded from the risk list until either openedAt changes
 *     (new sitting) or the user clears the resolution.
 */

const TABLES_KEY = 'pesaswap.walkout.tables';
const ALERTED_KEY = 'pesaswap.walkout.alerted';
const RESOLVED_KEY = 'pesaswap.walkout.resolved';

export const DEFAULT_WALKOUT_MINUTES = 120;

export interface OpenTable {
  id: string;
  tableNumber: string;
  openedAt: string;
  paidAmount: number;
  outstanding: number;
  partySize: number;
  server?: string;
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private-mode — ignore */
  }
}

/** Build a deterministic alert key. Resets when openedAt changes (new sitting). */
export function alertKey(table: Pick<OpenTable, 'id' | 'openedAt'>): string {
  return `${table.id}|${table.openedAt}`;
}

export function getOpenTables(): OpenTable[] {
  let tables = readJson<OpenTable[]>(TABLES_KEY, []);
  if (tables.length === 0) {
    // First load — seed a small demo set with a deliberate walkout risk
    const now = Date.now();
    tables = [
      { id: 't-1', tableNumber: '3',  openedAt: new Date(now - 35  * 60_000).toISOString(), paidAmount: 0,    outstanding: 1850, partySize: 2, server: 'Akinyi' },
      { id: 't-2', tableNumber: '7',  openedAt: new Date(now - 145 * 60_000).toISOString(), paidAmount: 0,    outstanding: 4720, partySize: 4, server: 'Brian'  },
      { id: 't-3', tableNumber: '11', openedAt: new Date(now - 170 * 60_000).toISOString(), paidAmount: 0,    outstanding: 6280, partySize: 6, server: 'Akinyi' },
      { id: 't-4', tableNumber: '5',  openedAt: new Date(now - 95  * 60_000).toISOString(), paidAmount: 1200, outstanding: 320,  partySize: 2, server: 'Caroline' },
    ];
    writeJson(TABLES_KEY, tables);
  }
  return tables;
}

export function setOpenTables(next: OpenTable[]): void {
  writeJson(TABLES_KEY, next);
}

export function getAlertedKeys(): Set<string> {
  return new Set(readJson<string[]>(ALERTED_KEY, []));
}

export function markAlerted(keys: string[]): void {
  const current = getAlertedKeys();
  for (const k of keys) current.add(k);
  writeJson(ALERTED_KEY, Array.from(current));
}

export function getResolvedKeys(): Set<string> {
  return new Set(readJson<string[]>(RESOLVED_KEY, []));
}

export function markResolved(table: OpenTable): void {
  const current = getResolvedKeys();
  current.add(alertKey(table));
  writeJson(RESOLVED_KEY, Array.from(current));
}

/** Pure risk evaluator. */
export function isWalkoutRisk(
  table: OpenTable,
  thresholdMinutes = DEFAULT_WALKOUT_MINUTES,
): boolean {
  if (table.outstanding <= 0) return false;
  const elapsedMin = (Date.now() - new Date(table.openedAt).getTime()) / 60_000;
  return elapsedMin >= thresholdMinutes && table.paidAmount === 0;
}

export function minutesOpen(table: Pick<OpenTable, 'openedAt'>): number {
  return Math.max(0, Math.floor((Date.now() - new Date(table.openedAt).getTime()) / 60_000));
}

export function evaluateRisk(
  tables: OpenTable[],
  thresholdMinutes = DEFAULT_WALKOUT_MINUTES,
): { atRisk: OpenTable[]; newRiskKeys: string[] } {
  const resolved = getResolvedKeys();
  const alerted = getAlertedKeys();

  const atRisk = tables.filter(
    (t) => isWalkoutRisk(t, thresholdMinutes) && !resolved.has(alertKey(t)),
  );

  const newRiskKeys = atRisk
    .map(alertKey)
    .filter((k) => !alerted.has(k));

  return { atRisk, newRiskKeys };
}

/** Demo helper — add a fresh long-seated table so the user can see the alert fire live. */
export function addDemoWalkoutTable(): OpenTable {
  const existing = getOpenTables();
  const num = String(Math.floor(Math.random() * 90) + 10);
  const minutesAgo = DEFAULT_WALKOUT_MINUTES + 5 + Math.floor(Math.random() * 30);
  const table: OpenTable = {
    id: `t-demo-${Date.now()}`,
    tableNumber: num,
    openedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    paidAmount: 0,
    outstanding: 500 + Math.floor(Math.random() * 6000),
    partySize: 2 + Math.floor(Math.random() * 6),
    server: 'Demo',
  };
  setOpenTables([...existing, table]);
  return table;
}
