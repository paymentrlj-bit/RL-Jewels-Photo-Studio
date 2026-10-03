// Quick design tags per category - "black beads", "patti", "meena" - that staff
// tap at capture time and the AI is told as hints. The list is learned: every
// approved photo adds what staff picked and what the AI saw to its category's
// vocabulary, and the most-approved tags are the ones suggested next time. The
// seed lists below only fill the gaps until real data outranks them.
import { getDb, nowIso } from '../db';
import { resolveCategory } from './taxonomy';

export const MAX_TAGS_PER_PRODUCT = 8;
export const MAX_SUGGESTIONS = 12;
const MAX_NOTE_LENGTH = 160;

const SEEDS: Record<string, string[]> = {
  Mangalsutra: ['black beads', 'patti', 'nano beads', 'single line', 'double line', 'vati', 'pendant', 'cages'],
  Haar: ['red stones', 'green stones', 'pearls', 'meena', 'pendant', 'peacock', 'temple', 'long'],
  Necklace: ['pendant', 'stones', 'pearls', 'meena', 'flat links', 'layered'],
  Chain: ['flat links', 'rope', 'box', 'ball chain', 'pendant', 'hollow'],
  Jhumka: ['pearl drops', 'meena', 'bell', 'stones', 'chain drops', 'big'],
  Chandbali: ['pearl drops', 'meena', 'stones', 'peacock', 'kundan'],
  Earrings: ['studs', 'hoops', 'stones', 'pearls', 'meena', 'drops'],
  Stud: ['stones', 'pearls', 'flower', 'plain', 'meena'],
  'Latkan Tops': ['drops', 'stones', 'pearls', 'meena'],
  Kansakhali: ['chains', 'stones', 'pearls', 'clip'],
  Bangle: ['plain', 'stones', 'meena', 'cut work', 'pair', 'set of 4'],
  Kada: ['plain', 'cut work', 'stones', 'meena', 'open', 'screw'],
  Bracelet: ['chain', 'stones', 'charms', 'flexible', 'plain'],
  Ring: ['stones', 'plain', 'meena', 'adjustable', 'gents', 'band'],
  Pendant: ['stones', 'meena', 'god motif', 'locket', 'with chain', 'plain'],
  'Pendant Set': ['pendant', 'earrings', 'stones', 'meena', 'pearls'],
  Mala: ['gold beads', 'rudraksh', 'single strand', 'multi strand', 'patterned beads'],
  Choker: ['stones', 'meena', 'pearls', 'flat', 'pendant'],
  'Vati Set': ['single vati', 'double vati', 'filigree', 'mani beads'],
  Coin: ['plain', 'god motif', 'hallmarked', 'pouch'],
};

/** Lowercase, letters/digits/space/hyphen, at most 4 words and 28 characters. "" when nothing usable is left. */
export function normalizeTag(raw: unknown): string {
  const cleaned = String(raw ?? '').toLowerCase().replace(/[^a-z0-9 \-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').slice(0, 4).join(' ');
  return words.slice(0, 28).trim();
}

export function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(normalizeTag).filter(Boolean))].slice(0, MAX_TAGS_PER_PRODUCT);
}

export function cleanStaffNote(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LENGTH);
}

function categoryKey(itemType: string | undefined): string | null {
  return resolveCategory(itemType ?? '')?.type ?? null;
}

/** The tags to offer for this item: learned ones first (approved counts most), seeds filling the rest. */
export function suggestTags(itemType: string | undefined): string[] {
  const category = categoryKey(itemType);
  if (!category) return [];
  const learned = getDb()
    .prepare('SELECT tag FROM tag_vocab WHERE category = ? AND (approved > 0 OR picked > 0) ORDER BY (approved * 2 + picked) DESC, updated_at DESC LIMIT ?')
    .all(category, MAX_SUGGESTIONS) as { tag: string }[];
  const out = learned.map((r) => r.tag);
  for (const seed of SEEDS[category] ?? []) {
    if (out.length >= MAX_SUGGESTIONS) break;
    if (!out.includes(seed)) out.push(seed);
  }
  return out;
}

function bump(category: string, tags: string[], column: 'picked' | 'approved'): void {
  if (tags.length === 0) return;
  const stmt = getDb().prepare(
    `INSERT INTO tag_vocab (category, tag, picked, approved, updated_at) VALUES (@category, @tag, @picked, @approved, @at)
     ON CONFLICT(category, tag) DO UPDATE SET ${column} = ${column} + 1, updated_at = @at`
  );
  const at = nowIso();
  getDb().transaction(() => {
    for (const tag of tags) stmt.run({ category, tag, picked: column === 'picked' ? 1 : 0, approved: column === 'approved' ? 1 : 0, at });
  })();
}

/** Staff tapped these when shooting. */
export function recordTagsPicked(itemType: string | undefined, tags: string[]): void {
  const category = categoryKey(itemType);
  if (category) bump(category, tags, 'picked');
}

/** The piece was approved: everything staff picked and the AI saw is now known to describe a good catalogue photo of this category. */
export function recordTagsApproved(itemType: string | undefined, staffTags: string[], aiTags: string[]): void {
  const category = categoryKey(itemType);
  if (category) bump(category, [...new Set([...staffTags, ...aiTags])], 'approved');
}

/** What staff said about the piece, as hints for the image model and the inspector. Empty when there is nothing. */
export function buildStaffTagsBlock(tags: string[], note: string): string {
  const parts: string[] = [];
  if (tags.length) parts.push(`the staff who hold the piece say it has: ${tags.join(', ')}`);
  if (note) parts.push(`staff note: "${note}"`);
  if (parts.length === 0) return '';
  return `\n- From the staff: ${parts.join('; ')}. Treat these as hints about what to look for - the photo still decides.`;
}
