// Filtering the product list by category and weight - the Share tab's "Haars
// between 15 and 30 grams". Kept apart from the database code because a
// category is not a column: the POS names are messy ("FANCY HAR SET", "Har
// set", "rani haar") and only the taxonomy knows they are all a Haar.
import { CATEGORIES, resolveCategory } from './taxonomy';

export const OTHER_CATEGORY = 'Other';

export interface FilterRow {
  id: string;
  itemType: string;
  netWeightGrams: string;
  grossWeightGrams: string;
}

export interface ProductFilter {
  /** A category name, or whatever was typed ("har", "Haar", "jhumki"). */
  category?: string;
  minWeight?: number | null;
  maxWeight?: number | null;
}

/** The category a product belongs to, by the store's own vocabulary. */
export function categoryOf(itemType: string | undefined): string {
  return resolveCategory(itemType ?? '')?.type ?? OTHER_CATEGORY;
}

/** Net weight, or gross when no net was entered. Null when there is no usable number. */
export function weightOf(row: { netWeightGrams?: string; grossWeightGrams?: string }): number | null {
  for (const raw of [row.netWeightGrams, row.grossWeightGrams]) {
    const n = Number(String(raw ?? '').trim().replace(',', '.'));
    if (String(raw ?? '').trim() && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** A weight typed in a filter box ("15", "15.5", "15,5"); null when empty or not a number. */
export function parseWeightParam(value: unknown): number | null {
  const text = String(value ?? '').trim().replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** What a typed category means: the taxonomy's answer, else a plain "contains" on the item type. */
function resolveWanted(text: string): { type: string | null; contains: string } {
  const trimmed = text.trim();
  if (!trimmed) return { type: null, contains: '' };
  if (trimmed.toLowerCase() === OTHER_CATEGORY.toLowerCase()) return { type: OTHER_CATEGORY, contains: '' };
  // An exact canonical name wins ("Ring"), then the taxonomy ("rani har" -> Haar).
  const exact = CATEGORIES.find((c) => c.type.toLowerCase() === trimmed.toLowerCase());
  const type = exact?.type ?? resolveCategory(trimmed)?.type ?? null;
  return { type, contains: trimmed.toLowerCase() };
}

export function matchesFilter(row: FilterRow, filter: ProductFilter): boolean {
  if (filter.category?.trim()) {
    const wanted = resolveWanted(filter.category);
    const matches = wanted.type ? categoryOf(row.itemType) === wanted.type : row.itemType.toLowerCase().includes(wanted.contains);
    if (!matches) return false;
  }
  const hasMin = filter.minWeight !== null && filter.minWeight !== undefined;
  const hasMax = filter.maxWeight !== null && filter.maxWeight !== undefined;
  if (hasMin || hasMax) {
    const w = weightOf(row);
    // A piece with no weight cannot be said to be inside a range.
    if (w === null) return false;
    if (hasMin && w < (filter.minWeight as number)) return false;
    if (hasMax && w > (filter.maxWeight as number)) return false;
  }
  return true;
}

export interface CategoryOption {
  type: string;
  count: number;
  /** Other names staff type for it, so "har" finds Haar. */
  aliases: string[];
}

/** The categories present in these rows, most common first, with how many of each. */
export function categoryOptions(rows: { itemType: string }[]): CategoryOption[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(categoryOf(r.itemType), (counts.get(categoryOf(r.itemType)) ?? 0) + 1);
  return [...counts]
    .map(([type, count]) => ({ type, count, aliases: CATEGORIES.find((c) => c.type === type)?.synonyms ?? [] }))
    .sort((a, b) => (a.type === OTHER_CATEGORY ? 1 : b.type === OTHER_CATEGORY ? -1 : b.count - a.count || a.type.localeCompare(b.type)));
}
