import { useEffect, useMemo, useState } from 'react';
import { Building2, Mail, MapPin, Pencil, Phone, Plus, Search, Trash2, Upload, User } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { showToast } from '../components/ui/Toast';
import { BulkImportModal } from '../components/bulk/BulkImportModal';
import { BULK_SCHEMAS } from '../components/bulk/schemas';
import { api } from '../lib/api';

interface SupplierRecord {
  supplier_id: number;
  company_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  items_supplied: number;
  status: 'Active' | 'Inactive';
}

interface SupplierFormState {
  company_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

const EMPTY_FORM: SupplierFormState = {
  company_name: '',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zip: '',
};

const MOCK_SUPPLIERS: SupplierRecord[] = [
  { supplier_id: 1, company_name: 'Blue Ridge Roasters', first_name: 'Nina', last_name: 'Patel', email: 'orders@blueridge.example', phone: '(555) 101-4400', address: '245 Market Street', city: 'Denver', state: 'CO', zip: '80202', items_supplied: 18, status: 'Active' },
  { supplier_id: 2, company_name: 'FreshFields Dairy', first_name: 'Tom', last_name: 'Alvarez', email: 'dispatch@freshfields.example', phone: '(555) 101-4401', address: '93 Westlake Drive', city: 'Boise', state: 'ID', zip: '83702', items_supplied: 9, status: 'Active' },
  { supplier_id: 3, company_name: 'Golden Crust Bakery', first_name: 'Marta', last_name: 'Silva', email: 'sales@goldencrust.example', phone: '(555) 101-4402', address: '18 Olive Avenue', city: 'Portland', state: 'OR', zip: '97204', items_supplied: 14, status: 'Active' },
  { supplier_id: 4, company_name: 'Leaf & Bean Traders', first_name: 'Jacob', last_name: 'Kim', email: 'support@leafbean.example', phone: '(555) 101-4403', address: '66 Harbour Road', city: 'Seattle', state: 'WA', zip: '98101', items_supplied: 11, status: 'Active' },
  { supplier_id: 5, company_name: 'Urban Deli Supply', first_name: 'Fatima', last_name: 'Omar', email: 'hello@urbandeli.example', phone: '(555) 101-4404', address: '227 Pine Street', city: 'Austin', state: 'TX', zip: '73301', items_supplied: 7, status: 'Inactive' },
  { supplier_id: 6, company_name: 'Cafe Essentials Ltd', first_name: 'Leo', last_name: 'Grant', email: 'warehouse@cafeessentials.example', phone: '(555) 101-4405', address: '5 Riverfront Blvd', city: 'Nashville', state: 'TN', zip: '37201', items_supplied: 22, status: 'Active' },
];

function normalizeSupplier(raw: Record<string, unknown>): SupplierRecord {
  return {
    supplier_id: Number(raw.supplier_id ?? raw.person_id ?? raw.id ?? 0),
    company_name: String(raw.company_name ?? raw.company ?? 'Supplier'),
    first_name: String(raw.first_name ?? raw.contact_first_name ?? ''),
    last_name: String(raw.last_name ?? raw.contact_last_name ?? ''),
    email: String(raw.email ?? ''),
    phone: String(raw.phone ?? raw.phone_number ?? ''),
    address: String(raw.address ?? ''),
    city: String(raw.city ?? ''),
    state: String(raw.state ?? ''),
    zip: String(raw.zip ?? raw.zip_code ?? ''),
    items_supplied: Number(raw.items_supplied ?? 0),
    status: String(raw.status ?? 'Active') === 'Inactive' ? 'Inactive' : 'Active',
  };
}

function toFormState(supplier?: SupplierRecord): SupplierFormState {
  if (!supplier) {
    return EMPTY_FORM;
  }

  return {
    company_name: supplier.company_name,
    first_name: supplier.first_name,
    last_name: supplier.last_name,
    email: supplier.email,
    phone: supplier.phone,
    address: supplier.address,
    city: supplier.city,
    state: supplier.state,
    zip: supplier.zip,
  };
}

export function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [usingMockData, setUsingMockData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRecord | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<SupplierRecord | null>(null);
  const [form, setForm] = useState<SupplierFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);

  const loadSuppliers = async () => {
    try {
      const response = await api.suppliers.list(1, 100, search);
      const source = Array.isArray(response.data.suppliers)
        ? response.data.suppliers
        : Array.isArray(response.data.data)
          ? response.data.data
          : Array.isArray(response.data)
            ? response.data
            : [];
      const payload = source.filter((supplier): supplier is Record<string, unknown> => typeof supplier === 'object' && supplier !== null);

      if (payload.length > 0) {
        setSuppliers(payload.map(normalizeSupplier));
        setUsingMockData(false);
      } else {
        setSuppliers(MOCK_SUPPLIERS);
        setUsingMockData(true);
      }
    } catch {
      setSuppliers(MOCK_SUPPLIERS);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSuppliers();
  }, [search]);

  const filteredSuppliers = useMemo(() => {
    const query = search.toLowerCase();

    return suppliers.filter((supplier) => {
      const matchesSearch = [supplier.company_name, supplier.first_name, supplier.last_name, supplier.email]
        .some((value) => value.toLowerCase().includes(query));
      const matchesStatus = status === 'all' || supplier.status === status;
      return matchesSearch && matchesStatus;
    });
  }, [search, status, suppliers]);

  const activeCount = suppliers.filter((supplier) => supplier.status === 'Active').length;

  const handleFormChange = (name: string, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const openCreateModal = () => {
    setEditingSupplier(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (supplier: SupplierRecord) => {
    setEditingSupplier(supplier);
    setForm(toFormState(supplier));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setIsModalOpen(false);
    setEditingSupplier(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    if (!form.company_name.trim()) {
      showToast('Company name is required', 'error');
      return;
    }

    const payload = {
      company_name: form.company_name.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      zip: form.zip.trim(),
    };

    setSubmitting(true);

    try {
      if (usingMockData) {
        if (editingSupplier) {
          setSuppliers((current) => current.map((supplier) => (supplier.supplier_id === editingSupplier.supplier_id ? { ...supplier, ...payload } : supplier)));
          showToast('Supplier updated locally');
        } else {
          setSuppliers((current) => [{ supplier_id: Math.max(0, ...current.map((supplier) => supplier.supplier_id)) + 1, items_supplied: 0, status: 'Active', ...payload }, ...current]);
          showToast('Supplier added locally');
        }
      } else {
        if (editingSupplier) {
          await api.suppliers.update(editingSupplier.supplier_id, payload);
          showToast('Supplier updated successfully');
        } else {
          await api.suppliers.create(payload);
          showToast('Supplier created successfully');
        }
        await loadSuppliers();
      }

      closeModal();
    } catch {
      showToast(`Failed to ${editingSupplier ? 'update' : 'create'} supplier`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!supplierToDelete) return;

    setSubmitting(true);

    try {
      if (usingMockData) {
        setSuppliers((current) => current.filter((supplier) => supplier.supplier_id !== supplierToDelete.supplier_id));
        showToast('Supplier deleted locally');
      } else {
        await api.suppliers.delete(supplierToDelete.supplier_id);
        await loadSuppliers();
        showToast('Supplier deleted successfully');
      }

      setSupplierToDelete(null);
    } catch {
      showToast('Failed to delete supplier', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Suppliers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage purchasing partners and primary supplier contacts.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowBulkImport(true)} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">
            <Upload className="h-4 w-4" />
            Import CSV
          </button>
          <button type="button" onClick={openCreateModal} className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600">
            <Plus className="h-4 w-4" />
            Add Supplier
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.5fr_repeat(2,minmax(0,1fr))]">
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search suppliers, contacts, or email..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-9 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
            />
          </div>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400">Active suppliers</p>
          <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">{activeCount}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
          >
            <option value="all">All status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredSuppliers.map((supplier) => (
            <div key={supplier.supplier_id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-blue-500/10 p-3 text-blue-500">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-gray-900 dark:text-white">{supplier.company_name}</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{supplier.items_supplied} items supplied</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${supplier.status === 'Active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'}`}>
                    {supplier.status}
                  </span>
                  <button type="button" onClick={() => openEditModal(supplier)} className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-700 dark:hover:text-blue-400">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setSupplierToDelete(supplier)} className="rounded-lg p-2 text-gray-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm text-gray-600 dark:text-gray-300">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <span>{[supplier.first_name, supplier.last_name].filter(Boolean).join(' ') || 'No contact name'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <span>{supplier.phone || 'No phone'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-gray-400" />
                  <span>{supplier.email || 'No email'}</span>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4 text-gray-400" />
                  <span>{[supplier.address, supplier.city, supplier.state, supplier.zip].filter(Boolean).join(', ') || 'No address available'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingSupplier ? 'Edit Supplier' : 'Add Supplier'} size="lg">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Company Name" name="company_name" value={form.company_name} onChange={handleFormChange} required />
            <FormField label="First Name" name="first_name" value={form.first_name} onChange={handleFormChange} />
            <FormField label="Last Name" name="last_name" value={form.last_name} onChange={handleFormChange} />
            <FormField label="Email" name="email" value={form.email} onChange={handleFormChange} type="email" />
            <FormField label="Phone" name="phone" value={form.phone} onChange={handleFormChange} />
            <FormField label="Address" name="address" value={form.address} onChange={handleFormChange} />
            <FormField label="City" name="city" value={form.city} onChange={handleFormChange} />
            <FormField label="State" name="state" value={form.state} onChange={handleFormChange} />
            <FormField label="Zip" name="zip" value={form.zip} onChange={handleFormChange} />
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={closeModal} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-70">
              {submitting ? 'Saving...' : editingSupplier ? 'Save Changes' : 'Create Supplier'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={supplierToDelete !== null} onClose={() => setSupplierToDelete(null)} title="Delete Supplier" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">{supplierToDelete?.company_name}</span>?</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setSupplierToDelete(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
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
        {...BULK_SCHEMAS.suppliers}
        onDone={async () => { await loadSuppliers(); }}
      />
    </div>
  );
}
