/**
 * PESASWAP Realtime — stolen and adapted from chmunyas/merchantApp.
 *
 * Provides:
 * - Audio notification sounds (payment ka-ching, order beep, alert triple-beep)
 * - WebSocket event bus with polling fallback (for future server-push integration)
 * - BroadcastChannel order bus for cross-tab communication
 *   (customer tab on /t/:id places order → kitchen tab on /kds beeps + shows it)
 * - React hooks: useRealtimeEvent, useKitchenOrders
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// ============================================================
// AUDIO NOTIFICATIONS
// ============================================================

export type SoundType = 'payment' | 'order' | 'alert' | 'tap';

export function playNotificationSound(type: SoundType): void {
  if (typeof window === 'undefined') return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    switch (type) {
      case 'payment':
        // Pleasant "ka-ching" — two ascending tones
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
        break;
      case 'order':
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.2, ctx.currentTime + 0.15);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
        break;
      case 'alert':
        osc.frequency.setValueAtTime(1000, ctx.currentTime);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.4, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.4, ctx.currentTime + 0.3);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.5);
        break;
      case 'tap':
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.08);
        break;
    }
  } catch {
    // ignore — audio not available
  }
}

// ============================================================
// REALTIME EVENT BUS (WebSocket + polling fallback)
// ============================================================

export type RealtimeEvent =
  | { type: 'payment.succeeded'; data: { payment_id: string; amount: number; currency: string; customer_phone?: string; table_id?: string; method?: 'mpesa' | 'bnpl' | 'card' | 'cash'; timestamp: string } }
  | { type: 'payment.failed'; data: { payment_id: string; reason: string; timestamp: string } }
  | { type: 'order.placed'; data: { order_id: string; table_id: string; items_count: number; timestamp: string } }
  | { type: 'table.updated'; data: { table_id: string; status: string; timestamp: string } }
  | { type: 'walkout.alert'; data: { table_id: string; outstanding: number; duration_minutes: number; timestamp: string } };

type EventHandler = (event: RealtimeEvent) => void;

class RealtimeManager {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private merchantId = '';
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private backendUrl: string;

  constructor(backendUrl?: string) {
    this.backendUrl = backendUrl || '';
  }

  connect(merchantId: string): void {
    this.merchantId = merchantId;
    this.connectWebSocket();
  }

  disconnect(): void {
    this.connected = false;
    if (this.ws) {
      this.ws.close(1000, 'client disconnect');
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPolling();
  }

  on(eventType: RealtimeEvent['type'] | '*', handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) this.handlers.set(eventType, new Set());
    this.handlers.get(eventType)!.add(handler);
    return () => this.handlers.get(eventType)?.delete(handler);
  }

  emit(event: RealtimeEvent): void {
    this.dispatch(event);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private connectWebSocket(): void {
    if (typeof window === 'undefined') return;
    const wsUrl = this.backendUrl.replace(/^http/, 'ws');
    if (!wsUrl) {
      this.startPolling();
      return;
    }
    try {
      this.ws = new WebSocket(`${wsUrl}/api/realtime?merchant=${encodeURIComponent(this.merchantId)}`);
      this.ws.onopen = () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.stopPolling();
      };
      this.ws.onmessage = (evt) => {
        try {
          const event = JSON.parse(evt.data) as RealtimeEvent;
          this.dispatch(event);
        } catch {
          // ignore invalid messages
        }
      };
      this.ws.onclose = (evt) => {
        this.connected = false;
        if (evt.code !== 1000) this.scheduleReconnect();
      };
      this.ws.onerror = () => {
        this.connected = false;
      };
    } catch {
      this.startPolling();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.startPolling();
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connectWebSocket(), delay);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    let lastChecked = new Date().toISOString();
    this.pollTimer = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/realtime/notifications?merchant=${encodeURIComponent(this.merchantId)}&since=${encodeURIComponent(lastChecked)}`,
          { credentials: 'include' },
        );
        if (res.ok) {
          const events = (await res.json()) as RealtimeEvent[];
          events.forEach((e) => this.dispatch(e));
          lastChecked = new Date().toISOString();
        }
      } catch {
        // network errors are silent — keep polling
      }
    }, 5000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private dispatch(event: RealtimeEvent): void {
    switch (event.type) {
      case 'payment.succeeded': playNotificationSound('payment'); break;
      case 'payment.failed':
      case 'walkout.alert': playNotificationSound('alert'); break;
      case 'order.placed': playNotificationSound('order'); break;
    }
    const specific = this.handlers.get(event.type);
    specific?.forEach((h) => { try { h(event); } catch { /* ignore handler errors */ } });
    const wildcard = this.handlers.get('*');
    wildcard?.forEach((h) => { try { h(event); } catch { /* ignore handler errors */ } });
  }
}

export const realtime = new RealtimeManager();

export function useRealtimeEvent(
  eventType: RealtimeEvent['type'] | '*',
  handler: EventHandler,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const stable = useCallback((e: RealtimeEvent) => handlerRef.current(e), []);
  useEffect(() => {
    const unsub = realtime.on(eventType, stable);
    return unsub;
  }, [eventType, stable]);
}

export function useRealtimeConnection(merchantId: string): { connected: boolean } {
  useEffect(() => {
    realtime.connect(merchantId);
    return () => realtime.disconnect();
  }, [merchantId]);
  return { connected: realtime.isConnected() };
}

// ============================================================
// LOCAL ORDER BUS — BroadcastChannel for cross-tab realtime
// Customer tab on /t/:id → kitchen tab on /kds, instantly.
// ============================================================

export type OrderStatus = 'new' | 'accepted' | 'preparing' | 'ready' | 'served' | 'cancelled';

export type KitchenOrderItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
  notes?: string;
  destination?: 'kitchen' | 'bar';
};

export type KitchenOrder = {
  id: string;
  tableId: string;
  tableName: string;
  items: KitchenOrderItem[];
  status: OrderStatus;
  total: number;
  currency: string;
  customerNote?: string;
  fulfilment: 'dine-in' | 'takeaway' | 'delivery';
  createdAt: string;
  updatedAt: string;
};

type OrderBusMessage =
  | { type: 'order:new'; order: KitchenOrder }
  | { type: 'order:status'; orderId: string; status: OrderStatus }
  | { type: 'order:sync'; orders: KitchenOrder[] };

type OrderBusListener = (msg: OrderBusMessage) => void;

const ORDER_CHANNEL_NAME = 'pesaswap:orders';
const ORDERS_STORAGE_KEY = 'pesaswap.kitchen.orders';

let orderChannel: BroadcastChannel | null = null;
const orderListeners = new Set<OrderBusListener>();

function getOrderChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!orderChannel && typeof BroadcastChannel !== 'undefined') {
    orderChannel = new BroadcastChannel(ORDER_CHANNEL_NAME);
    orderChannel.onmessage = (evt: MessageEvent<OrderBusMessage>) => {
      orderListeners.forEach((fn) => fn(evt.data));
    };
  }
  return orderChannel;
}

export function subscribeOrders(listener: OrderBusListener): () => void {
  orderListeners.add(listener);
  getOrderChannel();
  return () => {
    orderListeners.delete(listener);
  };
}

function broadcast(msg: OrderBusMessage): void {
  try {
    getOrderChannel()?.postMessage(msg);
  } catch {
    // ignore SSR / no BroadcastChannel
  }
  // also notify same-tab listeners
  orderListeners.forEach((fn) => fn(msg));
}

export function generateOrderId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  return `ORD-${rand}-${ts}`;
}

export function getKitchenOrders(): KitchenOrder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KitchenOrder[]) : [];
  } catch {
    return [];
  }
}

export function saveKitchenOrders(orders: KitchenOrder[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders.slice(0, 200)));
}

export function submitNewOrder(order: KitchenOrder): void {
  const orders = getKitchenOrders();
  orders.unshift(order);
  saveKitchenOrders(orders);
  broadcast({ type: 'order:new', order });
  playNotificationSound('order');
}

export function updateKitchenOrderStatus(
  orderId: string,
  status: OrderStatus,
): KitchenOrder | null {
  const orders = getKitchenOrders();
  const order = orders.find((o) => o.id === orderId);
  if (!order) return null;
  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveKitchenOrders(orders);
  broadcast({ type: 'order:status', orderId, status });
  return order;
}

export function clearOldOrders(maxAgeMinutes = 120): void {
  const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
  const orders = getKitchenOrders().filter((o) => {
    if (o.status === 'served' || o.status === 'cancelled') {
      return new Date(o.updatedAt).getTime() > cutoff;
    }
    return true;
  });
  saveKitchenOrders(orders);
}

export function useKitchenOrders() {
  const [orders, setOrders] = useState<KitchenOrder[]>(() => getKitchenOrders());

  useEffect(() => {
    const syncFromStorage = () => setOrders(getKitchenOrders());
    window.addEventListener('focus', syncFromStorage);
    window.addEventListener('storage', syncFromStorage);

    const unsub = subscribeOrders((msg) => {
      if (msg.type === 'order:new') {
        playNotificationSound('order');
        setOrders((prev) => [msg.order, ...prev.filter((o) => o.id !== msg.order.id)]);
      } else if (msg.type === 'order:status') {
        setOrders((prev) =>
          prev.map((o) =>
            o.id === msg.orderId ? { ...o, status: msg.status, updatedAt: new Date().toISOString() } : o,
          ),
        );
      } else if (msg.type === 'order:sync') {
        setOrders(msg.orders);
      }
    });

    return () => {
      unsub();
      window.removeEventListener('focus', syncFromStorage);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  return orders;
}
