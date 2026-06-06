import type { Customer, DashboardStats, Item, User } from '../types';

const BASE_URL = '/api';

type ApiData = Record<string, unknown>;
type EntityList = Record<string, unknown>[];
type EntityPayload = Record<string, unknown>;
type AuthUserData = User & { user?: User };
type ConfigData = Record<string, string>;

export interface ApiResponse<T = ApiData> {
  success: boolean;
  data: T;
  message?: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${url}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const error = await res.json().catch((): { message: string } => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${res.status}`);
  }

  return res.json();
}

const supplierEndpoints = {
  list: (page = 1, limit = 20, search = '') =>
    request<ApiResponse<EntityPayload>>(`/suppliers?limit=${limit}&offset=${(page - 1) * limit}&search=${encodeURIComponent(search)}`),
  get: (id: number) => request<ApiResponse<EntityPayload>>(`/suppliers/${id}`),
  create: (data: ApiData) => request<ApiResponse>('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: ApiData) => request<ApiResponse>(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) => request<ApiResponse>(`/suppliers/${id}`, { method: 'DELETE' }),
};

const giftCardEndpoints = {
  list: (page = 1, limit = 20, search = '', status = '') =>
    request<ApiResponse<EntityPayload>>(
      `/giftcards?limit=${limit}&offset=${(page - 1) * limit}&search=${encodeURIComponent(search)}&status=${encodeURIComponent(status)}`,
    ),
  get: (id: number) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}`),
  history: (id: number) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/history`),
  create: (data: ApiData) =>
    request<ApiResponse<EntityPayload>>('/giftcards', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: number) =>
    request<ApiResponse>(`/giftcards/${id}`, { method: 'DELETE' }),
  redeem: (id: number, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/redeem`, { method: 'POST', body: JSON.stringify(data) }),
  refund: (id: number, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/refund`, { method: 'POST', body: JSON.stringify(data) }),
  adjust: (id: number, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/adjust`, { method: 'POST', body: JSON.stringify(data) }),
  topup: (id: number, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/topup`, { method: 'POST', body: JSON.stringify(data) }),
  resendEmail: (id: number) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/resend-email`, { method: 'POST' }),
  publicBalance: (code: string) =>
    request<ApiResponse<EntityPayload>>(`/public/giftcards/balance/${encodeURIComponent(code)}`),
  // Send-as-gift transfer flow (modernization)
  transfer: (id: number, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/transfer`, { method: 'POST', body: JSON.stringify(data) }),
  transferList: (id: number) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/transfers`),
  transferCancel: (id: number, transferId: number) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/transfers/${transferId}`, { method: 'DELETE' }),
  publicTransferLookup: (token: string) =>
    request<ApiResponse<EntityPayload>>(`/public/giftcards/transfer/${encodeURIComponent(token)}`),
  publicTransferAccept: (token: string, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/public/giftcards/transfer/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  // Design templates + preset denominations (admin)
  designs: {
    list: () => request<ApiResponse<{ designs?: EntityPayload[] }>>('/giftcard-designs'),
    get: (id: number) => request<ApiResponse<EntityPayload>>(`/giftcard-designs/${id}`),
    create: (data: ApiData) => request<ApiResponse<EntityPayload>>('/giftcard-designs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ApiData) => request<ApiResponse<EntityPayload>>(`/giftcard-designs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<ApiResponse>(`/giftcard-designs/${id}`, { method: 'DELETE' }),
  },
  denominations: {
    list: (currency?: string) => request<ApiResponse<{ denominations?: EntityPayload[] }>>(
      currency ? `/giftcard-denominations?currency=${encodeURIComponent(currency)}` : '/giftcard-denominations',
    ),
    create: (data: ApiData) => request<ApiResponse<EntityPayload>>('/giftcard-denominations', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ApiData) => request<ApiResponse<EntityPayload>>(`/giftcard-denominations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<ApiResponse>(`/giftcard-denominations/${id}`, { method: 'DELETE' }),
  },
  // NFC binding + payment intents + customer self-service (Phase 6)
  bind: (id: number, data: ApiData) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/bind`, { method: 'POST', body: JSON.stringify(data) }),
  unbind: (id: number) =>
    request<ApiResponse<EntityPayload>>(`/giftcards/${id}/bind`, { method: 'DELETE' }),
  bindings: (id: number) =>
    request<ApiResponse<{ bindings?: EntityPayload[] }>>(`/giftcards/${id}/bindings`),
  createIntent: (id: number, data: ApiData) =>
    request<ApiResponse<{ intent?: EntityPayload }>>(`/giftcards/${id}/payment-intent`, { method: 'POST', body: JSON.stringify(data) }),
  showIntent: (id: number, intentId: number) =>
    request<ApiResponse<{ intent?: EntityPayload }>>(`/giftcards/${id}/payment-intent/${intentId}`),
  cancelIntent: (id: number, intentId: number) =>
    request<ApiResponse<{ intent?: EntityPayload }>>(`/giftcards/${id}/payment-intent/${intentId}/cancel`, { method: 'POST' }),
  publicBinding: (code: string) =>
    request<ApiResponse<{ binding?: EntityPayload | null }>>(`/public/giftcards/${encodeURIComponent(code)}/binding`),
  publicSendOtp: (code: string, action: 'unbind' | 'disable') =>
    request<ApiResponse<EntityPayload>>(`/public/giftcards/${encodeURIComponent(code)}/binding/otp`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  publicUnbind: (code: string, otp: string) =>
    request<ApiResponse<EntityPayload>>(`/public/giftcards/${encodeURIComponent(code)}/binding`, {
      method: 'DELETE',
      body: JSON.stringify({ otp }),
    }),
  publicDisable: (code: string, otp: string) =>
    request<ApiResponse<EntityPayload>>(`/public/giftcards/${encodeURIComponent(code)}/disable`, {
      method: 'POST',
      body: JSON.stringify({ otp }),
    }),
};

const expenseEndpoints = {
  list: (page = 1, limit = 20) =>
    request<ApiResponse<EntityPayload>>(`/expenses?limit=${limit}&offset=${(page - 1) * limit}`),
  create: (data: ApiData) => request<ApiResponse>('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: number) => request<ApiResponse>(`/expenses/${id}`, { method: 'DELETE' }),
};

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<ApiResponse<AuthUserData>>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request<ApiResponse>('/auth/logout', { method: 'POST' }),
    me: () => request<ApiResponse<AuthUserData>>('/auth/me'),
  },
  dashboard: {
    stats: () => request<ApiResponse<DashboardStats>>('/dashboard/stats'),
  },
  items: {
    list: (page = 1, limit = 20, search = '') =>
      request<ApiResponse<{ items?: Item[] }>>(`/items?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`),
    get: (id: number) => request<ApiResponse<Item>>(`/items/${id}`),
    create: (data: ApiData) => request<ApiResponse>('/items', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ApiData) => request<ApiResponse>(`/items/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<ApiResponse>(`/items/${id}`, { method: 'DELETE' }),
  },
  itemKits: {
    list: (page = 1, limit = 50, search = '') =>
      request<ApiResponse<{ item_kits?: EntityList; pagination?: { total: number } }>>(
        `/item-kits?limit=${limit}&offset=${(page - 1) * limit}&search=${encodeURIComponent(search)}`,
      ),
    get: (id: number) =>
      request<ApiResponse<{ item_kit: EntityPayload; items: EntityList }>>(`/item-kits/${id}`),
    create: (data: ApiData) =>
      request<ApiResponse<{ item_kit: EntityPayload; items: EntityList }>>('/item-kits', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: number, data: ApiData) =>
      request<ApiResponse<{ item_kit: EntityPayload; items: EntityList }>>(`/item-kits/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: number) =>
      request<ApiResponse<{ item_kit_id: number }>>(`/item-kits/${id}`, { method: 'DELETE' }),
  },
  customers: {
    list: (page = 1, limit = 20, search = '') =>
      request<ApiResponse<{ customers?: Customer[] }>>(`/customers?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}`),
    get: (id: number) => request<ApiResponse<Customer>>(`/customers/${id}`),
    create: (data: ApiData) => request<ApiResponse>('/customers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: ApiData) => request<ApiResponse>(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: number) => request<ApiResponse>(`/customers/${id}`, { method: 'DELETE' }),
  },
  suppliers: supplierEndpoints,
  sales: {
    list: (page = 1, limit = 20) =>
      request<ApiResponse<{ sales?: EntityList }>>(`/sales?page=${page}&limit=${limit}`),
    get: (id: number) => request<ApiResponse>(`/sales/${id}`),
    create: (data: ApiData) =>
      request<ApiResponse<EntityPayload>>('/sales', { method: 'POST', body: JSON.stringify(data) }),
  },
  reports: {
    list: () => request<ApiResponse<{ stats?: EntityList }>>('/reports'),
  },
  receivings: {
    list: () => request<ApiResponse<{ receivings?: EntityList }>>('/receivings'),
  },
  giftcards: giftCardEndpoints,
  giftCards: giftCardEndpoints,
  messages: {
    list: () => request<ApiResponse<{ messages?: EntityList }>>('/messages'),
  },
  expenses: expenseEndpoints,
  cashups: {
    list: () => request<ApiResponse<{ cashups?: EntityList; open?: Record<string, unknown> | null }>>('/cashups'),
    get: (id: number) => request<ApiResponse<{ cashup?: Record<string, unknown> }>>(`/cashups/${id}`),
    open: (data: ApiData) =>
      request<ApiResponse<{ cashup?: Record<string, unknown> }>>('/cashups', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    close: (id: number, data: ApiData) =>
      request<ApiResponse<{ cashup?: Record<string, unknown> }>>(`/cashups/${id}/close`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: number) => request<ApiResponse>(`/cashups/${id}`, { method: 'DELETE' }),
  },
  office: {
    settings: () => request<ApiResponse>('/office/settings'),
  },
  config: {
    get: () => request<ApiResponse<ConfigData>>('/config'),
    save: (data: ConfigData) => request<ApiResponse>('/config', { method: 'POST', body: JSON.stringify(data) }),
  },
  ai: {
    chat: (message: string) =>
      request<ApiResponse<{ response: string }>>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ message }),
      }),
  },
  /**
   * Public endpoints — no auth required. Used by customer-facing mobile
   * pages (/menu/:tableId) and cached aggressively by the PWA service
   * worker (per-tableId, customer-safe fields only).
   */
  public: {
    menu: (tableId: string) =>
      request<ApiResponse<{ table_id: string; items: Array<{ item_id: number; name: string; category: string; unit_price: number; description: string; available: boolean }> }>>(
        `/public/menu/${encodeURIComponent(tableId)}`,
      ),
  },
  tickets: {
    products: {
      list: (page = 1, limit = 50, search = '', subtype = '') =>
        request<ApiResponse<EntityPayload>>(
          `/ticket-products?limit=${limit}&offset=${(page - 1) * limit}&search=${encodeURIComponent(search)}&subtype=${encodeURIComponent(subtype)}`,
        ),
      get: (id: number) =>
        request<ApiResponse<EntityPayload>>(`/ticket-products/${id}`),
      create: (data: ApiData) =>
        request<ApiResponse<EntityPayload>>('/ticket-products', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, data: ApiData) =>
        request<ApiResponse<EntityPayload>>(`/ticket-products/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: number) =>
        request<ApiResponse<EntityPayload>>(`/ticket-products/${id}`, { method: 'DELETE' }),
      sessions: {
        list: (productId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/sessions`),
        get: (productId: number, sessionId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/sessions/${sessionId}`),
        create: (productId: number, data: ApiData) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/sessions`, { method: 'POST', body: JSON.stringify(data) }),
        update: (productId: number, sessionId: number, data: ApiData) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/sessions/${sessionId}`, { method: 'PUT', body: JSON.stringify(data) }),
        delete: (productId: number, sessionId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/sessions/${sessionId}`, { method: 'DELETE' }),
      },
      tiers: {
        list: (productId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/tiers`),
        get: (productId: number, tierId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/tiers/${tierId}`),
        create: (productId: number, data: ApiData) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/tiers`, { method: 'POST', body: JSON.stringify(data) }),
        update: (productId: number, tierId: number, data: ApiData) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/tiers/${tierId}`, { method: 'PUT', body: JSON.stringify(data) }),
        delete: (productId: number, tierId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/tiers/${tierId}`, { method: 'DELETE' }),
      },
      bundles: {
        list: (productId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/bundles`),
        create: (productId: number, data: ApiData) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/bundles`, { method: 'POST', body: JSON.stringify(data) }),
        delete: (productId: number, bundleId: number) =>
          request<ApiResponse<EntityPayload>>(`/ticket-products/${productId}/bundles/${bundleId}`, { method: 'DELETE' }),
      },
    },
    list: (page = 1, limit = 50, productId = 0, status = '', customerId = 0) =>
      request<ApiResponse<EntityPayload>>(
        `/tickets?limit=${limit}&offset=${(page - 1) * limit}&ticket_product_id=${productId}&status=${encodeURIComponent(status)}&customer_id=${customerId}`,
      ),
    get: (id: number) =>
      request<ApiResponse<EntityPayload>>(`/tickets/${id}`),
    issue: (data: ApiData) =>
      request<ApiResponse<EntityPayload>>('/tickets', { method: 'POST', body: JSON.stringify(data) }),
    redeem: (data: ApiData) =>
      request<ApiResponse<EntityPayload>>('/tickets/redeem', { method: 'POST', body: JSON.stringify(data) }),
    revoke: (id: number, data: ApiData) =>
      request<ApiResponse<EntityPayload>>(`/tickets/${id}/revoke`, { method: 'POST', body: JSON.stringify(data) }),
    refund: (id: number, data: ApiData) =>
      request<ApiResponse<EntityPayload>>(`/tickets/${id}/refund`, { method: 'POST', body: JSON.stringify(data) }),
    assign: (id: number, data: ApiData) =>
      request<ApiResponse<EntityPayload>>(`/tickets/${id}/assign`, { method: 'PUT', body: JSON.stringify(data) }),
    qr: (id: number) =>
      request<ApiResponse<EntityPayload>>(`/tickets/${id}/qr`),
    publicLookup: (code: string) =>
      request<ApiResponse<EntityPayload>>(`/public/tickets/${encodeURIComponent(code)}`),
    transferRequest: (code: string, data: ApiData) =>
      request<ApiResponse<EntityPayload>>(`/public/tickets/${encodeURIComponent(code)}/transfer/request`, { method: 'POST', body: JSON.stringify(data) }),
    transferConfirm: (code: string, data: ApiData) =>
      request<ApiResponse<EntityPayload>>(`/public/tickets/${encodeURIComponent(code)}/transfer/confirm`, { method: 'POST', body: JSON.stringify(data) }),
    scannerDevices: {
      list: () => request<ApiResponse<EntityPayload>>('/tickets/scanner-devices'),
      create: (data: ApiData) =>
        request<ApiResponse<EntityPayload>>('/tickets/scanner-devices', { method: 'POST', body: JSON.stringify(data) }),
      revoke: (id: number, data: ApiData) =>
        request<ApiResponse<EntityPayload>>(`/tickets/scanner-devices/${id}/revoke`, { method: 'POST', body: JSON.stringify(data) }),
    },
    dashboard: (productId = 0, sessionId = 0) =>
      request<ApiResponse<EntityPayload>>(`/tickets/dashboard?ticket_product_id=${productId}&session_id=${sessionId}`),
    bulkIssue: (data: ApiData) =>
      request<ApiResponse<EntityPayload>>('/tickets/bulk-issue', { method: 'POST', body: JSON.stringify(data) }),
    resendDelivery: (id: number, data: ApiData) =>
      request<ApiResponse<EntityPayload>>(`/tickets/${id}/resend-delivery`, { method: 'POST', body: JSON.stringify(data) }),
    promos: {
      list: () => request<ApiResponse<EntityPayload>>('/ticket-promos'),
      create: (data: ApiData) => request<ApiResponse<EntityPayload>>('/ticket-promos', { method: 'POST', body: JSON.stringify(data) }),
      update: (id: number, data: ApiData) => request<ApiResponse<EntityPayload>>(`/ticket-promos/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
      delete: (id: number) => request<ApiResponse<EntityPayload>>(`/ticket-promos/${id}`, { method: 'DELETE' }),
      validate: (data: ApiData) => request<ApiResponse<EntityPayload>>('/ticket-promos/validate', { method: 'POST', body: JSON.stringify(data) }),
    },
    seatHolds: {
      create: (data: ApiData) => request<ApiResponse<EntityPayload>>('/seat-holds', { method: 'POST', body: JSON.stringify(data) }),
      release: (data: ApiData) => request<ApiResponse<EntityPayload>>('/seat-holds/release', { method: 'POST', body: JSON.stringify(data) }),
    },
    reports: {
      sales: (from?: string, to?: string) =>
        request<ApiResponse<EntityPayload>>(`/reports/tickets/sales${from || to ? '?' : ''}${from ? `from=${encodeURIComponent(from)}` : ''}${from && to ? '&' : ''}${to ? `to=${encodeURIComponent(to)}` : ''}`),
      redemptions: (from?: string, to?: string) =>
        request<ApiResponse<EntityPayload>>(`/reports/tickets/redemptions${from || to ? '?' : ''}${from ? `from=${encodeURIComponent(from)}` : ''}${from && to ? '&' : ''}${to ? `to=${encodeURIComponent(to)}` : ''}`),
      noShows: () => request<ApiResponse<EntityPayload>>('/reports/tickets/no-shows'),
    },
  },
};
