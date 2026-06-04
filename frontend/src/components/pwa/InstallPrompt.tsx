/**
 * InstallPrompt — dismissible bottom banner suggesting the user install
 * the PWA. Two modes:
 *
 *   1. Android / Chromium: native `beforeinstallprompt` event captured;
 *      "Install" button calls prompt().
 *   2. iOS Safari: no native prompt; we show "Tap Share -> Add to Home
 *      Screen" instructions when the device is iOS and the app is not
 *      already in standalone mode.
 *
 * Dismissal is persisted (per-device) so the banner doesn't nag.
 */

import { useEffect, useState } from 'react';
import { Download, Plus, Share, X } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'pesaswap.pwa.installDismissed';
const DISMISS_TTL_DAYS = 14;

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window);
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari uses a non-standard `navigator.standalone`
  const iosNav = navigator as Navigator & { standalone?: boolean };
  return Boolean(iosNav.standalone);
}

function isDismissed(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) return false;
    const ageDays = (Date.now() - at) / (1000 * 60 * 60 * 24);
    return ageDays < DISMISS_TTL_DAYS;
  } catch {
    return false;
  }
}

function recordDismissal(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIos, setShowIos] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isStandalone() || isDismissed()) {
      setHidden(true);
      return;
    }

    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferred(null);
      setShowIos(false);
      setHidden(true);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // For iOS we surface manual instructions instead.
    if (isIosSafari()) {
      // Slight delay so we don't fight the page's initial paint.
      const t = window.setTimeout(() => setShowIos(true), 4000);
      return () => {
        window.clearTimeout(t);
        window.removeEventListener('beforeinstallprompt', onBeforeInstall);
        window.removeEventListener('appinstalled', onInstalled);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden) return null;
  if (!deferred && !showIos) return null;

  function dismiss() {
    recordDismissal();
    setHidden(true);
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } finally {
      setDeferred(null);
      recordDismissal();
    }
  }

  return (
    <div
      role="region"
      aria-label="Install PESASWAP"
      className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-emerald-500/40 bg-gray-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-gray-950">
        <Download className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        {deferred ? (
          <>
            <p className="text-sm font-bold">Install PESASWAP</p>
            <p className="text-[11px] text-gray-300">
              Add to your home screen for faster access and offline support.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold">Add to Home Screen</p>
            <p className="flex items-center gap-1 text-[11px] text-gray-300">
              Tap <Share className="inline h-3 w-3" /> in Safari, then{' '}
              <span className="inline-flex items-center gap-0.5 font-semibold">
                <Plus className="h-3 w-3" /> Add to Home Screen
              </span>
              .
            </p>
          </>
        )}
      </div>
      {deferred && (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-gray-950 hover:bg-emerald-400"
        >
          Install
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
