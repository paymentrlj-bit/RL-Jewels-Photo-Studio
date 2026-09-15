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
}

export const CATEGORIES: Category[] = [
  // --- compact / closed-loop pieces: square ---
  { type: 'Ring',        defaultGender: "women's", aspectRatio: '1:1', synonyms: ['anguthi', 'finger ring', 'band'] },
  { type: 'Jhumka',      defaultGender: "women's", aspectRatio: '1:1', synonyms: ['jhumki', 'zumka', 'jumka'] },
  { type: 'Chandbali',   defaultGender: "women's", aspectRatio: '1:1', synonyms: ['chandbala', 'chand bali'] },
  { type: 'Bali',        defaultGender: "women's", aspectRatio: '1:1', synonyms: ['hoop', 'hoops', 'balee'] },
  { type: 'Stud',        defaultGender: "women's", aspectRatio: '1:1', synonyms: ['studs', 'tops', 'ear stud'] },
  { type: 'Earrings',    defaultGender: "women's", aspectRatio: '1:1', synonyms: ['earring', 'kanbali', 'karnphool'] },
  { type: 'Pendant',     defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['locket', 'dollar'] },
  { type: 'Bangle',      defaultGender: "women's", aspectRatio: '1:1', synonyms: ['bangles', 'bangdi', 'patli'] },
  { type: 'Kada',        defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['kara', 'kadaa'] },
  { type: 'Nose Pin',    defaultGender: "women's", aspectRatio: '1:1', synonyms: ['nath', 'nose ring', 'chunni'] },
  { type: 'Coin',        defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['bar', 'biscuit', 'gold coin', 'sikka'] },
  { type: 'Temple Set',  defaultGender: "women's", aspectRatio: '1:1', synonyms: ['temple jewellery', 'temple jewelry'] },
  { type: 'Bridal Set',  defaultGender: "women's", aspectRatio: '1:1', synonyms: ['wedding set', 'dulhan set', 'full set'] },

  // --- elongated pieces: taller frame ---
  { type: 'Chain',       defaultGender: 'unisex',  aspectRatio: '3:4', synonyms: ['chein', 'zanzeer'] },
  { type: 'Necklace',    defaultGender: "women's", aspectRatio: '3:4', synonyms: ['neckless', 'nekless'] },
  { type: 'Haar',        defaultGender: "women's", aspectRatio: '3:4', synonyms: ['haram', 'rani haar', 'long haar', 'har'] },
  { type: 'Choker',      defaultGender: "women's", aspectRatio: '3:4', synonyms: ['kanthi', 'kantha'] },
  { type: 'Mangalsutra', defaultGender: "women's", aspectRatio: '3:4', synonyms: ['mangalsutram', 'mangal sutra', 'thali'] },
  { type: 'Bracelet',    defaultGender: 'unisex',  aspectRatio: '3:4', synonyms: ['brasslet', 'lucky', 'charm bracelet'] },
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
  return ['Jhumka', 'Chandbali', 'Haar', 'Mangalsutra', 'Anklet', 'Waist Chain', 'Bracelet', 'Necklace', 'Mala'].includes(category.type);
}

export const CATEGORY_TYPES = CATEGORIES.map((c) => c.type);
