/**
 * OfflineIndicator — slim banner shown when navigator reports we're offline.
 *
 * Per rubber-duck #6: `navigator.onLine` is necessary but not sufficient
 * for "backend reachable". This component only reflects the navigator
 * state; individual pages should surface their own "Last updated …"
 * staleness markers for cached data.
 */

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineIndicator() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function go() {
      setOnline(navigator.onLine);
    }
    window.addEventListener('online', go);
    window.addEventListener('offline', go);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('offline', go);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[110] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-xs font-semibold text-amber-950 shadow-md"
    >
      <WifiOff className="h-3.5 w-3.5" />
      You're offline — showing cached data. Live updates resume when reconnected.
    </div>
  );
}
