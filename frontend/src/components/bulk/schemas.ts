/**
 * Bulk-import schemas + sample rows for each entity.
 */

export interface BulkImportSchema {
  endpoint: string;
  entityLabel: string;
  templateColumns: string[];
  sampleRow: Record<string, unknown>;
  wrapBody?: (rows: Record<string, unknown>[]) => Record<string, unknown>;
}

export const BULK_SCHEMAS: Record<string, BulkImportSchema> = {
  items: {
    endpoint: '/api/items/bulk',
    entityLabel: 'items',
    templateColumns: ['item_number', 'name', 'category', 'unit_price', 'cost_price', 'tax_percent', 'quantity', 'description'],
    sampleRow: { item_number: 'SKU-001', name: 'Espresso', category: 'Coffee', unit_price: 3.50, cost_price: 0.80, tax_percent: 16, quantity: 100, description: 'Double shot' },
  },
  customers: {
    endpoint: '/api/customers/bulk',
    entityLabel: 'customers',
    templateColumns: ['first_name', 'last_name', 'email', 'phone_number', 'address_1', 'city', 'country'],
    sampleRow: { first_name: 'Alice', last_name: 'Demo', email: 'alice@example.com', phone_number: '+254712345678', address_1: '123 Main St', city: 'Nairobi', country: 'Kenya' },
  },
  suppliers: {
    endpoint: '/api/suppliers/bulk',
    entityLabel: 'suppliers',
    templateColumns: ['company_name', 'first_name', 'last_name', 'email', 'phone_number', 'address_1', 'city', 'country', 'account_number'],
    sampleRow: { company_name: 'Acme Coffee Ltd', first_name: 'Jane', last_name: 'Doe', email: 'orders@acme.com', phone_number: '+254700111222', address_1: '99 Industrial Park', city: 'Nairobi', country: 'Kenya', account_number: 'ACME-9001' },
  },
  itemKits: {
    endpoint: '/api/item-kits/bulk',
    entityLabel: 'item kits',
    templateColumns: ['name', 'description', 'kit_discount', 'kit_discount_type'],
    sampleRow: { name: 'Breakfast Combo', description: '2 espressos + 1 croissant', kit_discount: 10, kit_discount_type: 1 },
  },
  giftcards: {
    endpoint: '/api/giftcards/bulk-issue',
    entityLabel: 'gift cards',
    templateColumns: ['value', 'currency', 'recipient_name', 'recipient_email', 'sender_name', 'message', 'expires_in_days'],
    sampleRow: { value: 1000, currency: 'KES', recipient_name: 'Alice', recipient_email: 'alice@example.com', sender_name: 'The Team', message: 'Happy birthday!', expires_in_days: 365 },
  },
  dinnerTables: {
    endpoint: '/api/dinner-tables/bulk',
    entityLabel: 'dinner tables',
    templateColumns: ['name'],
    sampleRow: { name: 'T-1' },
  },
  expenses: {
    endpoint: '/api/expenses/bulk',
    entityLabel: 'expenses',
    templateColumns: ['date', 'amount', 'payment_type', 'description', 'expense_category_id', 'supplier_id', 'tax_amount'],
    sampleRow: { date: '2026-06-01', amount: 150.00, payment_type: 'cash', description: 'Office stationery', expense_category_id: 1, supplier_id: '', tax_amount: 16 },
  },
  ticketProducts: {
    endpoint: '/api/ticket-products/bulk',
    entityLabel: 'ticket products',
    templateColumns: ['title', 'brand_name', 'subtype', 'color', 'item_id'],
    sampleRow: { title: 'Saturday Movie', brand_name: 'Cinemax', subtype: 'movie', color: '#a855f7', item_id: 1 },
  },
  ticketPromos: {
    endpoint: '/api/ticket-promos/bulk',
    entityLabel: 'ticket promos',
    templateColumns: ['code', 'description', 'discount_pct', 'discount_flat', 'max_uses', 'expires_at'],
    sampleRow: { code: 'EARLYBIRD25', description: '25% off', discount_pct: 25, discount_flat: '', max_uses: 200, expires_at: '2026-12-31 23:59:00' },
  },
};
