/**
 * UpdatePrompt — toast shown when a new service-worker version is ready.
 *
 * Per rubber-duck blocker #4: with registerType: 'prompt', the new SW
 * stays in the "waiting" state until the user opts in. We surface a
 * subtle bottom-right toast so a busy POS/KDS shift isn't disrupted,
 * but the user can update at a clean moment between transactions.
 */

import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { subscribePwa } from '../../lib/pwa';

export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return subscribePwa((s) => {
      setNeedRefresh(s.needRefresh);
      setUpdate(() => s.update);
    });
  }, []);

  if (!needRefresh || !update) return null;

  async function go() {
    if (!update) return;
    setBusy(true);
    try {
      await update();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-label="App update available"
      className="fixed bottom-3 right-3 z-[100] flex max-w-xs items-center gap-3 rounded-2xl border border-blue-500/40 bg-gray-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white">
        <RefreshCw className={`h-5 w-5 ${busy ? 'animate-spin' : ''}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">Update available</p>
        <p className="text-[11px] text-gray-300">A new version of PESASWAP is ready.</p>
      </div>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="shrink-0 rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-400 disabled:opacity-60"
      >
        {busy ? 'Updating…' : 'Reload'}
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        aria-label="Dismiss update notification"
        className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
