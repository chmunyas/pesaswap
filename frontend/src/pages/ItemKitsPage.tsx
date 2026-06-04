import { useEffect, useMemo, useState } from 'react';
import { Boxes, Plus, Search, Tag } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';

interface KitItem {
  name: string;
  quantity: number;
}

interface ItemKitRecord {
  item_kit_id: number;
  name: string;
  category: string;
  items: KitItem[];
  individual_total: number;
  kit_price: number;
}

const MOCK_KITS: ItemKitRecord[] = [
  {
    item_kit_id: 1,
    name: 'Breakfast Bundle',
    category: 'Morning Special',
    items: [
      { name: 'Cappuccino', quantity: 1 },
      { name: 'Croissant', quantity: 1 },
      { name: 'Fresh Juice', quantity: 1 },
    ],
    individual_total: 13.75,
    kit_price: 11.5,
  },
  {
    item_kit_id: 2,
    name: 'Coffee + Pastry Combo',
    category: 'Quick Grab',
    items: [
      { name: 'Latte', quantity: 1 },
      { name: 'Blueberry Muffin', quantity: 1 },
    ],
    individual_total: 7.75,
    kit_price: 6.5,
  },
  {
    item_kit_id: 3,
    name: 'Team Lunch Set',
    category: 'Office Catering',
    items: [
      { name: 'Turkey Sandwich', quantity: 4 },
      { name: 'Sparkling Water', quantity: 4 },
      { name: 'Cookie Box', quantity: 1 },
    ],
    individual_total: 54.6,
    kit_price: 47,
  },
  {
    item_kit_id: 4,
    name: 'Tea Break Duo',
    category: 'Afternoon Pick',
    items: [
      { name: 'Green Tea', quantity: 2 },
      { name: 'Chocolate Cookie', quantity: 2 },
    ],
    individual_total: 10.8,
    kit_price: 9.2,
  },
  {
    item_kit_id: 5,
    name: 'Weekend Brunch Crate',
    category: 'Seasonal',
    items: [
      { name: 'Bagel', quantity: 2 },
      { name: 'Cream Cheese', quantity: 2 },
      { name: 'Iced Latte', quantity: 2 },
      { name: 'Fruit Cup', quantity: 2 },
    ],
    individual_total: 28.4,
    kit_price: 24,
  },
];

function normalizeItemKit(raw: Record<string, unknown>): ItemKitRecord {
  const items = Array.isArray(raw.items)
    ? raw.items
        .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
        .map((item) => ({
          name: String(item.name ?? 'Included item'),
          quantity: Number(item.quantity ?? 1),
        }))
    : [];

  return {
    item_kit_id: Number(raw.item_kit_id ?? raw.id ?? 0),
    name: String(raw.name ?? 'Untitled kit'),
    category: String(raw.category ?? 'General'),
    items,
    individual_total: Number(raw.individual_total ?? 0),
    kit_price: Number(raw.kit_price ?? 0),
  };
}

export function ItemKitsPage() {
  const [kits, setKits] = useState<ItemKitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    api.itemKits.list()
      .then((res) => {
        const payload = Array.isArray(res.data.item_kits)
          ? res.data.item_kits.filter((kit): kit is Record<string, unknown> => typeof kit === 'object' && kit !== null)
          : [];

        setKits(payload.length > 0 ? payload.map(normalizeItemKit) : MOCK_KITS);
      })
      .catch(() => setKits(MOCK_KITS))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(() => ['all', ...new Set(kits.map((kit) => kit.category))], [kits]);

  const filteredKits = useMemo(() => {
    const query = search.toLowerCase();

    return kits.filter((kit) => {
      const matchesSearch = kit.name.toLowerCase().includes(query) || kit.items.some((item) => item.name.toLowerCase().includes(query));
      const matchesCategory = category === 'all' || kit.category === category;
      return matchesSearch && matchesCategory;
    });
  }, [category, kits, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Item Kits</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Bundle high-performing products into irresistible combos and catering sets.</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
          <Plus className="h-4 w-4" />
          Create Kit
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_minmax(180px,240px)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search kits or included products..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            {categories.map((option) => (
              <option key={option} value={option}>
                {option === 'all' ? 'All categories' : option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredKits.map((kit) => {
            const discountPercentage = Math.round(((kit.individual_total - kit.kit_price) / kit.individual_total) * 100);

            return (
              <div key={kit.item_kit_id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{kit.category}</div>
                    <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">{kit.name}</h2>
                  </div>
                  <div className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                    <Boxes className="h-5 w-5" />
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  {kit.items.map((item) => (
                    <div key={`${kit.item_kit_id}-${item.name}`} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/60">
                      <span className="text-gray-700 dark:text-gray-200">{item.name}</span>
                      <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-gray-600 shadow-sm dark:bg-gray-800 dark:text-gray-300">x{item.quantity}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900 dark:bg-emerald-900/10">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Kit price</span>
                    <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(kit.kit_price)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-gray-500 dark:text-gray-400">Individual total</span>
                    <span className="font-medium text-gray-700 line-through dark:text-gray-300">{formatCurrency(kit.individual_total)}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    <Tag className="h-4 w-4" />
                    Save {discountPercentage}% with bundle pricing
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
