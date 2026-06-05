/**
 * CheckinPage — Phase 4 mobile gate-scanner PWA.
 *
 * Designed for door staff on a phone/tablet at the entrance. Features:
 *   - Camera-based QR scanning using the BarcodeDetector API where
 *     available (Chrome/Edge desktop, Android Chrome). Falls back to a
 *     paste/manual input on iOS Safari + older browsers where
 *     BarcodeDetector is not yet shipped (Safari 18+ has it).
 *   - Offline queue: scans made without connectivity are persisted to
 *     localStorage with their idempotency key and flushed automatically
 *     on `online`. The redeem endpoint's idempotency makes the flush
 *     safe to replay.
 *   - Audible feedback: distinct success (high beep) / failure (low
 *     buzz) tones via a single Web Audio oscillator — no audio asset
 *     to ship.
 *   - Big touch UI: full-screen camera preview + 4rem result banner.
 *
 * Auth: this page expects an authenticated session cookie OR a scanner
 * device JWT in localStorage (`pesaswap.scanner.token`). For Phase 4
 * the JWT path is documented but the page still calls the standard
 * `/api/tickets/redeem` which uses session auth — Phase 5 can extend
 * the endpoint to accept the device JWT as a Bearer header.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, ClipboardPaste, ListChecks, Power, Settings, Volume2, VolumeX, WifiOff, XCircle } from 'lucide-react';
import { api } from '../lib/api';

type ScanOutcome = 'ok' | 'already_redeemed' | 'expired' | 'revoked' | 'not_yet_valid' | 'wrong_location' | 'invalid_signature' | 'not_found' | 'queued';

interface ScanResult {
  outcome: ScanOutcome;
  message: string;
  code?: string;
  ticket?: { code?: string; product_title?: string; subtype?: string } | null;
  at: number;
}

interface QueuedScan {
  id: string;
  token: string;
  idempotency_key: string;
  queued_at: number;
}

const QUEUE_KEY = 'pesaswap.scanner.queue';
const HISTORY_KEY = 'pesaswap.scanner.history';
const SOUND_KEY = 'pesaswap.scanner.sound';

function loadQueue(): QueuedScan[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveQueue(q: QueuedScan[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* quota */ }
}
function loadHistory(): ScanResult[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function saveHistory(h: ScanResult[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 50))); } catch { /* quota */ }
}

function beep(success: boolean) {
  try {
    const W = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctx = window.AudioContext || W.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = success ? 880 : 220;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    /* ignore */
  }
}

const OUTCOME_LABEL: Record<ScanOutcome, { color: string; bg: string; ring: string; label: string; sound: boolean }> = {
  ok:                { color: 'text-emerald-50', bg: 'bg-emerald-600',    ring: 'ring-emerald-300', label: 'ADMITTED',          sound: true  },
  already_redeemed:  { color: 'text-rose-50',    bg: 'bg-rose-600',       ring: 'ring-rose-300',    label: 'ALREADY REDEEMED', sound: false },
  expired:           { color: 'text-amber-50',   bg: 'bg-amber-600',      ring: 'ring-amber-300',   label: 'EXPIRED',          sound: false },
  revoked:           { color: 'text-rose-50',    bg: 'bg-rose-700',       ring: 'ring-rose-300',    label: 'REVOKED',          sound: false },
  not_yet_valid:     { color: 'text-amber-50',   bg: 'bg-amber-600',      ring: 'ring-amber-300',   label: 'NOT YET VALID',    sound: false },
  wrong_location:    { color: 'text-amber-50',   bg: 'bg-amber-700',      ring: 'ring-amber-300',   label: 'WRONG LOCATION',   sound: false },
  invalid_signature: { color: 'text-rose-50',    bg: 'bg-rose-800',       ring: 'ring-rose-300',    label: 'INVALID',          sound: false },
  not_found:         { color: 'text-rose-50',    bg: 'bg-rose-700',       ring: 'ring-rose-300',    label: 'NOT FOUND',        sound: false },
  queued:            { color: 'text-slate-50',   bg: 'bg-slate-600',      ring: 'ring-slate-300',   label: 'QUEUED (OFFLINE)', sound: true  },
};

export function CheckinPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanLockRef = useRef<{ value: string; until: number }>({ value: '', until: 0 });
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [supported, setSupported] = useState<'native' | 'unsupported'>('unsupported');
  const [last, setLast] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<ScanResult[]>(() => loadHistory());
  const [queue, setQueue] = useState<QueuedScan[]>(() => loadQueue());
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [sound, setSound] = useState<boolean>(() => localStorage.getItem(SOUND_KEY) !== '0');
  const [showSettings, setShowSettings] = useState(false);
  const [manual, setManual] = useState('');

  // Detect BarcodeDetector support
  useEffect(() => {
    const W = window as unknown as { BarcodeDetector?: unknown };
    setSupported(W.BarcodeDetector ? 'native' : 'unsupported');
  }, []);

  // Online / offline detection
  useEffect(() => {
    const go = () => setOnline(navigator.onLine);
    window.addEventListener('online', go);
    window.addEventListener('offline', go);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('offline', go);
    };
  }, []);

  const pushHistory = useCallback((r: ScanResult) => {
    setHistory((prev) => {
      const next = [r, ...prev].slice(0, 50);
      saveHistory(next);
      return next;
    });
    setLast(r);
    if (sound) beep(OUTCOME_LABEL[r.outcome]?.sound ?? false);
  }, [sound]);

  // POST a single scan + handle outcome + idempotency
  const sendScan = useCallback(async (token: string, idempotencyKey: string): Promise<ScanResult> => {
    try {
      const res = await api.tickets.redeem({ token, idempotency_key: idempotencyKey });
      const data = res.data as Record<string, unknown> | undefined;
      const outcome = (data?.result as ScanOutcome) ?? 'not_found';
      const ticket = (data?.ticket as { code?: string; product_title?: string; subtype?: string } | null) ?? null;
      return {
        outcome,
        message: String(data?.message ?? res.message ?? ''),
        code: token,
        ticket,
        at: Date.now(),
      };
    } catch (err) {
      throw err;
    }
  }, []);

  const processScan = useCallback(async (rawToken: string) => {
    const token = rawToken.trim();
    if (!token) return;
    // Dedupe rapid double-scans (camera fires multiple times per QR)
    const now = Date.now();
    if (scanLockRef.current.value === token && scanLockRef.current.until > now) return;
    scanLockRef.current = { value: token, until: now + 1500 };

    const idempotencyKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2)}`;

    if (!navigator.onLine) {
      const queued: QueuedScan = { id: idempotencyKey, token, idempotency_key: idempotencyKey, queued_at: now };
      const next = [...loadQueue(), queued];
      saveQueue(next); setQueue(next);
      pushHistory({ outcome: 'queued', message: 'Saved to offline queue', code: token, at: now, ticket: null });
      return;
    }

    try {
      const result = await sendScan(token, idempotencyKey);
      pushHistory(result);
    } catch {
      // Network error → queue
      const queued: QueuedScan = { id: idempotencyKey, token, idempotency_key: idempotencyKey, queued_at: now };
      const next = [...loadQueue(), queued];
      saveQueue(next); setQueue(next);
      pushHistory({ outcome: 'queued', message: 'Network error - queued for retry', code: token, at: now, ticket: null });
    }
  }, [pushHistory, sendScan]);

  // Flush queue when we come back online
  const flushQueue = useCallback(async () => {
    const current = loadQueue();
    if (current.length === 0) return;
    const stillQueued: QueuedScan[] = [];
    for (const q of current) {
      try {
        const result = await sendScan(q.token, q.idempotency_key);
        pushHistory({ ...result, message: '(flushed) ' + result.message });
      } catch {
        stillQueued.push(q);
      }
    }
    saveQueue(stillQueued);
    setQueue(stillQueued);
  }, [pushHistory, sendScan]);

  useEffect(() => {
    if (online) void flushQueue();
  }, [online, flushQueue]);

  // Start camera (native BarcodeDetector path)
  const startCamera = useCallback(async () => {
    try {
      if (supported !== 'native') return;
      const W = window as unknown as { BarcodeDetector?: new (init: { formats: string[] }) => { detect: (s: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> } };
      if (!W.BarcodeDetector) return;
      const detector = new W.BarcodeDetector({ formats: ['qr_code'] });
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setScanning(true);

      const loop = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          requestAnimationFrame(loop);
          return;
        }
        try {
          const bitmap = await createImageBitmap(videoRef.current);
          const codes = await detector.detect(bitmap);
          bitmap.close?.();
          if (codes.length > 0) {
            void processScan(codes[0].rawValue);
          }
        } catch {
          /* frame failure - ignore */
        }
        if (scanning || true) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (err) {
      console.error('Camera error', err);
      alert('Could not start camera: ' + (err instanceof Error ? err.message : String(err)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, processScan]);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    setScanning(false);
  }, [stream]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const toggleSound = useCallback(() => {
    setSound((s) => {
      const next = !s;
      localStorage.setItem(SOUND_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const lastStyle = useMemo(() => last ? (OUTCOME_LABEL[last.outcome] ?? OUTCOME_LABEL.not_found) : null, [last]);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="flex items-center justify-between p-3 bg-black/40 backdrop-blur">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Camera className="h-5 w-5 text-fuchsia-400" />
          Gate Scanner
        </h1>
        <div className="flex items-center gap-2">
          {!online && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase">
              <WifiOff className="h-3 w-3" /> Offline
            </span>
          )}
          {queue.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-600 px-2 py-0.5 text-[10px] font-bold">
              <ListChecks className="h-3 w-3" /> {queue.length} queued
            </span>
          )}
          <button type="button" onClick={toggleSound} className="rounded-full bg-white/10 p-2 hover:bg-white/20" title={sound ? 'Mute' : 'Unmute'}>
            {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="rounded-full bg-white/10 p-2 hover:bg-white/20" title="History">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 relative">
        {scanning && supported === 'native' ? (
          <>
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className="w-72 h-72 border-4 border-fuchsia-400/80 rounded-3xl shadow-[0_0_0_2000px_rgba(0,0,0,0.5)]" />
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6">
            {supported === 'native' ? (
              <button type="button" onClick={() => void startCamera()} className="rounded-2xl bg-fuchsia-600 px-8 py-4 text-lg font-bold flex items-center gap-2 hover:bg-fuchsia-700">
                <Power className="h-5 w-5" />
                Start camera
              </button>
            ) : (
              <p className="text-center text-sm text-gray-400 max-w-sm">
                Native QR scanner not supported on this browser. Paste a ticket code below, or use a Chromium-based browser for camera scanning.
              </p>
            )}

            <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { void processScan(manual.trim()); setManual(''); } }} className="w-full max-w-sm space-y-2 mt-4">
              <label className="text-xs text-gray-400 flex items-center gap-1.5">
                <ClipboardPaste className="h-3.5 w-3.5" /> Manual entry
              </label>
              <input
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                placeholder="Paste JWT / URL / ticket code"
                className="w-full rounded-xl bg-gray-900 border border-gray-700 px-4 py-3 text-sm placeholder-gray-500 focus:border-fuchsia-500 focus:outline-none"
              />
              <button type="submit" className="w-full rounded-xl bg-fuchsia-600 px-4 py-3 text-sm font-bold hover:bg-fuchsia-700">Redeem</button>
            </form>
          </div>
        )}

        {/* Big result banner */}
        {last && lastStyle && (
          <div className={`absolute bottom-0 inset-x-0 p-5 ${lastStyle.bg} ${lastStyle.color} animate-[slideUp_.2s_ease-out]`}>
            <div className="flex items-center gap-3">
              {last.outcome === 'ok' ? <CheckCircle2 className="h-10 w-10" /> : last.outcome === 'queued' ? <ListChecks className="h-10 w-10" /> : <XCircle className="h-10 w-10" />}
              <div className="flex-1">
                <p className="text-2xl font-bold leading-tight">{lastStyle.label}</p>
                <p className="text-xs opacity-90">{last.message}</p>
                {last.ticket?.product_title && (
                  <p className="text-[11px] opacity-80 mt-0.5">{last.ticket.product_title} {last.ticket.subtype ? `· ${last.ticket.subtype}` : ''}</p>
                )}
              </div>
              <button type="button" onClick={() => setLast(null)} className="rounded-full bg-white/20 p-2 text-white">
                <XCircle className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Settings / history drawer */}
      {showSettings && (
        <div className="fixed inset-0 z-30 bg-black/60 flex items-end" onClick={() => setShowSettings(false)}>
          <div className="w-full bg-gray-900 rounded-t-3xl p-5 max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3">Recent scans ({history.length})</h2>
            {history.length === 0 ? (
              <p className="text-sm text-gray-500">No scans yet.</p>
            ) : (
              <ul className="divide-y divide-gray-800 text-sm">
                {history.map((h, i) => {
                  const st = OUTCOME_LABEL[h.outcome] ?? OUTCOME_LABEL.not_found;
                  return (
                    <li key={i} className="py-2 flex items-center gap-3">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${st.bg} ${st.color}`}>{st.label}</span>
                      <span className="font-mono text-xs text-gray-300 truncate flex-1">{h.ticket?.product_title ?? h.code?.slice(-12) ?? ''}</span>
                      <span className="text-[10px] text-gray-500">{new Date(h.at).toLocaleTimeString()}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="mt-4 pt-4 border-t border-gray-800 text-xs text-gray-400 space-y-1">
              <p>Detector: {supported === 'native' ? 'BarcodeDetector (native)' : 'manual only'}</p>
              <p>Queue: {queue.length} pending {online && queue.length > 0 && (<button type="button" onClick={() => void flushQueue()} className="ml-2 text-fuchsia-400 underline">flush now</button>)}</p>
              <p>Online: {String(online)}</p>
              <p>Sound: {sound ? 'on' : 'off'}</p>
            </div>
            <button type="button" onClick={() => setShowSettings(false)} className="mt-4 w-full rounded-lg bg-gray-800 px-4 py-2 text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
