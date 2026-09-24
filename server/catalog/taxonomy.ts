// The store's item-category vocabulary - ONE list, used everywhere a category
// matters.
//
// Spec §7. Two rules that make this worth a module of its own:
//
//   1. Trade language, not generic English. A printed tag says "Jhumka",
//      "Kada", "Mangalsutra" - not "earrings", "bracelet",
//      "necklace-with-pendant". Staff read the tag; the app should speak the
//      same words they do.
//   2. Never maintain a second, slightly-different category list elsewhere.
//      Aspect-ratio branching, gender defaulting and tag-text matching all
//      resolve through here. Two lists drift, and the drift shows up as a
//      chain silently rendered square.

export type AspectRatio = '1:1' | '3:4';
export type DefaultGender = "women's" | "men's" | 'unisex' | "kids'";

export interface Category {
  /** Canonical trade name, shown in the UI. */
  type: string;
  /** What this piece usually is, used only as a form default staff can change. */
  defaultGender: DefaultGender;
  /**
   * Output framing. Elongated pieces get the taller ratio.
   *
   * Spec §13 names forcing a long item into a square as a real shipped bug.
   * A mangalsutra squeezed into 1:1 is either cropped or shrunk to a thread
   * in the middle of a white field - both useless as catalogue images.
   */
  aspectRatio: AspectRatio;
  /** Other real names for the same thing, matched case-insensitively. */
  synonyms: string[];
  /**
   * What the image and vision models need to know about this category that a
   * general-purpose model would not - sent with every enhance, audit and
   * inventory call. Only where a real failure pattern justifies it: every
   * line here is prompt text on every call for that category.
   */
  modelNotes?: string;
}

export const CATEGORIES: Category[] = [
  // --- compact / closed-loop pieces: square ---
  {
    type: 'Ring', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['anguthi', 'anguti', 'finger ring', 'band'],
    modelNotes: "Men's rings (anguthi) are often cast with a raised motif or a patterned shank. The motif and the pattern along the sides of the shank must be kept exactly - these were the most common ring failures.",
  },
  {
    type: 'Jhumka', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['jhumki', 'zumka', 'jumka'],
    modelNotes: 'A bell- or dome-shaped drop earring, usually hanging from a decorative stud top, with a fringe of small balls or beads around the rim of the bell and often small clusters hanging beneath it. The number of fringe beads and the shape and count of the hanging clusters are the details most often redrawn wrongly.',
  },
  { type: 'Chandbali',   defaultGender: "women's", aspectRatio: '1:1', synonyms: ['chandbala', 'chand bali'] },
  { type: 'Bali',        defaultGender: "women's", aspectRatio: '1:1', synonyms: ['hoop', 'hoops', 'balee'] },
  { type: 'Stud',        defaultGender: "women's", aspectRatio: '1:1', synonyms: ['studs', 'tops', 'ear stud'] },
  // "earings" is a real spelling on the store's tags.
  { type: 'Earrings',    defaultGender: "women's", aspectRatio: '1:1', synonyms: ['earring', 'earings', 'earing', 'kanbali', 'karnphool', 'bugadi'] },
  {
    // "Singapore tops" is the store's name for a J-type earring. Listed as its
    // own type (and ahead of the bare "tops" -> Stud match by length) because
    // a model that thinks it is drawing a stud flattens the J curve.
    type: 'J Hoop', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['singapore tops', 'j hoop', 'j hoops', 'j type tops'],
    modelNotes: 'A J-shaped earring: it passes through the lobe and curves down and round in a "J", with the long front of the J visible when worn. It is not a closed round hoop and not a flat stud - keep the J curve, its length and any pattern along it.',
  },
  // "padak" is the store's POS word for a pendant; "pendent" is a real,
  // common spelling on its tags ("PENDENT SET").
  { type: 'Pendant',     defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['locket', 'dollar', 'padak', 'pendent'] },
  { type: 'Bangle',      defaultGender: "women's", aspectRatio: '1:1', synonyms: ['bangles', 'bangels', 'bangal', 'bangals', 'bangdi', 'patli', 'kangan'] },
  { type: 'Kada',        defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['kara', 'kadaa'] },
  { type: 'Nose Pin',    defaultGender: "women's", aspectRatio: '1:1', synonyms: ['nath', 'natth', 'nose ring', 'nosepin', 'chunni'] },
  { type: 'Coin',        defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['bar', 'biscuit', 'gold coin', 'sikka'] },
  { type: 'Temple Set',  defaultGender: "women's", aspectRatio: '1:1', synonyms: ['temple jewellery', 'temple jewelry'] },
  { type: 'Bridal Set',  defaultGender: "women's", aspectRatio: '1:1', synonyms: ['wedding set', 'dulhan set', 'full set'] },

  // --- elongated pieces: taller frame ---
  {
    // "chain padak" (a chain sold with its pendant) must stay elongated - it is
    // listed here so it outranks the bare "padak" -> Pendant (square) match.
    //
    // Tendulkar, Nawabi Holo and Indo-Italian are the store's names for chain
    // designs (confirmed by the owner) - they appear on tags with no other word
    // that would say "chain".
    type: 'Chain', defaultGender: 'unisex', aspectRatio: '3:4',
    synonyms: ['chein', 'zanzeer', 'chain padak', 'tendulkar', 'nawabi holo', 'indo italian'],
    modelNotes: 'The link style defines the chain - flat hand-made links, box, rope, curb, ball chain and so on are different products. Reproduce exactly the link style shown; never substitute a different one, and never change a flat link into a round one.',
  },
  // "Ekdani" is the store's name for a necklace style built from strands of
  // repeated small elements (the owner described one as a "3-strand EKDANI
  // design throughout the entire necklace").
  { type: 'Necklace',    defaultGender: "women's", aspectRatio: '3:4', synonyms: ['neckless', 'nekless', 'neckles', 'ekdani', 'mohanmala', 'mohan mal'] },
  // The "pendant ..." names are a haar sold with its pendant. Listed so they
  // outrank the bare "pendant" match, which would frame a long haar square.
  {
    type: 'Haar', defaultGender: "women's", aspectRatio: '3:4',
    synonyms: ['haram', 'rani haar', 'ranihar', 'long haar', 'har', 'harset', 'chaplahar', 'chapalahar', 'pendant rani har', 'meena ranihar', 'pendant harset'],
  },
  { type: 'Choker',      defaultGender: "women's", aspectRatio: '3:4', synonyms: ['kanthi', 'kantha', 'chokar', 'thushi'] },
  {
    // "Pote" is the Marathi name for the black-bead string of a mangalsutra, and
    // it is how the store's POS names these ("ATTACHED CHAIN POTE", "SHORT NANO
    // POTE", "DESIGNER POTE"). Before this, those resolved to plain Chain or to
    // nothing at all, so the model was never told the black beads matter - and
    // "attached chain pote" was the single worst category in the first pilot,
    // with black beads repeatedly rendered as gold. "chain pote" is listed so it
    // outranks the bare "chain" match.
    // "PBB" (as in "LONG PBB") is short for pote black beads.
    // Not "thali": in this store's POS a thali is a plate ("PUJA THALI",
    // ".THALI PLAIN-1" in silver), and matching it sent those to Mangalsutra.
    type: 'Mangalsutra', defaultGender: "women's", aspectRatio: '3:4', synonyms: ['mangalsutram', 'mangal sutra', 'pote', 'chain pote', 'pote chain', 'pbb', 'mangalpote'],
    modelNotes: 'A mangalsutra: gold chain combined with strings or sections of small black glass beads (pote / kaala mani), usually with a gold pendant or two small cup-shaped vati. The black beads are its defining feature: they must stay black, at the same count and positions, and must never be rendered as gold beads. Black beads set inside small gold cages must keep both the cage and the black bead inside it. Any black enamel (meena) on the vati or pendant must stay.',
  },
  // Not "lucky": the store's "LUCKY STONE" is a loose gemstone, not a bracelet.
  { type: 'Bracelet',    defaultGender: 'unisex',  aspectRatio: '3:4', synonyms: ['brasslet', 'braclet', 'bracelate', 'charm bracelet'] },
  {
    // "Kansakali" is the store's name for an ear chain (confirmed by the owner).
    // Elongated: it runs the full height of the ear.
    type: 'Ear Chain', defaultGender: "women's", aspectRatio: '3:4', synonyms: ['kansakali', 'kansakhali', 'kansakli', 'ear chain', 'ear chains'],
    modelNotes: 'An earring worn vertically along the ear (an ear chain): a piece at the lobe joined by a chain or strands running up the ear to a clip, cuff or hook near the top. Keep its full vertical length, the number of chains and strands, and the upper attachment - none of it may be cropped, shortened or dropped.',
  },
  { type: 'Anklet',      defaultGender: "women's", aspectRatio: '3:4', synonyms: ['payal', 'payals', 'pajeb', 'anklets'] },
  { type: 'Waist Chain', defaultGender: "women's", aspectRatio: '3:4', synonyms: ['kamarbandh', 'kamar band', 'oddiyanam'] },
  { type: 'Mala',        defaultGender: 'unisex',  aspectRatio: '3:4', synonyms: ['maala', 'rudraksh mala', 'ashtapailu mala'] },
];

const DEFAULT_ASPECT_RATIO: AspectRatio = '1:1';

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Longest names first, so "Waist Chain" is not swallowed by "Chain" and
// "Bangle Pure" resolves to Bangle rather than partially matching something
// shorter. Computed once.
const MATCHERS: { category: Category; needle: string }[] = CATEGORIES
  .flatMap((category) => [category.type, ...category.synonyms].map((name) => ({ category, needle: normalize(name) })))
  .sort((a, b) => b.needle.length - a.needle.length);

/**
 * Resolves free text - a form field, a style name off the POS, a line of tag
 * text - to a known category. Returns null rather than guessing wildly.
 *
 * The store's POS style names are messy ("BANGLE LADIS", "Baccha Kada",
 * "Zumka Kadi"), so this matches on a contained substring rather than
 * requiring equality.
 */
export function resolveCategory(text: string): Category | null {
  if (!text?.trim()) return null;
  const haystack = normalize(text);
  if (!haystack) return null;

  for (const { category, needle } of MATCHERS) {
    // Word-boundary-ish containment: guards against "bar" matching inside
    // "barfi" or "bali" inside "balaji".
    if (haystack === needle) return category;
    if (new RegExp(`(^| )${needle.replace(/ /g, ' ')}( |$)`).test(haystack)) return category;
  }
  return null;
}

/**
 * The output framing for a category. Unknown categories get the square
 * default: most of the store's catalogue is compact pieces, and a square is
 * the safer wrong answer - it under-uses the frame rather than cropping.
 */
export function aspectRatioFor(itemType: string): AspectRatio {
  return resolveCategory(itemType)?.aspectRatio ?? DEFAULT_ASPECT_RATIO;
}

export function isElongated(itemType: string): boolean {
  return aspectRatioFor(itemType) === '3:4';
}

/** A form default only - staff can always override it. */
export function defaultGenderFor(itemType: string): DefaultGender | null {
  return resolveCategory(itemType)?.defaultGender ?? null;
}

/**
 * True when a piece has hanging chains, tassels or bead drops, so the audit's
 * naturalDropPhysics check is meaningful. The audit model is told to pass that
 * check automatically for pieces with no such elements; this is the
 * server-side view of the same question, used for reporting.
 */
export function hasDropElements(itemType: string): boolean {
  const category = resolveCategory(itemType);
  if (!category) return false;
  return ['Jhumka', 'Chandbali', 'Haar', 'Mangalsutra', 'Ear Chain', 'Anklet', 'Waist Chain', 'Bracelet', 'Necklace', 'Mala'].includes(category.type);
}

export const CATEGORY_TYPES = CATEGORIES.map((c) => c.type);

/**
 * What to tell a model the item is. itemType is often the raw POS style name
 * off the tag ("ATTACHED CHAIN POTE", "GENTS CASTING ANGUTHI") - trade words a
 * general-purpose model does not know - so this leads with the resolved trade
 * category and keeps the tag name alongside it, plus the category's notes.
 */
export function describeItemType(itemType: string | undefined): { line: string; notes: string | null } {
  const raw = (itemType || '').trim();
  const category = resolveCategory(raw);
  // "Pote" means black beads whatever the piece is - "SHORT BRACLET POTE" is
  // a black-bead bracelet and "FMG POTE PADAK" a mangalsutra pendant. Those
  // resolve to Bracelet and Pendant, which say nothing about beads, so the
  // black-bead rule rides along with any name that carries the word.
  const blackBeads = category?.type !== 'Mangalsutra' && /(^| )(pote|pbb)( |$)/.test(normalize(raw)) ? BLACK_BEAD_NOTE : null;
  if (!category) {
    return { line: raw ? `"${raw}" (the store's own style name)` : 'jewellery', notes: blackBeads };
  }
  const line = normalize(raw) === normalize(category.type) ? category.type : `${category.type} (store tag name: "${raw}")`;
  const notes = [category.modelNotes, blackBeads].filter(Boolean).join(' ');
  return { line, notes: notes || null };
}

const BLACK_BEAD_NOTE = 'This piece includes pote: small black glass beads. They must stay black, at the same count and positions, and must never be rendered as gold beads.';
