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
  list: (page = 1, limit = 20) =>
    request<ApiResponse<EntityPayload>>(`/giftcards?limit=${limit}&offset=${(page - 1) * limit}`),
  create: (data: ApiData) => request<ApiResponse>('/giftcards', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: number) => request<ApiResponse>(`/giftcards/${id}`, { method: 'DELETE' }),
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
    list: () => request<ApiResponse<{ item_kits?: EntityList }>>('/item-kits'),
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
    list: () => request<ApiResponse<{ cashups?: EntityList }>>('/cashups'),
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
};
