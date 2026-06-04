import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { Search, Plus, Package, Edit, Trash2 } from 'lucide-react';

interface ItemData {
  item_id: number;
  name: string;
  category: string;
  cost_price: number;
  unit_price: number;
  quantity: number;
  description: string;
}

const MOCK_ITEMS: ItemData[] = [
  { item_id: 1, name: 'Espresso', category: 'Beverages', cost_price: 1.50, unit_price: 3.50, quantity: 200, description: 'Classic espresso shot' },
  { item_id: 2, name: 'Latte', category: 'Beverages', cost_price: 2.00, unit_price: 4.50, quantity: 150, description: 'Espresso with steamed milk' },
  { item_id: 3, name: 'Croissant', category: 'Pastries', cost_price: 1.20, unit_price: 3.00, quantity: 8, description: 'Butter croissant' },
  { item_id: 4, name: 'Sandwich', category: 'Food', cost_price: 3.00, unit_price: 7.50, quantity: 45, description: 'Ham & cheese sandwich' },
  { item_id: 5, name: 'Cookie', category: 'Pastries', cost_price: 0.80, unit_price: 2.50, quantity: 120, description: 'Chocolate chip cookie' },
  { item_id: 6, name: 'Cappuccino', category: 'Beverages', cost_price: 1.80, unit_price: 4.00, quantity: 180, description: 'Espresso with foam' },
  { item_id: 7, name: 'Muffin', category: 'Pastries', cost_price: 1.00, unit_price: 3.25, quantity: 55, description: 'Blueberry muffin' },
  { item_id: 8, name: 'Green Tea', category: 'Beverages', cost_price: 0.50, unit_price: 2.75, quantity: 95, description: 'Organic green tea' },
];

export function InventoryPage() {
  const [items, setItems] = useState<ItemData[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api.items.list(1, 50, search)
      .then(res => { if (res.success) setItems(res.data.items || []); })
      .catch(() => setItems(MOCK_ITEMS))
      .finally(() => setLoading(false));
  }, [search]);

  const filteredItems = items.filter(item => {
    if (filter === 'low_stock') return item.quantity < 20;
    if (filter !== 'all') return item.category.toLowerCase() === filter;
    return true;
  });

  const categories = [...new Set(items.map(i => i.category))];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Inventory</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{items.length} items in stock</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition shadow-sm">
          <Plus className="h-4 w-4" />
          Add Item
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search items..."
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <button
            onClick={() => setFilter('all')}
            className={`rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition ${filter === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            All
          </button>
          <button
            onClick={() => setFilter('low_stock')}
            className={`rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition ${filter === 'low_stock' ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >
            ⚠️ Low Stock
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat.toLowerCase())}
              className={`rounded-lg px-3 py-2 text-xs font-medium whitespace-nowrap transition ${filter === cat.toLowerCase() ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Items Grid */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredItems.map(item => (
            <div
              key={item.item_id}
              className="rounded-xl border bg-white dark:bg-gray-800 p-5 shadow-sm hover:shadow-md transition-shadow group"
            >
              <div className="flex items-start justify-between">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <Package className="h-5 w-5 text-blue-500" />
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="rounded-md p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700">
                    <Edit className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                  <button className="rounded-md p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20">
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </button>
                </div>
              </div>
              <h3 className="mt-3 font-medium text-gray-900 dark:text-white">{item.name}</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.category}</p>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(item.unit_price)}</span>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  item.quantity < 20
                    ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
                    : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                }`}>
                  {item.quantity} in stock
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
