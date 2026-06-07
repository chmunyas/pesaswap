/**
 * BulkImportModal — single reusable component for all 9 entity bulk
 * imports. Same shape regardless of which entity it's wrapping.
 *
 * 3-stage flow:
 *   1. INPUT  — paste JSON / paste CSV / download template
 *   2. PREVIEW — first 10 parsed rows + dry-run validation
 *   3. RESULT — final summary card with imported / skipped / failed
 *              counts + downloadable error report
 *
 * The modal is dumb about the entity — caller provides:
 *   - `endpoint`  e.g. '/api/items/bulk'
 *   - `entityLabel` e.g. 'items'
 *   - `templateColumns` CSV header for the downloadable template
 *   - `sampleRow` JSON example for the paste-JSON tab
 *
 * The component handles CSV → JSON parsing, dry-run preview, the live
 * import, and renders the standard BulkImportLib response envelope.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  Upload,
  X as XIcon,
} from 'lucide-react';

type Stage = 'input' | 'preview' | 'result';
type Tab = 'paste-csv' | 'paste-json' | 'upload';

export interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  endpoint: string;
  entityLabel: string;
  templateColumns: string[];
  sampleRow: Record<string, unknown>;
  wrapBody?: (rows: Record<string, unknown>[]) => Record<string, unknown>;
  onDone?: () => void | Promise<void>;
}

interface ImportResult {
  import_id: number;
  entity: string;
  dry_run: boolean;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  rolled_back: boolean;
  hard_error: string | null;
  errors: { index: number; key?: string; message: string }[];
  results: { index: number; status: string; key: string; reason?: string; message?: string }[];
  imported_keys: string[];
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQ = false; }
        else cur += ch;
      } else {
        if (ch === ',') { out.push(cur); cur = ''; }
        else if (ch === '"' && cur === '') { inQ = true; }
        else cur += ch;
      }
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cells = parseLine(l);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
  return { headers, rows };
}

function coerceRow(row: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === '') continue;
    const n = Number(v);
    out[k] = !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v) ? n : v;
  }
  return out;
}

export function BulkImportModal({
  isOpen, onClose, endpoint, entityLabel, templateColumns, sampleRow, wrapBody, onDone,
}: BulkImportModalProps) {
  const [stage, setStage] = useState<Stage>('input');
  const [tab, setTab] = useState<Tab>('paste-csv');
  const [csvText, setCsvText] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [skipOnError, setSkipOnError] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setStage('input'); setTab('paste-csv'); setCsvText(''); setJsonText('');
      setBusy(false); setParseError(null); setParsedRows([]);
      setDryRun(true); setSkipOnError(true); setResult(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, busy, onClose]);

  function buildTemplateCsv(): string {
    const sampleValues = templateColumns.map((c) => {
      const v = sampleRow[c];
      if (v === undefined || v === null) return '';
      if (typeof v === 'string' && v.includes(',')) return `"${v.replace(/"/g, '""')}"`;
      return String(v);
    });
    return templateColumns.join(',') + '\n' + sampleValues.join(',') + '\n';
  }

  function downloadTemplate() {
    const csv = buildTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${entityLabel}-template.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  async function onFileUpload(file: File) {
    const text = await file.text();
    if (file.name.endsWith('.json')) { setJsonText(text); setTab('paste-json'); }
    else { setCsvText(text); setTab('paste-csv'); }
  }

  function parseAndPreview() {
    setParseError(null);
    setParsedRows([]);
    try {
      let rows: Record<string, unknown>[] = [];
      if (tab === 'paste-json') {
        const data = JSON.parse(jsonText);
        if (!Array.isArray(data)) throw new Error('JSON must be an array of objects');
        rows = data;
      } else {
        const { rows: parsed } = parseCsv(csvText);
        if (parsed.length === 0) throw new Error('No rows parsed from CSV');
        rows = parsed.map(coerceRow);
      }
      if (rows.length === 0) throw new Error('No rows to import');
      if (rows.length > 500) throw new Error(`Batch limit is 500 rows; got ${rows.length}`);
      setParsedRows(rows);
      setStage('preview');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Parse failed');
    }
  }

  async function runImport() {
    setBusy(true);
    setParseError(null);
    try {
      const body = wrapBody
        ? { ...wrapBody(parsedRows), dry_run: dryRun, skip_on_error: skipOnError }
        : { dry_run: dryRun, skip_on_error: skipOnError, rows: parsedRows };
      const r = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!j?.success) {
        setParseError(j?.message ?? 'Import failed');
        return;
      }
      setResult(j.data as ImportResult);
      setStage('result');
      if (!dryRun) { await onDone?.(); }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    if (!result) return;
    const rows = [['index', 'key', 'message'], ...result.errors.map((e) => [String(e.index), e.key ?? '', e.message])];
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `bulk-import-${result.import_id || 'errors'}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  const previewCols = useMemo(() => parsedRows.length === 0 ? [] : Object.keys(parsedRows[0]), [parsedRows]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3 sm:items-center"
      role="dialog"
      aria-label={`Bulk import ${entityLabel}`}
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900 max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-500" />
            <h2 className="text-base font-bold text-gray-900 dark:text-white">Bulk import — {entityLabel}</h2>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {stage === 'input' && (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-lg bg-gray-100 p-1 text-xs dark:bg-gray-800">
              {([
                ['paste-csv', 'Paste CSV'],
                ['paste-json', 'Paste JSON'],
                ['upload', 'Upload file'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`flex-1 rounded-md px-3 py-1.5 font-semibold transition ${
                    tab === id ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === 'paste-csv' && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">CSV — first row is headers</p>
                  <button
                    type="button"
                    onClick={downloadTemplate}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                  >
                    <Download className="h-3 w-3" /> Download template
                  </button>
                </div>
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  rows={10}
                  placeholder={templateColumns.join(',') + '\n' + templateColumns.map(() => 'value').join(',')}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
                <p className="mt-2 text-[10px] text-gray-500">Required columns: <span className="font-mono">{templateColumns.join(', ')}</span></p>
              </div>
            )}

            {tab === 'paste-json' && (
              <div>
                <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-gray-500">JSON — array of objects</p>
                <textarea
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  rows={10}
                  placeholder={JSON.stringify([sampleRow], null, 2)}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </div>
            )}

            {tab === 'upload' && (
              <label className="block rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-700 dark:hover:bg-blue-900/20">
                <Upload className="mx-auto h-8 w-8 text-gray-400" />
                <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Drop a CSV or JSON file here</p>
                <p className="text-[10px] text-gray-500">.csv or .json (max 500 rows)</p>
                <input
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFileUpload(f); }}
                />
              </label>
            )}

            {parseError && (
              <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{parseError}</span>
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
              <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
              <button type="button" onClick={parseAndPreview} disabled={(tab === 'paste-csv' && !csvText.trim()) || (tab === 'paste-json' && !jsonText.trim())} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                Preview <ArrowRight className="inline h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {stage === 'preview' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              <strong>{parsedRows.length}</strong> rows parsed. Showing first 10 for review.
            </p>

            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    {previewCols.map((c) => (
                      <th key={c} className="px-2 py-1.5 text-left font-mono text-[10px] uppercase text-gray-500">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.slice(0, 10).map((row, i) => (
                    <tr key={i} className="border-t border-gray-100 dark:border-gray-800">
                      {previewCols.map((c) => (
                        <td key={c} className="px-2 py-1.5 text-gray-700 dark:text-gray-300">{String(row[c] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {parsedRows.length > 10 && (
              <p className="text-[11px] text-gray-500">… {parsedRows.length - 10} more rows not shown.</p>
            )}

            <div className="flex flex-wrap gap-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900 dark:bg-amber-900/20">
              <label className="inline-flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="h-4 w-4 rounded border-amber-300 text-amber-600" />
                <span><strong>Dry run</strong> — validate without writing</span>
              </label>
              <label className="inline-flex items-center gap-2 text-amber-800 dark:text-amber-200">
                <input type="checkbox" checked={skipOnError} onChange={(e) => setSkipOnError(e.target.checked)} className="h-4 w-4 rounded border-amber-300 text-amber-600" />
                <span><strong>Skip on error</strong> — partial success allowed</span>
              </label>
            </div>

            {parseError && (
              <p className="flex items-start gap-1 text-xs font-semibold text-rose-600">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{parseError}</span>
              </p>
            )}

            <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
              <button type="button" onClick={() => setStage('input')} disabled={busy} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">← Back</button>
              <button type="button" onClick={runImport} disabled={busy} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">
                {busy ? 'Running…' : dryRun ? 'Run dry-run' : 'Import for real'}
              </button>
            </div>
          </div>
        )}

        {stage === 'result' && result && (
          <div className="space-y-4">
            <div className={`rounded-2xl border p-5 text-center ${
              result.failed === 0 && !result.rolled_back
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-900/30'
                : result.rolled_back
                  ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-900/30'
                  : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-900/30'
            }`}>
              <CheckCircle2 className={`mx-auto h-10 w-10 ${
                result.failed === 0 && !result.rolled_back ? 'text-emerald-500' :
                result.rolled_back ? 'text-rose-500' : 'text-amber-500'
              }`} />
              <p className="mt-3 text-sm font-bold text-gray-900 dark:text-white">
                {result.dry_run ? 'Dry run complete' : 'Import complete'}
              </p>
              {result.rolled_back && (
                <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">⚠ Rolled back — first error: {result.hard_error}</p>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3 text-center">
              {[
                ['Total',    result.total,    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'],
                ['Imported', result.imported, 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'],
                ['Skipped',  result.skipped,  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'],
                ['Failed',   result.failed,   'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200'],
              ].map(([label, n, cls]) => (
                <div key={label as string} className={`rounded-lg p-3 ${cls}`}>
                  <p className="text-[10px] font-mono uppercase tracking-widest opacity-80">{label}</p>
                  <p className="mt-1 text-xl font-bold font-mono">{n as number}</p>
                </div>
              ))}
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-900/20">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    Errors ({result.errors.length}{result.errors.length === 100 ? '+' : ''})
                  </p>
                  <button type="button" onClick={downloadErrors} className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 hover:text-rose-900">
                    <Download className="h-3 w-3" /> Download CSV
                  </button>
                </div>
                <ul className="mt-2 max-h-32 overflow-auto text-[11px] text-rose-700 dark:text-rose-300">
                  {result.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>• row {e.index}: {e.key && <span className="font-mono">{e.key} — </span>}{e.message}</li>
                  ))}
                  {result.errors.length > 5 && <li className="opacity-70">… download CSV for the full list</li>}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-gray-500">
              Audit id: <span className="font-mono">{result.import_id || '—'}</span>
              {' · '}
              Entity: <span className="font-mono">{result.entity}</span>
            </p>

            <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
              {result.dry_run && (
                <button type="button" onClick={() => { setDryRun(false); setStage('preview'); }} className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-900/30 dark:text-blue-200">
                  Import for real →
                </button>
              )}
              <button type="button" onClick={onClose} className="rounded-lg bg-gray-900 px-5 py-2 text-sm font-bold text-white dark:bg-white dark:text-gray-900">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
