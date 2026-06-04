/**
 * PreviewPage — desktop preview of any public mobile route inside a phone frame.
 *
 * Usage:
 *   /preview/pay         -> wraps /pay (Tap & Go)
 *   /preview/menu/5      -> wraps /menu/5 (customer menu)
 *   /preview/t/3         -> wraps /t/3 (table bill)
 *   /preview/reset-pin   -> wraps /reset-pin
 *
 * For demos on desktop. Uses an iframe (cheapest, most accurate) so the
 * embedded page renders exactly as a phone would receive it, including
 * BroadcastChannel/router behaviour.
 *
 * This route is PUBLIC (mounted outside <ProtectedRoutes>) because the
 * pages it previews are themselves public.
 */

import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ExternalLink, RotateCcw, Smartphone } from 'lucide-react';
import { PhoneFrame } from '../components/dev/PhoneFrame';

const PRESETS: Array<{ path: string; label: string }> = [
  { path: '/pay', label: 'Tap & Go (no QR)' },
  { path: '/menu/5', label: 'Menu — Table 5' },
  { path: '/t/3', label: 'Bill — Table 3' },
  { path: '/reset-pin', label: 'Reset PIN' },
];

export function PreviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [reloadToken, setReloadToken] = useState(0);

  // /preview/...  -> previewing "/..."
  const previewPath = location.pathname.replace(/^\/preview/, '') || '/pay';

  // Force the iframe to remount when the user clicks a preset (same URL → new key)
  useEffect(() => {
    setReloadToken((n) => n + 1);
  }, [previewPath]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link
              to="/"
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <ChevronLeft className="h-3 w-3" />
              Back to dashboard
            </Link>
            <div className="mt-2 flex items-center gap-2">
              <Smartphone className="h-6 w-6 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Mobile preview</h1>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Inspect public mobile pages inside a phone-shaped frame on desktop.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadToken((n) => n + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reload frame
            </button>
            <a
              href={previewPath}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in new tab
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,440px)_1fr]">
          {/* Left: presets + URL entry */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-xs font-mono uppercase tracking-widest text-gray-500">
                Preset routes
              </h2>
              <div className="mt-3 space-y-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.path}
                    type="button"
                    onClick={() => navigate(`/preview${p.path}`)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition ${
                      previewPath === p.path
                        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span>{p.label}</span>
                    <code className="font-mono text-[10px] text-gray-400">{p.path}</code>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-xs font-mono uppercase tracking-widest text-gray-500">
                Currently previewing
              </h2>
              <code className="mt-2 block break-all rounded-lg bg-gray-100 px-3 py-2 font-mono text-xs text-gray-800 dark:bg-gray-900 dark:text-gray-200">
                {previewPath}
              </code>
              <p className="mt-3 text-[10px] text-gray-500">
                Tip: edit the URL to <code>/preview/menu/12</code> for a different table.
              </p>
            </div>
          </div>

          {/* Center: phone frame */}
          <div>
            <PhoneFrame width={390} height={780} label={`PESASWAP · ${previewPath}`}>
              <iframe
                key={reloadToken}
                src={previewPath}
                title="Mobile preview"
                className="h-full w-full border-0"
                allow="clipboard-read; clipboard-write"
              />
            </PhoneFrame>
          </div>

          {/* Right: notes */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <h2 className="text-xs font-mono uppercase tracking-widest text-gray-500">
                Notes
              </h2>
              <ul className="mt-3 space-y-2 text-xs text-gray-600 dark:text-gray-300">
                <li>• Frame is 390×780 — iPhone 14 Pro at 1× scale.</li>
                <li>• Iframe re-mounts on preset click for clean state.</li>
                <li>• Cross-tab BroadcastChannel still works between the iframe and any /kds tab.</li>
                <li>• Only public routes work here (no auth handshake inside the iframe).</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
