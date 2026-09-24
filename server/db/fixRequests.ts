// Fix requests, and the design memory built from them.
//
// Design memory is per POS style name ("ATTACHED CHAIN POTE"), not per
// ProductId: a ProductId in this store is a style-and-size bucket - 1516 alone
// covers 307 different lots, each its own design - so an approved photo of one
// lot is a different piece, and handing it to the image model as a reference
// would invite it to copy the wrong design. What does carry over between
// pieces of a style is the MISTAKES: if the model keeps turning this style's
// black beads gold, the next piece of it should be warned up front.
//
// So the memory is lessons, not pictures: every fix staff ask for, every
// reason given for a reshoot, and every fidelity failure the audit catches is
// recorded against the style, and the ones that recur are added to the next
// enhance prompt for that style.

import { getDb, newId, nowIso } from './index';
import { FIX_OPTIONS, cleanNote, fixOption } from '../catalog/fixes';
import { resolveCategory } from '../catalog/taxonomy';

export type FixSource = 'staff' | 'reject' | 'audit';

export function styleKey(itemType: string): string {
  return String(itemType || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function recordFixRequest(input: {
  productId: string;
  itemType: string;
  issues: string[];
  note?: string;
  source: FixSource;
  createdBy?: string | null;
}): void {
  const issues = [...new Set(input.issues.filter((c) => fixOption(c)))];
  const note = cleanNote(input.note);
  if (issues.length === 0 && !note) return;
  getDb()
    .prepare(
      `INSERT INTO fix_requests (id, product_id, style_key, category, issues, note, source, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      newId('fix'),
      input.productId,
      styleKey(input.itemType),
      resolveCategory(input.itemType)?.type ?? '',
      JSON.stringify(issues),
      note,
      input.source,
      input.createdBy ?? null,
      nowIso()
    );
}

// How far back memory looks, and how often a problem must recur before it is
// worth prompt space on every future piece of the style.
const MEMORY_DAYS = 120;
const MIN_OCCURRENCES = 2;
const MAX_LESSONS = 4;
const MAX_NOTES = 2;
// Below this many records for the exact style, the category's history is
// used instead - a new style name should still benefit from what its category
// has taught.
const MIN_STYLE_RECORDS = 3;

interface FixRow { issues: string; note: string; source: FixSource; product_id: string }

export interface DesignMemory {
  scope: 'style' | 'category' | 'none';
  lessons: { code: string; count: number; text: string }[];
  notes: string[];
}

export function designMemoryFor(itemType: string, excludeProductId?: string): DesignMemory {
  const since = new Date(Date.now() - MEMORY_DAYS * 86_400_000).toISOString();
  const db = getDb();
  const query = (column: 'style_key' | 'category', value: string) =>
    db
      .prepare(
        `SELECT issues, note, source, product_id FROM fix_requests
          WHERE ${column} = ? AND created_at >= ? AND product_id != ?
          ORDER BY created_at DESC LIMIT 500`
      )
      .all(value, since, excludeProductId ?? '') as FixRow[];

  const key = styleKey(itemType);
  let rows = key ? query('style_key', key) : [];
  let scope: DesignMemory['scope'] = 'style';
  if (rows.length < MIN_STYLE_RECORDS) {
    const category = resolveCategory(itemType)?.type;
    if (category) {
      rows = query('category', category);
      scope = 'category';
    }
  }
  if (rows.length === 0) return { scope: 'none', lessons: [], notes: [] };

  // A problem counts once per piece, however many times it was flagged on it,
  // so one stubborn piece cannot dominate the style's memory.
  const piecesByCode = new Map<string, Set<string>>();
  for (const row of rows) {
    let issues: string[] = [];
    try { issues = JSON.parse(row.issues); } catch { /* skip */ }
    for (const code of issues) {
      if (!piecesByCode.has(code)) piecesByCode.set(code, new Set());
      piecesByCode.get(code)!.add(row.product_id);
    }
  }
  const order = new Map(FIX_OPTIONS.map((f, i) => [f.code, i]));
  const lessons = [...piecesByCode.entries()]
    .map(([code, pieces]) => ({ code, count: pieces.size, text: fixOption(code)?.lesson ?? '' }))
    .filter((l) => l.text && l.count >= MIN_OCCURRENCES)
    .sort((a, b) => b.count - a.count || (order.get(a.code)! - order.get(b.code)!))
    .slice(0, MAX_LESSONS);

  // Staff notes only from staff, and only for the exact style - a note about
  // one style's clasp means nothing for another's.
  const notes = scope === 'style'
    ? [...new Set(rows.filter((r) => r.source !== 'audit' && r.note).map((r) => r.note))].slice(0, MAX_NOTES)
    : [];

  return { scope, lessons, notes };
}

export function buildDesignMemoryBlock(itemType: string, memory: DesignMemory): string {
  if (memory.lessons.length === 0 && memory.notes.length === 0) return '';
  const what = memory.scope === 'style' ? `pieces of this style ("${itemType.trim()}")` : 'pieces of this type';
  return `

LESSONS FROM EARLIER PHOTOS (design memory):
On earlier ${what} at this store, these mistakes were made and had to be corrected. Get them right first time:
${memory.lessons.map((l) => `- ${l.text} (${l.count} pieces)`).join('\n')}${memory.notes.map((n) => `\n- Staff note from an earlier piece: "${n}"`).join('')}`;
}
