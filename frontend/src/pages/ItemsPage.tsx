import { useEffect, useMemo, useState } from 'react';
import { Package, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { showToast } from '../components/ui/Toast';
import { BulkImportModal } from '../components/bulk/BulkImportModal';
import { BULK_SCHEMAS } from '../components/bulk/schemas';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';

interface ItemRecord {
  item_id: number;
  name: string;
  category: string;
  cost_price: number;
  unit_price: number;
  quantity: number;
  description: string;
  item_number: string;
}

interface ItemFormState {
  name: string;
  category: string;
  cost_price: string;
  unit_price: string;
  description: string;
  item_number: string;
  quantity: string;
}

const EMPTY_FORM: ItemFormState = {
  name: '',
  category: '',
  cost_price: '0',
  unit_price: '0',
  description: '',
  item_number: '',
  quantity: '0',
};

const MOCK_ITEMS: ItemRecord[] = [
  { item_id: 1, name: 'Espresso Beans 1kg', item_number: 'BEAN-ESP-001', category: 'Coffee', cost_price: 12.5, unit_price: 22, quantity: 42, description: 'Signature roast beans for espresso drinks.' },
  { item_id: 2, name: 'Whole Milk 1L', item_number: 'DAIRY-MILK-010', category: 'Dairy', cost_price: 1.4, unit_price: 2.8, quantity: 110, description: 'Fresh whole milk for drinks and prep.' },
  { item_id: 3, name: 'Croissant', item_number: 'PASTRY-CRO-021', category: 'Bakery', cost_price: 1.1, unit_price: 3.5, quantity: 18, description: 'Butter croissant baked fresh daily.' },
  { item_id: 4, name: 'Turkey Sandwich', item_number: 'FOOD-SAND-040', category: 'Food', cost_price: 3.75, unit_price: 8.9, quantity: 26, description: 'Grab-and-go sandwich with turkey and greens.' },
  { item_id: 5, name: 'Blueberry Muffin', item_number: 'PASTRY-MUF-018', category: 'Bakery', cost_price: 1.05, unit_price: 3.25, quantity: 34, description: 'Moist blueberry muffin with crumble topping.' },
  { item_id: 6, name: 'Matcha Powder', item_number: 'TEA-MAT-006', category: 'Tea', cost_price: 8.2, unit_price: 15.75, quantity: 15, description: 'Ceremonial grade matcha for lattes.' },
];

function normalizeItem(input: Record<string, unknown>): ItemRecord {
  return {
    item_id: Number(input.item_id ?? input.id ?? 0),
    name: String(input.name ?? 'Unnamed Item'),
    category: String(input.category ?? 'General'),
    cost_price: Number(input.cost_price ?? 0),
    unit_price: Number(input.unit_price ?? 0),
    quantity: Number(input.quantity ?? 0),
    description: String(input.description ?? 'No description available.'),
    item_number: String(input.item_number ?? input.sku ?? `SKU-${input.item_id ?? '000'}`),
  };
}

function toFormState(item?: ItemRecord): ItemFormState {
  if (!item) {
    return EMPTY_FORM;
  }

  return {
    name: item.name,
    category: item.category,
    cost_price: String(item.cost_price),
    unit_price: String(item.unit_price),
    description: item.description,
    item_number: item.item_number,
    quantity: String(item.quantity),
  };
}

export function ItemsPage() {
  const [items, setItems] = useState<ItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ItemRecord | null>(null);
  const [editingItem, setEditingItem] = useState<ItemRecord | null>(null);
  const [form, setForm] = useState<ItemFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [usingMockData, setUsingMockData] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);

  const loadItems = async () => {
    try {
      const response = await api.items.list(1, 100, search);
      const payload = Array.isArray(response.data.items) ? response.data.items : [];

      if (payload.length > 0) {
        setItems(payload.map((item) => normalizeItem(item as unknown as Record<string, unknown>)));
        setUsingMockData(false);
      } else {
        setItems(MOCK_ITEMS);
        setUsingMockData(true);
      }
    } catch {
      setItems(MOCK_ITEMS);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadItems();
  }, [search]);

  const categories = useMemo(() => ['all', ...new Set(items.map((item) => item.category))], [items]);

  const filteredItems = useMemo(() => {
    const query = search.toLowerCase();

    return items.filter((item) => {
      const matchesSearch = [item.name, item.item_number, item.description].some((value) => value.toLowerCase().includes(query));
      const matchesCategory = category === 'all' || item.category === category;
      return matchesSearch && matchesCategory;
    });
  }, [category, items, search]);

  const handleFormChange = (name: string, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const openCreateModal = () => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (item: ItemRecord) => {
    setEditingItem(item);
    setForm(toFormState(item));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setIsModalOpen(false);
    setEditingItem(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      showToast('Item name is required', 'error');
      return;
    }

    const payload = {
      name: form.name.trim(),
      category: form.category.trim(),
      cost_price: Number(form.cost_price) || 0,
      unit_price: Number(form.unit_price) || 0,
      description: form.description.trim(),
      item_number: form.item_number.trim(),
      sku: form.item_number.trim(),
      quantity: Number(form.quantity) || 0,
    };

    setSubmitting(true);

    try {
      if (usingMockData) {
        if (editingItem) {
          setItems((current) => current.map((item) => (item.item_id === editingItem.item_id ? { ...item, ...payload } : item)));
          showToast('Item updated locally');
        } else {
          setItems((current) => [{ item_id: Math.max(0, ...current.map((item) => item.item_id)) + 1, ...payload }, ...current]);
          showToast('Item added locally');
        }
      } else {
        if (editingItem) {
          await api.items.update(editingItem.item_id, payload);
          showToast('Item updated successfully');
        } else {
          await api.items.create(payload);
          showToast('Item created successfully');
        }
        await loadItems();
      }

      closeModal();
    } catch {
      showToast(`Failed to ${editingItem ? 'update' : 'create'} item`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;

    setSubmitting(true);

    try {
      if (usingMockData) {
        setItems((current) => current.filter((item) => item.item_id !== itemToDelete.item_id));
        showToast('Item deleted locally');
      } else {
        await api.items.delete(itemToDelete.item_id);
        await loadItems();
        showToast('Item deleted successfully');
      }

      setItemToDelete(null);
    } catch {
      showToast('Failed to delete item', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Items</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage your catalog, pricing, and stock quantities from one place.</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowBulkImport(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
          >
            <Plus className="h-4 w-4" />
            Add Item
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="grid gap-3 lg:grid-cols-[1.6fr_minmax(180px,240px)]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by item name, SKU, or description..."
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
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-700">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2 text-blue-500">
                <Package className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Catalog overview</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">{filteredItems.length} items available {usingMockData ? '(mock data)' : ''}</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-900/60">
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Cost Price</th>
                  <th className="px-4 py-3">Unit Price</th>
                  <th className="px-4 py-3">Quantity</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm dark:divide-gray-700">
                {filteredItems.map((item) => (
                  <tr key={item.item_id} className="transition hover:bg-gray-50/80 dark:hover:bg-gray-900/40">
                    <td className="px-4 py-4">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{item.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{item.description}</div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-300">{item.item_number}</td>
                    <td className="px-4 py-4">
                      <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{item.category || 'General'}</span>
                    </td>
                    <td className="px-4 py-4 font-medium text-gray-900 dark:text-white">{formatCurrency(item.cost_price)}</td>
                    <td className="px-4 py-4 font-semibold text-gray-900 dark:text-white">{formatCurrency(item.unit_price)}</td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${item.quantity <= 20 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                        {item.quantity} units
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(item)}
                          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-700 dark:hover:text-blue-400"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setItemToDelete(item)}
                          className="rounded-lg p-2 text-gray-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingItem ? 'Edit Item' : 'Add Item'} size="lg">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Name" name="name" value={form.name} onChange={handleFormChange} required />
            <FormField label="Category" name="category" value={form.category} onChange={handleFormChange} />
            <FormField label="Cost Price" name="cost_price" value={form.cost_price} onChange={handleFormChange} type="number" />
            <FormField label="Unit Price" name="unit_price" value={form.unit_price} onChange={handleFormChange} type="number" />
            <FormField label="Item Number / SKU" name="item_number" value={form.item_number} onChange={handleFormChange} />
            <FormField label="Quantity" name="quantity" value={form.quantity} onChange={handleFormChange} type="number" />
            <div className="md:col-span-2">
              <FormField label="Description" name="description" value={form.description} onChange={handleFormChange} type="textarea" />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={closeModal} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-70">
              {submitting ? 'Saving...' : editingItem ? 'Save Changes' : 'Create Item'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={itemToDelete !== null} onClose={() => setItemToDelete(null)} title="Delete Item" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">{itemToDelete?.name}</span>?</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setItemToDelete(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleDelete} disabled={submitting} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600 disabled:opacity-70">
              {submitting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>

      <BulkImportModal
        isOpen={showBulkImport}
        onClose={() => setShowBulkImport(false)}
        {...BULK_SCHEMAS.items}
        onDone={async () => { await loadItems(); }}
      />
    </div>
  );
}
