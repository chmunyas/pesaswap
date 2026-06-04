/**
 * PWA service-worker registration + cache management.
 *
 * Why manual registration (instead of vite-plugin-pwa's auto):
 *   - We use registerType: 'prompt' so the user (likely a busy waiter or
 *     cashier mid-shift) gets to choose WHEN the new version activates,
 *     instead of the SW silently swapping under them.
 *   - We expose tiny event bus hooks the UpdatePrompt/OfflineIndicator
 *     components subscribe to, so we don't need workbox-window in those
 *     UI components.
 *   - We expose clearAuthenticatedCaches() so the auth code can purge
 *     dashboard / user-specific data on logout (rubber-duck blocker #2).
 */

import { registerSW } from 'virtual:pwa-register';

type SwState = {
  needRefresh: boolean;
  offlineReady: boolean;
  /** Call to swap to the new SW (page reloads). */
  update: (() => Promise<void>) | null;
};

const listeners = new Set<(state: SwState) => void>();
let currentState: SwState = { needRefresh: false, offlineReady: false, update: null };

function publish(next: Partial<SwState>): void {
  currentState = { ...currentState, ...next };
  listeners.forEach((l) => l(currentState));
}

export function getPwaState(): SwState {
  return currentState;
}

export function subscribePwa(listener: (state: SwState) => void): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => listeners.delete(listener);
}

/**
 * Cache names — keep in sync with vite.config.ts workbox.runtimeCaching.
 * Listing them here means we can purge authenticated caches without
 * importing workbox-window into the app bundle.
 */
const AUTH_SCOPED_CACHES = ['pesaswap-dashboard'];

/**
 * Purge caches that hold user-scoped data. Call on logout to prevent the
 * next user on this device from briefly seeing the previous user's
 * dashboard etc.
 */
export async function clearAuthenticatedCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => AUTH_SCOPED_CACHES.some((scoped) => n.includes(scoped)))
        .map((n) => caches.delete(n)),
    );
  } catch (err) {
    // Cache deletion is best-effort; never block logout.
    console.warn('[pwa] cache purge failed:', err);
  }
}

let registered = false;

export function initPwa(): void {
  if (registered) return;
  registered = true;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      publish({
        needRefresh: true,
        update: async () => {
          await updateSW(true);
        },
      });
    },
    onOfflineReady() {
      publish({ offlineReady: true });
    },
    onRegisterError(err) {
      console.warn('[pwa] SW registration failed:', err);
    },
  });
}
