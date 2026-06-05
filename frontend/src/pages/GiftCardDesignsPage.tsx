/**
 * GiftCardDesignsPage — admin CRUD for gift-card visual templates (skins).
 *
 * Each design is a gradient (from/to hex) + accent + text color + lucide
 * icon. New gift cards pick a design at issue time; old cards keep the
 * design they were issued with even if the admin later edits the template
 * (the design table is rendered live, but server-side validation prevents
 * orphan references).
 *
 * Reachable from the Office sidebar group.
 */

import { useEffect, useState, type FormEvent } from 'react';
import {
  Award,
  Cake,
  Coffee,
  Cookie,
  Crown,
  Diamond,
  Flower2,
  Gift,
  Heart,
  Music4,
  Palette,
  PartyPopper,
  Pencil,
  Pizza,
  Plus,
  Sparkles,
  Star,
  Trash2,
  TreePine,
  Trophy,
  Wand2,
} from 'lucide-react';
import { Modal } from '../components/ui/Modal';
import { showToast } from '../components/ui/Toast';
import { api } from '../lib/api';

interface Design {
  design_id: number;
  name: string;
  background_from: string;
  background_to: string;
  accent_color: string;
  text_color: string;
  image_url: string | null;
  icon: string | null;
  active: boolean;
  sort_order: number;
}

const DESIGN_ICONS: Record<string, typeof Gift> = {
  Gift, Sparkles, TreePine, Cake, Star, Heart,
  PartyPopper, Cookie, Flower2, Music4, Coffee, Pizza,
  Award, Crown, Diamond, Trophy, Wand2,
};
const ICON_NAMES = Object.keys(DESIGN_ICONS);

function designIcon(name: string | null): typeof Gift {
  if (!name) return Gift;
  return DESIGN_ICONS[name] ?? Gift;
}

function normalize(raw: Record<string, unknown>): Design {
  return {
    design_id: Number(raw.design_id ?? 0),
    name: String(raw.name ?? ''),
    background_from: String(raw.background_from ?? '#3B82F6'),
    background_to: String(raw.background_to ?? '#8B5CF6'),
    accent_color: String(raw.accent_color ?? '#FFFFFF'),
    text_color: String(raw.text_color ?? '#FFFFFF'),
    image_url: (raw.image_url as string | null) ?? null,
    icon: (raw.icon as string | null) ?? null,
    active: Boolean(raw.active),
    sort_order: Number(raw.sort_order ?? 0),
  };
}

const EMPTY: Design = {
  design_id: 0,
  name: '',
  background_from: '#3B82F6',
  background_to: '#8B5CF6',
  accent_color: '#FFFFFF',
  text_color: '#FFFFFF',
  image_url: null,
  icon: 'Gift',
  active: true,
  sort_order: 0,
};

export function GiftCardDesignsPage() {
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Design | null>(null);
  const [deleting, setDeleting] = useState<Design | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await api.giftcards.designs.list();
      const list = Array.isArray(res.data?.designs) ? res.data!.designs : [];
      setDesigns(list.map((r) => normalize(r as Record<string, unknown>)));
    } catch {
      showToast('Failed to load designs', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (!editing.name.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: editing.name,
        background_from: editing.background_from,
        background_to: editing.background_to,
        accent_color: editing.accent_color,
        text_color: editing.text_color,
        image_url: editing.image_url,
        icon: editing.icon,
        active: editing.active,
        sort_order: editing.sort_order,
      };
      if (editing.design_id > 0) {
        await api.giftcards.designs.update(editing.design_id, payload);
        showToast('Design updated');
      } else {
        await api.giftcards.designs.create(payload);
        showToast('Design created');
      }
      setEditing(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.giftcards.designs.delete(deleting.design_id);
      showToast('Design removed');
      setDeleting(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white">
            <Palette className="h-6 w-6" /> Gift Card Designs
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Visual templates pickable when issuing a gift card. Existing cards keep their original design.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY })}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-600"
        >
          <Plus className="h-4 w-4" /> New Design
        </button>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-500" />
        </div>
      ) : designs.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 text-center dark:border-gray-700 dark:bg-gray-800/50">
          <Palette className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600" />
          <p className="mt-3 text-sm text-gray-500">No designs yet — add one to enable card skins.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {designs.map((d) => {
            const Icon = designIcon(d.icon);
            return (
              <div key={d.design_id} className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div
                  className="flex h-28 items-center justify-center"
                  style={{ backgroundImage: `linear-gradient(135deg, ${d.background_from}, ${d.background_to})`, color: d.text_color }}
                >
                  <Icon className="h-10 w-10 opacity-95" />
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{d.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
                      {d.background_from} → {d.background_to}
                      {!d.active && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">inactive</span>}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setEditing(d)} aria-label="Edit" className="rounded-lg border border-gray-200 bg-white p-1.5 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800">
                      <Pencil className="h-3.5 w-3.5 text-gray-600 dark:text-gray-300" />
                    </button>
                    <button type="button" onClick={() => setDeleting(d)} aria-label="Delete" className="rounded-lg border border-rose-200 bg-white p-1.5 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:bg-gray-900 dark:text-rose-300 dark:hover:bg-rose-900/20">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal isOpen={editing !== null} onClose={() => !busy && setEditing(null)} title={editing && editing.design_id > 0 ? 'Edit design' : 'New design'} size="lg">
        {editing && (
          <form onSubmit={save} className="space-y-4">
            <Field label="Name" required>
              <input
                required
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Background from">
                <input type="color" value={editing.background_from} onChange={(e) => setEditing({ ...editing, background_from: e.target.value.toUpperCase() })} className="h-10 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" />
                <p className="mt-1 font-mono text-[10px] text-gray-500">{editing.background_from}</p>
              </Field>
              <Field label="Background to">
                <input type="color" value={editing.background_to} onChange={(e) => setEditing({ ...editing, background_to: e.target.value.toUpperCase() })} className="h-10 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" />
                <p className="mt-1 font-mono text-[10px] text-gray-500">{editing.background_to}</p>
              </Field>
              <Field label="Accent color">
                <input type="color" value={editing.accent_color} onChange={(e) => setEditing({ ...editing, accent_color: e.target.value.toUpperCase() })} className="h-10 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" />
              </Field>
              <Field label="Text color">
                <input type="color" value={editing.text_color} onChange={(e) => setEditing({ ...editing, text_color: e.target.value.toUpperCase() })} className="h-10 w-full rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" />
              </Field>
            </div>

            <Field label="Icon">
              <div className="grid grid-cols-6 gap-1.5">
                {ICON_NAMES.map((name) => {
                  const I = designIcon(name);
                  const selected = editing.icon === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setEditing({ ...editing, icon: name })}
                      title={name}
                      className={`flex aspect-square items-center justify-center rounded-lg border ${selected ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/40' : 'border-gray-200 hover:border-gray-300 dark:border-gray-700'}`}
                    >
                      <I className="h-4 w-4 text-gray-700 dark:text-gray-200" />
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Sort order">
              <input
                type="number"
                value={editing.sort_order}
                onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm md:max-w-[8rem] dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} />
              Active (available for new cards)
            </label>

            <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-gray-500">Preview</p>
              <div
                className="flex h-28 items-center justify-center rounded-lg"
                style={{ backgroundImage: `linear-gradient(135deg, ${editing.background_from}, ${editing.background_to})`, color: editing.text_color }}
              >
                {(() => { const I = designIcon(editing.icon); return <I className="h-10 w-10 opacity-95" />; })()}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
              <button type="button" onClick={() => !busy && setEditing(null)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={deleting !== null} onClose={() => setDeleting(null)} title="Remove design" size="sm">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              Remove the <span className="font-semibold">{deleting.name}</span> design? Cards already issued with this design will continue to render correctly.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleting(null)} className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">Cancel</button>
              <button type="button" onClick={remove} disabled={busy} className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60">Remove</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300">
      <span className="mb-1 inline-block">{label}{required && <span className="ml-0.5 text-rose-500">*</span>}</span>
      {children}
    </label>
  );
}
