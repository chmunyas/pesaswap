/**
 * ReservationsPage — table booking with capacity, today/upcoming/past sections.
 *
 * Pattern adapted from chmunyas/merchantApp's TableServiceView "reservations"
 * subview (~lines 2680-2900 of features/TableServiceView.tsx). Storage is
 * localStorage-only (per-browser-profile) for v1 — no backend yet; OSPOS has
 * no reservations table.
 *
 * Per rubber-duck feedback: dates compared as YYYY-MM-DD strings to avoid
 * UTC/local timezone shift bugs from `new Date('YYYY-MM-DD')`.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Plus,
  Trash2,
  Users,
  UserCheck,
  UserX,
  Phone,
  Clock,
} from 'lucide-react';
import { showToast } from '../components/ui/Toast';

type ReservationStatus = 'confirmed' | 'seated' | 'no_show' | 'cancelled';

interface Reservation {
  id: string;
  customerName: string;
  phone: string;
  date: string; // YYYY-MM-DD (local)
  time: string; // HH:mm (24h, local)
  tableNumber: number;
  covers: number;
  status: ReservationStatus;
  createdAt: string;
}

const STORAGE_KEY = 'pesaswap.reservations';

/** YYYY-MM-DD for today in the user's local timezone (no UTC drift). */
function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readStored(): Reservation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Reservation[]) : [];
  } catch {
    return [];
  }
}

function writeStored(value: Reservation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
}

const STATUS_STYLES: Record<ReservationStatus, { badge: string; label: string }> = {
  confirmed: { badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',     label: 'Confirmed' },
  seated:    { badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'Seated' },
  no_show:   { badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',     label: 'No-show' },
  cancelled: { badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',         label: 'Cancelled' },
};

export function ReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [form, setForm] = useState({
    customerName: '',
    phone: '',
    date: todayLocal(),
    time: '19:00',
    tableNumber: '',
    covers: '2',
  });

  useEffect(() => {
    setReservations(readStored());
  }, []);

  function persist(next: Reservation[]) {
    setReservations(next);
    writeStored(next);
  }

  function update(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function createReservation() {
    const name = form.customerName.trim();
    const phone = form.phone.trim();
    const table = Number(form.tableNumber);
    const covers = Number(form.covers) || 2;
    if (!name || !phone || !table) {
      showToast('Name, phone, and table number are required', 'error');
      return;
    }
    const res: Reservation = {
      id: `res-${Date.now()}`,
      customerName: name,
      phone,
      date: form.date,
      time: form.time,
      tableNumber: table,
      covers,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
    };
    persist([res, ...reservations]);
    setForm((prev) => ({ ...prev, customerName: '', phone: '', tableNumber: '' }));
    showToast(`Reservation confirmed for table ${table} at ${form.time}`);
  }

  function setStatus(id: string, status: ReservationStatus) {
    persist(reservations.map((r) => (r.id === id ? { ...r, status } : r)));
  }

  function remove(id: string) {
    persist(reservations.filter((r) => r.id !== id));
  }

  const today = todayLocal();

  const { todayList, upcomingList, pastList } = useMemo(() => {
    // Compare on the YYYY-MM-DD strings directly — same-shape strings sort lexicographically.
    const todayList: Reservation[] = [];
    const upcomingList: Reservation[] = [];
    const pastList: Reservation[] = [];
    for (const r of reservations) {
      if (r.date === today) todayList.push(r);
      else if (r.date > today) upcomingList.push(r);
      else pastList.push(r);
    }
    todayList.sort((a, b) => a.time.localeCompare(b.time));
    upcomingList.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    pastList.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    return { todayList, upcomingList, pastList: pastList.slice(0, 10) };
  }, [reservations, today]);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Calendar className="h-6 w-6 text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Reservations</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage table bookings · {reservations.length} total · stored locally on this device
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* New reservation form */}
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 lg:col-span-1">
          <div className="mb-4 flex items-center gap-2">
            <Plus className="h-4 w-4 text-purple-600" />
            <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
              New booking
            </h2>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              Customer name
              <input
                type="text"
                value={form.customerName}
                onChange={(e) => update('customerName', e.target.value)}
                placeholder="Jane Doe"
                autoComplete="name"
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </label>

            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
              Phone
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                placeholder="07XX XXX XXX"
                inputMode="tel"
                autoComplete="tel"
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Date
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => update('date', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Time
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => update('time', e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Table #
                <input
                  type="text"
                  value={form.tableNumber}
                  onChange={(e) => update('tableNumber', e.target.value.replace(/\D/g, '').slice(0, 3))}
                  placeholder="12"
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                Covers
                <input
                  type="text"
                  value={form.covers}
                  onChange={(e) => update('covers', e.target.value.replace(/\D/g, '').slice(0, 2))}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={createReservation}
              disabled={!form.customerName || !form.phone || !form.tableNumber}
              className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Confirm reservation
            </button>
          </div>
        </div>

        {/* Lists */}
        <div className="space-y-6 lg:col-span-2">
          <ReservationSection
            title="Today"
            icon={<Clock className="h-4 w-4 text-emerald-600" />}
            list={todayList}
            allowActions
            onSetStatus={setStatus}
            onRemove={remove}
            empty="No bookings for today."
          />
          <ReservationSection
            title="Upcoming"
            icon={<Calendar className="h-4 w-4 text-blue-600" />}
            list={upcomingList}
            allowActions
            onSetStatus={setStatus}
            onRemove={remove}
            empty="No upcoming bookings."
          />
          <ReservationSection
            title="Recent (past)"
            icon={<Clock className="h-4 w-4 text-gray-500" />}
            list={pastList}
            allowActions={false}
            onSetStatus={setStatus}
            onRemove={remove}
            empty="No past bookings."
          />
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  list: Reservation[];
  allowActions: boolean;
  onSetStatus: (id: string, s: ReservationStatus) => void;
  onRemove: (id: string) => void;
  empty: string;
}

function ReservationSection({ title, icon, list, allowActions, onSetStatus, onRemove, empty }: SectionProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">
          {title}
        </h2>
        <span className="text-xs text-gray-400">({list.length})</span>
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-900/50">
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((r) => {
            const style = STATUS_STYLES[r.status];
            return (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {r.customerName}
                    </p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${style.badge}`}>
                      {style.label}
                    </span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                    <span>Table {r.tableNumber}</span>
                    <span aria-hidden>·</span>
                    <span>{r.date} {r.time}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {r.covers}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {r.phone}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {allowActions && r.status === 'confirmed' && (
                    <>
                      <button
                        type="button"
                        onClick={() => onSetStatus(r.id, 'seated')}
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60"
                      >
                        <UserCheck className="h-3 w-3" /> Seat
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetStatus(r.id, 'no_show')}
                        className="inline-flex items-center gap-1 rounded-lg bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-700 hover:bg-rose-200 dark:bg-rose-900/40 dark:text-rose-300 dark:hover:bg-rose-900/60"
                      >
                        <UserX className="h-3 w-3" /> No-show
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetStatus(r.id, 'cancelled')}
                        className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => onRemove(r.id)}
                    aria-label="Delete reservation"
                    className="rounded-lg p-1 text-gray-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/30 dark:hover:text-rose-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
