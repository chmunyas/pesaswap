import { useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';
import {
  useKitchenOrders,
  updateKitchenOrderStatus,
  submitNewOrder,
  clearOldOrders,
  generateOrderId,
  type KitchenOrder,
  type OrderStatus,
  type KitchenOrderItem,
} from '../lib/realtime';
import { useI18n } from '../lib/i18n';

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

export function KitchenPage() {
  const { t } = useI18n();
  const orders = useKitchenOrders();
  const [filter, setFilter] = useState<Filter>('all');
  const [showDemo, setShowDemo] = useState(false);

  // Periodically clear old served/cancelled orders
  useEffect(() => {
    clearOldOrders(120);
    const interval = setInterval(() => clearOldOrders(120), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
            onClick={() => setFilter(f)}
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
