import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChefHat,
  Coffee,
  Clock,
  CheckCircle2,
  X,
  Flame,
  Bell,
  Trash2,
  Plus,
  AlertTriangle,
  UserCheck,
  Users,
} from 'lucide-react';
import {
  useKitchenOrders,
  updateKitchenOrderStatus,
  submitNewOrder,
  clearOldOrders,
  generateOrderId,
  realtime,
  playNotificationSound,
  type KitchenOrder,
  type OrderStatus,
  type KitchenOrderItem,
} from '../lib/realtime';
import { useI18n } from '../lib/i18n';
import {
  addDemoWalkoutTable,
  alertKey,
  DEFAULT_WALKOUT_MINUTES,
  evaluateRisk,
  getOpenTables,
  markAlerted,
  markResolved,
  minutesOpen,
  type OpenTable,
} from '../lib/walkout';
import { formatCurrency } from '../lib/utils';

const STATUS_FLOW: Record<OrderStatus, OrderStatus | null> = {
  new: 'accepted',
  accepted: 'preparing',
  preparing: 'ready',
  ready: 'served',
  served: null,
  cancelled: null,
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  new: 'bg-blue-500',
  accepted: 'bg-amber-500',
  preparing: 'bg-orange-500',
  ready: 'bg-emerald-500',
  served: 'bg-gray-500',
  cancelled: 'bg-red-500',
};

const STATUS_BG: Record<OrderStatus, string> = {
  new: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  accepted: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800',
  preparing: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800',
  ready: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800',
  served: 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-800',
  cancelled: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
};

type Filter = 'all' | 'kitchen' | 'bar';

const VALID_FILTERS: Filter[] = ['all', 'kitchen', 'bar'];

function parseFilter(raw: string | null): Filter {
  return (VALID_FILTERS as string[]).includes(raw ?? '') ? (raw as Filter) : 'all';
}

export function KitchenPage() {
  const { t } = useI18n();
  const orders = useKitchenOrders();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>(() => parseFilter(searchParams.get('destination')));
  const [showDemo, setShowDemo] = useState(false);

  // Walkout risk state
  const [openTables, setOpenTables] = useState<OpenTable[]>(() => getOpenTables());
  const [riskTick, setRiskTick] = useState(0);
  const lastEvaluationRef = useRef<number>(0);

  // Periodically clear old served/cancelled orders
  useEffect(() => {
    clearOldOrders(120);
    const interval = setInterval(() => clearOldOrders(120), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync URL ?destination= to local filter (handles back/forward and shareable URLs)
  useEffect(() => {
    const next = parseFilter(searchParams.get('destination'));
    setFilter((prev) => (prev === next ? prev : next));
  }, [searchParams]);

  // Re-evaluate walkout risk every 60s. Emit `walkout.alert` ONCE per (table_id, openedAt).
  useEffect(() => {
    function evaluate() {
      const tables = getOpenTables();
      setOpenTables(tables);
      const { atRisk, newRiskKeys } = evaluateRisk(tables);
      lastEvaluationRef.current = Date.now();
      if (newRiskKeys.length > 0) {
        markAlerted(newRiskKeys);
        // Emit a realtime event per newly-flagged table (visual + audio cue)
        for (const key of newRiskKeys) {
          const tbl = atRisk.find((x) => alertKey(x) === key);
          if (!tbl) continue;
          realtime.emit({
            type: 'walkout.alert',
            data: {
              table_id: tbl.tableNumber,
              outstanding: tbl.outstanding,
              duration_minutes: minutesOpen(tbl),
              timestamp: new Date().toISOString(),
            },
          });
        }
      }
    }
    evaluate();
    const interval = setInterval(() => {
      evaluate();
      setRiskTick((n) => n + 1);
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const walkoutRiskTables = useMemo(
    () => evaluateRisk(openTables).atRisk,
    // riskTick forces re-eval of elapsed-time fields between evaluate() calls
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openTables, riskTick],
  );

  function handleFilter(next: Filter) {
    setFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'all') params.delete('destination');
    else params.set('destination', next);
    setSearchParams(params, { replace: true });
  }

  function handleResolveTable(table: OpenTable) {
    markResolved(table);
    setOpenTables(getOpenTables());
    setRiskTick((n) => n + 1);
  }

  function handleAddDemoRisk() {
    addDemoWalkoutTable();
    setOpenTables(getOpenTables());
    setRiskTick((n) => n + 1);
  }

  const activeOrders = useMemo(() => {
    const filtered = orders.filter((o) => o.status !== 'served' && o.status !== 'cancelled');
    if (filter === 'all') return filtered;
    return filtered.filter((o) => o.items.some((it) => (it.destination || 'kitchen') === filter));
  }, [orders, filter]);

  const counts = useMemo(() => {
    const result = { new: 0, accepted: 0, preparing: 0, ready: 0 };
    orders.forEach((o) => {
      if (o.status === 'new') result.new++;
      else if (o.status === 'accepted') result.accepted++;
      else if (o.status === 'preparing') result.preparing++;
      else if (o.status === 'ready') result.ready++;
    });
    return result;
  }, [orders]);

  function submitDemoOrder() {
    const items: KitchenOrderItem[] = [
      { id: '1', name: 'Margherita Pizza', quantity: 1, price: 850, destination: 'kitchen', notes: 'Extra basil' },
      { id: '2', name: 'Coca Cola', quantity: 2, price: 150, destination: 'bar' },
    ];
    const order: KitchenOrder = {
      id: generateOrderId(),
      tableId: String(Math.floor(Math.random() * 12) + 1),
      tableName: `Table ${Math.floor(Math.random() * 12) + 1}`,
      items,
      status: 'new',
      total: items.reduce((s, it) => s + it.quantity * it.price, 0),
      currency: 'KES',
      fulfilment: 'dine-in',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    submitNewOrder(order);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ChefHat className="h-6 w-6 text-orange-600" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('kds.title')}</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Real-time order queue · auto-syncs across tabs via BroadcastChannel
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={submitDemoOrder}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 py-2 text-xs font-medium hover:bg-blue-700"
          >
            <Plus className="h-3.5 w-3.5" />
            Demo order
          </button>
          <button
            onClick={() => {
              setShowDemo(true);
              setTimeout(() => setShowDemo(false), 4000);
            }}
            className="flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs font-medium text-gray-700 dark:text-gray-200"
          >
            <Bell className="h-3.5 w-3.5" />
            Test bell
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="New" value={counts.new} color="bg-blue-500" />
        <StatCard label="Accepted" value={counts.accepted} color="bg-amber-500" />
        <StatCard label="Preparing" value={counts.preparing} color="bg-orange-500" />
        <StatCard label="Ready" value={counts.ready} color="bg-emerald-500" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        {(['all', 'kitchen', 'bar'] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => handleFilter(f)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition-colors ${
              filter === f
                ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'
            }`}
          >
            {f === 'kitchen' ? <ChefHat className="h-3.5 w-3.5" /> : f === 'bar' ? <Coffee className="h-3.5 w-3.5" /> : null}
            {f}
          </button>
        ))}
      </div>

      {/* Walkout risk banner */}
      {walkoutRiskTables.length > 0 && (
        <div className="rounded-2xl border-2 border-red-300 bg-gradient-to-r from-red-50 to-rose-50 p-4 shadow-sm dark:border-red-800 dark:from-red-950/40 dark:to-rose-950/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-red-900 dark:text-red-100">
                  Walkout risk: {walkoutRiskTables.length} {walkoutRiskTables.length === 1 ? 'table' : 'tables'} open &gt; {DEFAULT_WALKOUT_MINUTES} min with no payment
                </p>
                <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                  Send a waiter to settle or resolve below.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleAddDemoRisk}
              className="self-start rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-800 dark:bg-red-950 dark:text-red-200 dark:hover:bg-red-900/50"
            >
              + Demo at-risk table
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {walkoutRiskTables.map((tbl) => (
              <div key={tbl.id} className="rounded-xl border border-red-200 bg-white p-3 shadow-sm dark:border-red-900 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-gray-900 dark:text-white">Table {tbl.tableNumber}</p>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400">
                      {minutesOpen(tbl)} min · {tbl.partySize} pax{tbl.server ? ` · ${tbl.server}` : ''}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-red-600 dark:text-red-400">
                    {formatCurrency(tbl.outstanding)}
                  </p>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      // Visual-only "send waiter" demo cue
                      playNotificationSound('alert');
                    }}
                    className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-red-700"
                  >
                    <Users className="h-3 w-3" /> Send waiter
                  </button>
                  <button
                    type="button"
                    onClick={() => handleResolveTable(tbl)}
                    className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    <UserCheck className="h-3 w-3" /> Resolved
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Orders */}
      {activeOrders.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 dark:border-gray-800 py-20 text-center">
          <ChefHat className="h-12 w-12 mx-auto text-gray-300 dark:text-gray-700 mb-3" />
          <p className="text-sm text-gray-500">{t('kds.noOrders')}</p>
          <button
            onClick={submitDemoOrder}
            className="mt-4 text-xs text-blue-600 hover:underline"
          >
            Submit a demo order
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeOrders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}

      {/* Test bell toast */}
      {showDemo && (
        <div className="fixed top-20 right-4 z-50 rounded-xl bg-orange-600 text-white px-4 py-3 shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Bell className="h-5 w-5" />
          <span className="text-sm font-semibold">Order bell test 🔔</span>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{label}</p>
        <div className={`h-2 w-2 rounded-full ${color}`} />
      </div>
      <p className="mt-2 text-3xl font-bold font-mono text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function OrderCard({ order }: { order: KitchenOrder }) {
  const { t } = useI18n();
  const elapsedMin = Math.floor((Date.now() - new Date(order.createdAt).getTime()) / 60000);
  const nextStatus = STATUS_FLOW[order.status];
  const [, force] = useState(0);

  // Re-render every 15s so the elapsed time keeps updating
  useEffect(() => {
    const id = setInterval(() => force((c) => c + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const isUrgent = order.status !== 'served' && elapsedMin > 10;

  return (
    <div className={`rounded-2xl border-2 ${STATUS_BG[order.status]} p-4 ${isUrgent ? 'ring-2 ring-red-500' : ''}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-mono text-[10px] text-gray-500">{order.id}</p>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">{order.tableName}</h3>
          <p className="text-xs text-gray-500 capitalize">{order.fulfilment}</p>
        </div>
        <div className="flex items-center gap-1 text-xs">
          <Clock className={`h-3.5 w-3.5 ${isUrgent ? 'text-red-600' : 'text-gray-400'}`} />
          <span className={`font-mono font-semibold ${isUrgent ? 'text-red-600' : 'text-gray-500'}`}>
            {elapsedMin < 1 ? '<1m' : `${elapsedMin}m`}
          </span>
        </div>
      </div>

      <div className="mb-3 space-y-1.5">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-start justify-between text-sm">
            <div className="flex items-start gap-2">
              <span className="font-mono font-bold text-gray-900 dark:text-white">{item.quantity}×</span>
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{item.name}</p>
                {item.notes && (
                  <p className="text-[10px] text-amber-700 dark:text-amber-300 italic">⚠ {item.notes}</p>
                )}
              </div>
            </div>
            {item.destination && (
              <span className="text-[9px] uppercase tracking-wider text-gray-400 mt-0.5">
                {item.destination === 'kitchen' ? <ChefHat className="h-3 w-3" /> : <Coffee className="h-3 w-3" />}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${STATUS_COLORS[order.status]}`} />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300">
            {t(`kds.${order.status}`)}
          </span>
        </div>
        <span className="text-xs font-mono text-gray-500">
          {order.currency} {order.total.toLocaleString()}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        {nextStatus && (
          <button
            onClick={() => updateKitchenOrderStatus(order.id, nextStatus)}
            className={`flex-1 rounded-lg py-2 text-xs font-bold text-white transition-colors ${
              nextStatus === 'ready'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : nextStatus === 'preparing'
                ? 'bg-orange-600 hover:bg-orange-700'
                : nextStatus === 'served'
                ? 'bg-gray-600 hover:bg-gray-700'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {nextStatus === 'accepted' && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
                {t('kds.accept')}
              </>
            )}
            {nextStatus === 'preparing' && (
              <>
                <Flame className="h-3.5 w-3.5 inline mr-1" />
                {t('kds.markPreparing')}
              </>
            )}
            {nextStatus === 'ready' && (
              <>
                <Bell className="h-3.5 w-3.5 inline mr-1" />
                {t('kds.markReady')}
              </>
            )}
            {nextStatus === 'served' && (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 inline mr-1" />
                {t('kds.markServed')}
              </>
            )}
          </button>
        )}
        <button
          onClick={() => {
            if (window.confirm('Cancel this order?')) updateKitchenOrderStatus(order.id, 'cancelled');
          }}
          className="rounded-lg bg-gray-100 dark:bg-gray-800 px-3 py-2 text-gray-500 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600"
          title={t('kds.cancel')}
        >
          {order.status === 'new' ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}
