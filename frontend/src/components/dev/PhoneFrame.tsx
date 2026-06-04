/**
 * PhoneFrame — wraps children in a phone-shaped chrome for desktop demos.
 *
 * Pattern stolen from chmunyas/merchantApp's PhoneFrame.tsx (705 bytes).
 * Rewritten to plain Tailwind (no shadcn semantic tokens) and made size-tunable.
 */

import type { ReactNode } from 'react';

interface PhoneFrameProps {
  children: ReactNode;
  label?: string;
  width?: number;
  height?: number;
}

export function PhoneFrame({
  children,
  label = 'PESASWAP · iOS / Android',
  width = 390,
  height = 780,
}: PhoneFrameProps) {
  return (
    <div className="mx-auto" style={{ width }}>
      <div className="relative rounded-[3rem] border border-gray-200 bg-gray-900 p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-700">
        <div
          className="relative overflow-hidden rounded-[2.4rem] bg-white dark:bg-gray-950"
          style={{ height }}
        >
          {/* Notch */}
          <div
            aria-hidden
            className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-900 rounded-b-2xl z-30 dark:bg-gray-700"
          />
          <div className="h-full w-full overflow-auto">{children}</div>
        </div>
      </div>
      <p className="text-center mt-4 text-[10px] font-mono uppercase tracking-widest text-gray-500">
        {label}
      </p>
    </div>
  );
}
