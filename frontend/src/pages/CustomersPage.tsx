import { useEffect, useMemo, useState } from 'react';
import { Crown, Mail, MapPin, Pencil, Phone, Plus, Search, Trash2, TrendingUp } from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { FormField } from '../components/ui/FormField';
import { showToast } from '../components/ui/Toast';
import { api } from '../lib/api';
import { formatCurrency } from '../lib/utils';
import { getTier, getTierClasses, getProgressToNextTier } from '../lib/loyalty';

interface CustomerRecord {
  person_id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  comments: string;
  total_spent: number;
  last_visit: string;
}

interface CustomerFormState {
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  comments: string;
}

const EMPTY_FORM: CustomerFormState = {
  first_name: '',
  last_name: '',
  email: '',
  phone_number: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  comments: '',
};

const MOCK_CUSTOMERS: CustomerRecord[] = [
  { person_id: 1, first_name: 'Sarah', last_name: 'Johnson', email: 'sarah@email.com', phone_number: '555-0101', address: '123 Main Street', city: 'Denver', state: 'CO', zip: '80202', comments: 'VIP regular customer', total_spent: 2487.5, last_visit: '2026-05-31' },
  { person_id: 2, first_name: 'Mike', last_name: 'Chen', email: 'mike@email.com', phone_number: '555-0102', address: '45 River Road', city: 'Boulder', state: 'CO', zip: '80301', comments: 'Prefers email receipts', total_spent: 1842, last_visit: '2026-06-01' },
  { person_id: 3, first_name: 'Emma', last_name: 'Wilson', email: 'emma@email.com', phone_number: '555-0103', address: '78 Pine Avenue', city: 'Aurora', state: 'CO', zip: '80012', comments: 'Frequent bulk buyer', total_spent: 1598.75, last_visit: '2026-05-28' },
  { person_id: 4, first_name: 'James', last_name: 'Brown', email: 'james@email.com', phone_number: '555-0104', address: '16 Hillcrest Lane', city: 'Lakewood', state: 'CO', zip: '80214', comments: 'Corporate account', total_spent: 1245, last_visit: '2026-06-02' },
  { person_id: 5, first_name: 'Olivia', last_name: 'Davis', email: 'olivia@email.com', phone_number: '555-0105', address: '9 Elm Street', city: 'Englewood', state: 'CO', zip: '80110', comments: 'Birthday club member', total_spent: 987.25, last_visit: '2026-05-30' },
  { person_id: 6, first_name: 'Daniel', last_name: 'Martinez', email: 'daniel@email.com', phone_number: '555-0106', address: '200 Market Plaza', city: 'Denver', state: 'CO', zip: '80205', comments: 'Weekend customer', total_spent: 756.5, last_visit: '2026-05-25' },
];

function normalizeCustomer(input: Record<string, unknown>): CustomerRecord {
  return {
    person_id: Number(input.person_id ?? input.id ?? 0),
    first_name: String(input.first_name ?? ''),
    last_name: String(input.last_name ?? ''),
    email: String(input.email ?? ''),
    phone_number: String(input.phone_number ?? input.phone ?? ''),
    address: String(input.address ?? ''),
    city: String(input.city ?? ''),
    state: String(input.state ?? ''),
    zip: String(input.zip ?? input.zip_code ?? ''),
    comments: String(input.comments ?? ''),
    total_spent: Number(input.total_spent ?? 0),
    last_visit: String(input.last_visit ?? new Date().toISOString()),
  };
}

function toFormState(customer?: CustomerRecord): CustomerFormState {
  if (!customer) {
    return EMPTY_FORM;
  }

  return {
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone_number: customer.phone_number,
    address: customer.address,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    comments: customer.comments,
  };
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [usingMockData, setUsingMockData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerRecord | null>(null);
  const [customerToDelete, setCustomerToDelete] = useState<CustomerRecord | null>(null);
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  const loadCustomers = async () => {
    try {
      const response = await api.customers.list(1, 50, search);
      const payload = Array.isArray(response.data.customers) ? response.data.customers : [];

      if (payload.length > 0) {
        setCustomers(payload.map((customer) => normalizeCustomer(customer as unknown as Record<string, unknown>)));
        setUsingMockData(false);
      } else {
        setCustomers(MOCK_CUSTOMERS);
        setUsingMockData(true);
      }
    } catch {
      setCustomers(MOCK_CUSTOMERS);
      setUsingMockData(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCustomers();
  }, [search]);

  const filteredCustomers = useMemo(() => {
    const query = search.toLowerCase();

    return customers.filter((customer) =>
      [customer.first_name, customer.last_name, customer.email, customer.phone_number]
        .some((value) => value.toLowerCase().includes(query)),
    );
  }, [customers, search]);

  const handleFormChange = (name: string, value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
  };

  const openCreateModal = () => {
    setEditingCustomer(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  };

  const openEditModal = (customer: CustomerRecord) => {
    setEditingCustomer(customer);
    setForm(toFormState(customer));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (submitting) return;
    setIsModalOpen(false);
    setEditingCustomer(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async () => {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      showToast('First and last name are required', 'error');
      return;
    }

    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone_number: form.phone_number.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      zip: form.zip.trim(),
      comments: form.comments.trim(),
    };

    setSubmitting(true);

    try {
      if (usingMockData) {
        if (editingCustomer) {
          setCustomers((current) => current.map((customer) => (customer.person_id === editingCustomer.person_id ? { ...customer, ...payload } : customer)));
          showToast('Customer updated locally');
        } else {
          setCustomers((current) => [{ person_id: Math.max(0, ...current.map((customer) => customer.person_id)) + 1, total_spent: 0, last_visit: new Date().toISOString(), ...payload }, ...current]);
          showToast('Customer added locally');
        }
      } else {
        if (editingCustomer) {
          await api.customers.update(editingCustomer.person_id, payload);
          showToast('Customer updated successfully');
        } else {
          await api.customers.create(payload);
          showToast('Customer created successfully');
        }
        await loadCustomers();
      }

      closeModal();
    } catch {
      showToast(`Failed to ${editingCustomer ? 'update' : 'create'} customer`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!customerToDelete) return;

    setSubmitting(true);

    try {
      if (usingMockData) {
        setCustomers((current) => current.filter((customer) => customer.person_id !== customerToDelete.person_id));
        showToast('Customer deleted locally');
      } else {
        await api.customers.delete(customerToDelete.person_id);
        await loadCustomers();
        showToast('Customer deleted successfully');
      }

      setCustomerToDelete(null);
    } catch {
      showToast('Failed to delete customer', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Customers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{customers.length} registered customers {usingMockData ? '(mock data)' : ''}</p>
        </div>
        <button type="button" onClick={openCreateModal} className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-600 transition shadow-sm">
          <Plus className="h-4 w-4" />
          Add Customer
        </button>
      </div>

      <div className="relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <Search className="absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search customers by name, email, or phone..."
          className="w-full rounded-lg border border-gray-200 bg-white pl-10 pr-4 py-2.5 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCustomers.map((customer) => {
            const tier = getTier(customer.total_spent);
            const tierClasses = getTierClasses(tier);
            const progress = getProgressToNextTier(customer.total_spent);
            return (
            <div key={customer.person_id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-purple-500 text-sm font-medium text-white">
                    {customer.first_name[0]}{customer.last_name[0]}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-gray-900 dark:text-white">{customer.first_name} {customer.last_name}</h3>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide shadow-sm ${tierClasses.badge}`}
                        title={`Estimated loyalty tier · ${formatCurrency(customer.total_spent)} lifetime`}
                      >
                        <Crown className="h-3 w-3" />
                        {tier}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Last visit: {customer.last_visit}</p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => openEditModal(customer)} className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-700 dark:hover:text-blue-400">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setCustomerToDelete(customer)} className="rounded-lg p-2 text-gray-500 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-900/20 dark:hover:text-rose-400">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2 text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" />
                  {customer.email || 'No email'}
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  {customer.phone_number || 'No phone'}
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-3.5 w-3.5" />
                  <span>{[customer.address, customer.city, customer.state, customer.zip].filter(Boolean).join(', ') || 'No address provided'}</span>
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
                {customer.comments || 'No comments'}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-semibold text-gray-900 dark:text-white">{formatCurrency(customer.total_spent)}</span>
                </div>
                <span className="text-xs text-gray-400">lifetime value</span>
              </div>

              {progress.next && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400">
                    <span>
                      {formatCurrency(progress.remaining)} to <span className="font-semibold">{progress.next}</span>
                    </span>
                    <span>{Math.round(progress.pct)}%</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className={`h-1 rounded-full ${tierClasses.dot}`}
                      style={{ width: `${progress.pct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          );})}
        </div>
      )}

      <Modal isOpen={isModalOpen} onClose={closeModal} title={editingCustomer ? 'Edit Customer' : 'Add Customer'} size="lg">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="First Name" name="first_name" value={form.first_name} onChange={handleFormChange} required />
            <FormField label="Last Name" name="last_name" value={form.last_name} onChange={handleFormChange} required />
            <FormField label="Email" name="email" value={form.email} onChange={handleFormChange} type="email" />
            <FormField label="Phone" name="phone_number" value={form.phone_number} onChange={handleFormChange} />
            <FormField label="Address" name="address" value={form.address} onChange={handleFormChange} />
            <FormField label="City" name="city" value={form.city} onChange={handleFormChange} />
            <FormField label="State" name="state" value={form.state} onChange={handleFormChange} />
            <FormField label="Zip" name="zip" value={form.zip} onChange={handleFormChange} />
            <div className="md:col-span-2">
              <FormField label="Comments" name="comments" value={form.comments} onChange={handleFormChange} type="textarea" />
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
            <button type="button" onClick={closeModal} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} disabled={submitting} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-600 disabled:opacity-70">
              {submitting ? 'Saving...' : editingCustomer ? 'Save Changes' : 'Create Customer'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={customerToDelete !== null} onClose={() => setCustomerToDelete(null)} title="Delete Customer" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">Are you sure you want to delete <span className="font-semibold text-gray-900 dark:text-white">{customerToDelete?.first_name} {customerToDelete?.last_name}</span>?</p>
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setCustomerToDelete(null)} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button type="button" onClick={handleDelete} disabled={submitting} className="rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-600 disabled:opacity-70">
              {submitting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
