/**
 * CustomerMenuList — browseable menu with category filter, add-to-cart, and "goes with" suggestions.
 *
 * Ported from chmunyas/merchantApp (src/components/merchant/features/customer-menu-list.tsx).
 * Adapted to plain Tailwind (no shadcn Card/Badge/Button), and CatalogueItem typed locally.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';

export interface CatalogueItem {
  id: string;
  name: string;
  category: string;
  price: number;
  description?: string;
  image?: string;
  available?: boolean;
  dietary?: string[];
  modifiers?: Array<{ name: string; price?: number }>;
}

type CustomerMenuListProps = {
  items: CatalogueItem[];
  categoryOrder?: string[];
  readOnly?: boolean;
  itemQuantities?: Record<string, number>;
  onAddItem?: (item: CatalogueItem) => void;
  onRemoveItem?: (item: CatalogueItem) => void;
  getSuggestions?: (item: CatalogueItem) => CatalogueItem[];
  onAddSuggestedItem?: (item: CatalogueItem) => void;
  headerSlot?: ReactNode;
  emptyMessage?: string;
  currency?: string;
  className?: string;
};

export function CustomerMenuList({
  items,
  categoryOrder = [],
  readOnly = false,
  itemQuantities = {},
  onAddItem,
  onRemoveItem,
  getSuggestions,
  onAddSuggestedItem,
  headerSlot,
  emptyMessage = 'No dishes are available for this menu just now.',
  currency = 'KES',
  className,
}: CustomerMenuListProps) {
  const categories = useMemo(() => {
    const uniqueCategories = Array.from(
      new Set(items.map((item) => item.category).filter(Boolean)),
    );
    const orderIndex = new Map(
      categoryOrder.map((category, index) => [category, index]),
    );

    return [...uniqueCategories].sort((a, b) => {
      const aIndex = orderIndex.get(a);
      const bIndex = orderIndex.get(b);

      if (aIndex == null && bIndex == null) return a.localeCompare(b);
      if (aIndex == null) return 1;
      if (bIndex == null) return -1;
      return aIndex - bIndex;
    });
  }, [categoryOrder, items]);

  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  useEffect(() => {
    if (selectedCategory === 'All') return;
    if (!categories.includes(selectedCategory)) {
      setSelectedCategory(categories[0] ?? 'All');
    }
  }, [categories, selectedCategory]);

  const filteredItems = useMemo(() => {
    if (selectedCategory === 'All') return items;
    return items.filter((item) => item.category === selectedCategory);
  }, [items, selectedCategory]);

  const chipBase =
    'shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition';
  const chipActive = 'border-purple-500 bg-purple-600 text-white shadow-sm';
  const chipIdle =
    'border-slate-200 bg-white text-slate-600 hover:border-purple-200 hover:text-purple-600';

  return (
    <div className={`space-y-4 ${className ?? ''}`}>
      {headerSlot}

      <div className="flex gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={() => setSelectedCategory('All')}
          className={`${chipBase} ${selectedCategory === 'All' ? chipActive : chipIdle}`}
        >
          All
        </button>
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setSelectedCategory(category)}
            className={`${chipBase} ${selectedCategory === category ? chipActive : chipIdle}`}
          >
            {category}
          </button>
        ))}
      </div>

      {filteredItems.length ? (
        <div className="space-y-4">
          {filteredItems.map((item) => {
            const quantity = itemQuantities[item.id] ?? 0;
            const suggestions =
              quantity > 0 ? (getSuggestions?.(item) ?? []) : [];
            const cardOpacity = item.available === false ? 'opacity-70' : '';

            return (
              <div
                key={item.id}
                className={`overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm ${cardOpacity}`}
              >
                <div className="p-0">
                  <div className="flex gap-4 p-4">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-slate-100">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl text-slate-400">
                          🍽️
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-slate-900">
                              {item.name}
                            </h3>
                            {item.available === false ? (
                              <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                Sold out
                              </span>
                            ) : null}
                            {item.modifiers?.length ? (
                              <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                Customisable
                              </span>
                            ) : null}
                          </div>
                          {item.description ? (
                            <p className="mt-1 text-sm text-slate-500">
                              {item.description}
                            </p>
                          ) : null}
                        </div>
                        <div className="text-right">
                          <p className="text-base font-semibold text-slate-900">
                            {currency} {item.price.toFixed(0)}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          {item.category}
                        </span>
                        {item.dietary?.map((dietaryTag) => (
                          <span
                            key={`${item.id}-${dietaryTag}`}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"
                          >
                            {dietaryTag}
                          </span>
                        ))}
                      </div>

                      {!readOnly ? (
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-slate-500">
                            {item.available === false
                              ? 'Temporarily unavailable'
                              : item.modifiers?.length
                                ? 'Choose options after tapping add'
                                : 'Tap add to include in your cart'}
                          </div>
                          <div className="flex items-center gap-2">
                            {quantity > 0 ? (
                              <button
                                type="button"
                                onClick={() => onRemoveItem?.(item)}
                                className="h-8 rounded-full border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                −
                              </button>
                            ) : null}
                            {quantity > 0 ? (
                              <span className="min-w-6 text-center text-sm font-semibold text-slate-700">
                                {quantity}
                              </span>
                            ) : null}
                            <button
                              type="button"
                              disabled={item.available === false}
                              onClick={() => onAddItem?.(item)}
                              className="h-8 rounded-full bg-purple-600 px-4 text-sm font-semibold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Add
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {!readOnly && suggestions.length ? (
                    <div className="border-t border-slate-100 bg-gradient-to-r from-purple-50 via-indigo-50 to-sky-50 px-4 py-3">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-purple-600">
                        Goes well with...
                      </p>
                      <div className="flex gap-3 overflow-x-auto pb-1">
                        {suggestions.slice(0, 3).map((suggestion) => (
                          <div
                            key={`${item.id}-${suggestion.id}`}
                            className="w-44 shrink-0 rounded-2xl border border-white/60 bg-white/90 p-3 shadow-sm"
                          >
                            <div className="mb-3 flex items-center gap-3">
                              <div className="h-12 w-12 overflow-hidden rounded-xl bg-slate-100">
                                {suggestion.image ? (
                                  <img
                                    src={suggestion.image}
                                    alt={suggestion.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-slate-400">
                                    ✨
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {suggestion.name}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {currency} {suggestion.price.toFixed(0)}
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={suggestion.available === false}
                              onClick={() => onAddSuggestedItem?.(suggestion)}
                              className="w-full rounded-full bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Add
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 px-4 py-10 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
      )}
    </div>
  );
}
