import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Calculator, Globe, Mail, Palette, Receipt, Settings, Store } from 'lucide-react';
import { api } from '../lib/api';
import { showToast } from '../components/ui/Toast';

type ConfigMap = Record<string, string>;
type FieldType = 'text' | 'number' | 'email' | 'textarea' | 'select' | 'toggle';

interface SelectOption {
  value: string;
  label: string;
}

interface ConfigField {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  options?: SelectOption[];
}

interface SettingsTab {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  fields: ConfigField[];
}

const THEME_OPTIONS: SelectOption[] = [
  'cerulean', 'cosmo', 'cyborg', 'darkly', 'flatly', 'journal', 'litera', 'lumen', 'lux', 'materia', 'minty', 'morph', 'pulse', 'quartz', 'sandstone', 'simplex', 'sketchy', 'slate', 'solar', 'spacelab', 'superhero', 'united', 'vapor', 'yeti', 'zephyr',
].map((theme) => ({ value: theme, label: theme.charAt(0).toUpperCase() + theme.slice(1) }));

const SETTINGS_TABS: SettingsTab[] = [
  {
    id: 'store-info',
    label: 'Store Info',
    icon: Store,
    description: 'Store identity and contact details shown across receipts and communications.',
    fields: [
      { key: 'company', label: 'Company Name', type: 'text', placeholder: 'Acme Retail' },
      { key: 'address', label: 'Address', type: 'text', placeholder: '123 Main Street' },
      { key: 'phone', label: 'Phone', type: 'text', placeholder: '+1 (555) 555-5555' },
      { key: 'email', label: 'Email', type: 'email', placeholder: 'store@example.com' },
      { key: 'tax_id', label: 'Tax ID', type: 'text', placeholder: 'TAX-001' },
      { key: 'account_number', label: 'Account Number', type: 'text', placeholder: '1234567890' },
      { key: 'return_policy', label: 'Return Policy', type: 'textarea', placeholder: 'Returns accepted within 30 days with receipt.' },
    ],
  },
  {
    id: 'general',
    label: 'General',
    icon: Settings,
    description: 'Sales defaults, page density, notification placement, and quantity precision.',
    fields: [
      { key: 'default_sales_discount', label: 'Default Sales Discount %', type: 'number' },
      { key: 'default_sales_discount_type', label: 'Discount Type', type: 'select', options: [{ value: '0', label: 'Fixed' }, { value: '1', label: 'Percent' }] },
      { key: 'lines_per_page', label: 'Lines Per Page', type: 'number' },
      { key: 'notify_horizontal_position', label: 'Notification Position H', type: 'select', options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }] },
      { key: 'notify_vertical_position', label: 'Notification Position V', type: 'select', options: [{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }] },
      { key: 'cash_decimals', label: 'Cash Decimals', type: 'number' },
      { key: 'cash_rounding_code', label: 'Cash Rounding', type: 'select', options: [{ value: '0', label: 'None' }, { value: '1', label: 'Round Up' }, { value: '2', label: 'Round Down' }, { value: '3', label: 'Round Half' }] },
      { key: 'quantity_decimals', label: 'Quantity Decimals', type: 'number' },
    ],
  },
  {
    id: 'locale',
    label: 'Locale',
    icon: Globe,
    description: 'Currency, language, date, time, and locale formatting preferences.',
    fields: [
      { key: 'currency_symbol', label: 'Currency Symbol', type: 'text', placeholder: '$' },
      { key: 'currency_code', label: 'Currency Code', type: 'text', placeholder: 'USD' },
      { key: 'currency_decimals', label: 'Currency Decimals', type: 'number' },
      { key: 'tax_decimals', label: 'Tax Decimals', type: 'number' },
      { key: 'language', label: 'Language', type: 'text', placeholder: 'english' },
      { key: 'language_code', label: 'Language Code', type: 'text', placeholder: 'en-US' },
      { key: 'dateformat', label: 'Date Format', type: 'select', options: [{ value: 'm/d/Y', label: 'm/d/Y' }, { value: 'd/m/Y', label: 'd/m/Y' }, { value: 'Y-m-d', label: 'Y-m-d' }] },
      { key: 'timeformat', label: 'Time Format', type: 'select', options: [{ value: 'H:i:s', label: 'H:i:s' }, { value: 'h:i:s A', label: 'h:i:s A' }] },
      { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'UTC' },
      { key: 'number_locale', label: 'Number Locale', type: 'text', placeholder: 'en-US' },
    ],
  },
  {
    id: 'tax',
    label: 'Tax',
    icon: Calculator,
    description: 'Configure default taxes, rates, and destination-based tax behavior.',
    fields: [
      { key: 'default_tax_rate', label: 'Default Tax Rate %', type: 'number' },
      { key: 'default_tax_1_name', label: 'Tax 1 Name', type: 'text', placeholder: 'VAT' },
      { key: 'default_tax_1_rate', label: 'Tax 1 Rate %', type: 'number' },
      { key: 'default_tax_2_name', label: 'Tax 2 Name', type: 'text', placeholder: 'Service Tax' },
      { key: 'default_tax_2_rate', label: 'Tax 2 Rate %', type: 'number' },
      { key: 'tax_included', label: 'Tax Included in Price', type: 'toggle' },
      { key: 'use_destination_based_tax', label: 'Use Destination-Based Tax', type: 'toggle' },
    ],
  },
  {
    id: 'receipt',
    label: 'Receipt',
    icon: Receipt,
    description: 'Tune the receipt layout, visibility toggles, and print behavior.',
    fields: [
      { key: 'receipt_template', label: 'Template', type: 'select', options: [{ value: 'receipt_default', label: 'Default' }, { value: 'receipt_short', label: 'Short' }] },
      { key: 'receipt_font_size', label: 'Font Size', type: 'number' },
      { key: 'receipt_show_company_name', label: 'Show Company Name', type: 'toggle' },
      { key: 'receipt_show_description', label: 'Show Description', type: 'toggle' },
      { key: 'receipt_show_serialnumber', label: 'Show Serial Number', type: 'toggle' },
      { key: 'receipt_show_taxes', label: 'Show Taxes', type: 'toggle' },
      { key: 'receipt_show_total_discount', label: 'Show Total Discount', type: 'toggle' },
      { key: 'print_receipt_check_behaviour', label: 'Print Receipt Behavior', type: 'select', options: [{ value: 'last', label: 'Last' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' }] },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    description: 'Mail delivery settings for invoices, notifications, and templates.',
    fields: [
      { key: 'protocol', label: 'Protocol', type: 'select', options: [{ value: 'smtp', label: 'SMTP' }, { value: 'sendmail', label: 'Sendmail' }, { value: 'mail', label: 'Mail' }] },
      { key: 'smtp_host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.example.com' },
      { key: 'smtp_port', label: 'SMTP Port', type: 'number' },
      { key: 'smtp_user', label: 'SMTP User', type: 'text', placeholder: 'username' },
      { key: 'smtp_pass', label: 'SMTP Password', type: 'text', placeholder: '••••••••' },
      { key: 'smtp_timeout', label: 'SMTP Timeout', type: 'number' },
      { key: 'invoice_email_message', label: 'Invoice Email Template', type: 'textarea', placeholder: 'Thank you for your purchase. Please find your invoice attached.' },
    ],
  },
  {
    id: 'theme',
    label: 'Theme',
    icon: Palette,
    description: 'Select the active Bootswatch theme for the frontend experience.',
    fields: [
      { key: 'theme', label: 'Theme', type: 'select', options: THEME_OPTIONS },
    ],
  },
];

const DEFAULT_CONFIG = SETTINGS_TABS.reduce<ConfigMap>((accumulator, tab) => {
  tab.fields.forEach((field) => {
    accumulator[field.key] = field.type === 'toggle' ? '0' : '';
  });
  return accumulator;
}, {});

function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
      <div>
        <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">{checked ? 'Enabled' : 'Disabled'}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(checked ? '0' : '1')}
        className={`relative inline-flex h-7 w-12 items-center rounded-full transition ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
}

function ConfigInput({ field, value, onChange }: { field: ConfigField; value: string; onChange: (key: string, value: string) => void }) {
  const baseClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

  if (field.type === 'toggle') {
    return <ToggleField label={field.label} checked={value === '1'} onChange={(nextValue) => onChange(field.key, nextValue)} />;
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{field.label}</label>
      {field.type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(field.key, event.target.value)}
          placeholder={field.placeholder}
          rows={4}
          className={baseClass}
        />
      ) : field.type === 'select' ? (
        <select value={value} onChange={(event) => onChange(field.key, event.target.value)} className={baseClass}>
          <option value="">Select...</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.type}
          value={value}
          onChange={(event) => onChange(field.key, event.target.value)}
          placeholder={field.placeholder}
          className={baseClass}
        />
      )}
    </div>
  );
}

export function OfficePage() {
  const [config, setConfig] = useState<ConfigMap>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<ConfigMap>(DEFAULT_CONFIG);
  const [changedFields, setChangedFields] = useState<ConfigMap>({});
  const [activeTab, setActiveTab] = useState<string>(SETTINGS_TABS[0].id);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await api.config.get();
        const nextConfig = { ...DEFAULT_CONFIG, ...response.data };
        setConfig(nextConfig);
        setSavedConfig(nextConfig);
      } catch {
        showToast('Failed to load settings', 'error');
      } finally {
        setLoading(false);
      }
    };

    void loadConfig();
  }, []);

  const activeTabConfig = useMemo(
    () => SETTINGS_TABS.find((tab) => tab.id === activeTab) ?? SETTINGS_TABS[0],
    [activeTab],
  );

  const unsavedCount = useMemo(
    () => activeTabConfig.fields.filter((field) => field.key in changedFields).length,
    [activeTabConfig, changedFields],
  );

  const handleFieldChange = (key: string, value: string) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setChangedFields((current) => {
      if (savedConfig[key] === value) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }

      return { ...current, [key]: value };
    });
  };

  const handleSave = async () => {
    const payload = activeTabConfig.fields.reduce<ConfigMap>((accumulator, field) => {
      if (field.key in changedFields) {
        accumulator[field.key] = config[field.key] ?? '';
      }
      return accumulator;
    }, {});

    if (Object.keys(payload).length === 0) {
      showToast('No changes to save');
      return;
    }

    setSaving(true);

    try {
      await api.config.save(payload);
      const nextSaved = { ...savedConfig, ...payload };
      setSavedConfig(nextSaved);
      setChangedFields((current) => {
        const rest = { ...current };
        Object.keys(payload).forEach((key) => {
          delete rest[key];
        });
        return rest;
      });
      showToast('Settings saved successfully');
    } catch {
      showToast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Manage store, receipt, locale, tax, email, and theme configuration.</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {Object.keys(changedFields).length} unsaved changes
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="space-y-2">
              {SETTINGS_TABS.map((tab) => {
                const Icon = tab.icon;
                const tabChanges = tab.fields.filter((field) => field.key in changedFields).length;
                const isActive = tab.id === activeTab;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left transition ${isActive ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700/60'}`}
                  >
                    <div className={`rounded-lg p-2 ${isActive ? 'bg-white/15 text-white' : 'bg-blue-500/10 text-blue-500'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium">{tab.label}</p>
                        {tabChanges > 0 && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isActive ? 'bg-white/15 text-white' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'}`}>
                            {tabChanges}
                          </span>
                        )}
                      </div>
                      <p className={`mt-1 text-xs ${isActive ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'}`}>{tab.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="border-b border-gray-200 px-6 py-5 dark:border-gray-700">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">{activeTabConfig.label}</h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{activeTabConfig.description}</p>
            </div>
            <div className="space-y-6 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                {activeTabConfig.fields.map((field) => (
                  <div key={field.key} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
                    <ConfigInput field={field} value={config[field.key] ?? ''} onChange={handleFieldChange} />
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3 border-t border-gray-200 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">{unsavedCount} unsaved fields in this section</p>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
