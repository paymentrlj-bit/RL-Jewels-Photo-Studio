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
    // "Karda" is a finger ring styled like a kada (confirmed by the owner) - not
    // to be confused with ".KARNDA", a silver waist chain.
    type: 'Ring', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['anguthi', 'anguti', 'finger ring', 'band', 'karda'],
    modelNotes: "Men's rings (anguthi) are often cast with a raised motif or a patterned shank. The motif and the pattern along the sides of the shank must be kept exactly - these were the most common ring failures.",
  },
  {
    type: 'Jhumka', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['jhumki', 'zumka', 'jumka'],
    modelNotes: 'A bell- or dome-shaped drop earring, usually hanging from a decorative stud top, with a fringe of small balls or beads around the rim of the bell and often small clusters hanging beneath it. The number of fringe beads and the shape and count of the hanging clusters are the details most often redrawn wrongly.',
  },
  {
    // "Chandrakanta" is the store's crescent-shaped statement earring.
    type: 'Chandbali', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['chandbala', 'chand bali', 'chandrakanta'],
    modelNotes: 'A crescent-shaped (half-moon) statement earring, often with filigree or die-struck work and small dangling drops along the curve. Keep the crescent shape, the filigree pattern and the number of drops.',
  },
  // "Ringa" is the store's hoop worn through the lobe (confirmed by the owner).
  { type: 'Bali',        defaultGender: "women's", aspectRatio: '1:1', synonyms: ['hoop', 'hoops', 'balee', 'ringa'] },
  {
    // "Ringa U Shape" - 1,642 pieces in stock - is not a round hoop.
    type: 'U Hoop', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['ringa u shape', 'u shape', 'v shape', 'u hoop'],
    modelNotes: 'A hoop earring in a U or V (horseshoe) shape, not a round circle. Keep the U or V silhouette - its straight or angled sides and the curve or point at the bottom - and any pattern along it.',
  },
  { type: 'Stud',        defaultGender: "women's", aspectRatio: '1:1', synonyms: ['studs', 'tops', 'ear stud'] },
  {
    // "Tops latkan" - a stud top with a small hanging charm (confirmed by the
    // owner). Its own type so the drop is not flattened into a plain stud.
    type: 'Latkan Tops', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['tops latkan', 'latkan', 'latkans'],
    modelNotes: 'A stud earring (top) that sits on the lobe with a small charm, drop or chain hanging below it (the latkan). Keep both parts: the top, and every hanging element with its length and count.',
  },
  // "earings" is a real spelling on the store's tags. Motikudi is a large ornate
  // pearl stud; kanchain is the owner's word for an earring style.
  { type: 'Earrings',    defaultGender: "women's", aspectRatio: '1:1', synonyms: ['earring', 'earings', 'earing', 'kanbali', 'karnphool', 'bugadi', 'motikudi', 'kanchain'] },
  {
    // "Singapore tops" is the store's name for a J-type earring. Listed as its
    // own type (and ahead of the bare "tops" -> Stud match by length) because
    // a model that thinks it is drawing a stud flattens the J curve.
    type: 'J Hoop', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['singapore tops', 'j hoop', 'j hoops', 'j type tops'],
    modelNotes: 'A J-shaped earring: it passes through the lobe and curves down and round in a "J", with the long front of the J visible when worn. It is not a closed round hoop and not a flat stud - keep the J curve, its length and any pattern along it.',
  },
  // "padak" is the store's POS word for a pendant; "pendent" is a real,
  // common spelling on its tags. A "chain padak" is a pendant made to go on a
  // chain - sold and photographed as a pendant (confirmed by the owner), so
  // square - "CHAIN PADAK CASTING" included (owner).
  { type: 'Pendant',     defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['locket', 'dollar', 'padak', 'pendent', 'chain padak'] },
  {
    type: 'Pendant Set', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['pendant set', 'pendent set'],
    modelNotes: 'A set: a pendant (sometimes on its chain) with a matching pair of earrings or tops. Every piece of the set in the photo must stay - the pendant and both earrings - each with its own details.',
  },
  {
    // Vati: the small hollow gold cups of a Maharashtrian mangalsutra, here
    // sold as a set with gold mani beads (owner). "VATI SET 2 L" alone is
    // 1,349 pieces.
    type: 'Vati Set', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['vati set', 'vati', 'vatti'],
    modelNotes: 'A Maharashtrian vati set: one (single vati) or two (double vati) small, round, hollow, bowl-shaped gold cups, usually with filigree, spiral or embossed work, strung with gold mani beads that carry similar work. The cups must stay hollow and bowl-shaped, at the same count; keep every mani bead and the pattern on each piece.',
  },
  {
    type: 'Dorla', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['dorla'],
    modelNotes: 'A dorla: an ornate round or heart-shaped gold locket, similar to a vati but built by soldering many small embossed pieces together. Keep every small piece and the joins between them - never smooth it into a single cast surface.',
  },
  // Gote (plain gold bangle) and patli (a pair of bangles) per the owner.
  { type: 'Bangle',      defaultGender: "women's", aspectRatio: '1:1', synonyms: ['bangles', 'bangels', 'bangal', 'bangals', 'bangdi', 'patli', 'kangan', 'gote'] },
  // Toda: a thick, structural kada (owner).
  { type: 'Kada',        defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['kara', 'kadaa', 'toda'] },
  {
    type: 'Bajuband', defaultGender: "women's", aspectRatio: '1:1', synonyms: ['bajuband', 'baju band', 'armlet'],
    modelNotes: 'An armlet worn snugly around the upper arm. Keep its full band, the central motif and any hanging elements.',
  },
  // Taar and firki are nose pins without and with a screw back (owner).
  { type: 'Nose Pin',    defaultGender: "women's", aspectRatio: '1:1', synonyms: ['nath', 'natth', 'nose ring', 'nosepin', 'chunni', 'taar', 'firki'] },
  {
    type: 'Aakda', defaultGender: 'unisex', aspectRatio: '1:1', synonyms: ['aakda', 'akda'],
    modelNotes: 'An aakda: a heavy traditional clasp or hook used to fasten Indian ornaments. Keep the hook, its loop and any decoration exactly.',
  },
  { type: 'Bindi',       defaultGender: "women's", aspectRatio: '1:1', synonyms: ['bindi'] },
  { type: 'Rakhi',       defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['rakhi'] },
  { type: 'Coin',        defaultGender: 'unisex',  aspectRatio: '1:1', synonyms: ['bar', 'biscuit', 'gold coin', 'sikka'] },
  { type: 'Temple Set',  defaultGender: "women's", aspectRatio: '1:1', synonyms: ['temple jewellery', 'temple jewelry'] },
  { type: 'Bridal Set',  defaultGender: "women's", aspectRatio: '1:1', synonyms: ['wedding set', 'dulhan set', 'full set'] },

  // --- elongated pieces: taller frame ---
  {
    // Tendulkar, Nawabi Holo, Indo-Italian, Coimbtur, Dokiya, Gofe, Rassi, Kaju
    // Katli and Holo are all chain designs (confirmed by the owner) - they
    // appear on tags with no other word that would say "chain".
    type: 'Chain', defaultGender: 'unisex', aspectRatio: '3:4',
    synonyms: [
      'chein', 'zanzeer', 'tendulkar', 'nawabi holo', 'indo italian', 'holo',
      'rassi', 'rasshi', 'coimbtur', 'coimbatore', 'dokiya', 'gofe', 'gof', 'kaju katli', 'lotus',
      // HC: the haar chain that goes at the back of haars and rani haars.
      'hc', 'haar chain',
    ],
    modelNotes: 'The link style defines the chain - flat hand-made links, box, rope, curb, ball chain and so on are different products. Reproduce exactly the link style shown; never substitute a different one, and never change a flat link into a round one.',
  },
  {
    // "Kayamat" is a long chain attachment worn with tops - an earring, not a
    // neck chain (owner). Listed so "KAYAMAT CHAIN" outranks bare "chain".
    type: 'Kayamat', defaultGender: "women's", aspectRatio: '3:4', synonyms: ['kayamat', 'kayamat chain'],
    modelNotes: 'A kayamat: a long, elaborate earring attachment worn with tops - hanging chains carrying gold beads or small pieceworks. Keep every chain, its length and the beads and pieces on it; nothing may be shortened or merged.',
  },
  {
    type: 'Sui Dhaga', defaultGender: "women's", aspectRatio: '3:4', synonyms: ['suidhaga', 'sui dhaga', 'sui dhaaga'],
    modelNotes: 'A sui-dhaga ("needle and thread") earring: a thin chain threaded through the lobe, with a small needle or stud at one end and a dangling end at the other. Keep the chain\'s full length and both ends.',
  },
  { type: 'Necklace',    defaultGender: "women's", aspectRatio: '3:4', synonyms: ['neckless', 'nekless', 'neckles'] },
  // The "pendant ..." names are a haar sold with its pendant. Listed so they
  // outrank the bare "pendant" match, which would frame a long haar square.
  // "Set long" / "set antic" are haar sets (owner).
  {
    type: 'Haar', defaultGender: "women's", aspectRatio: '3:4',
    synonyms: ['haram', 'rani haar', 'ranihar', 'long haar', 'har', 'harset', 'chaplahar', 'chapalahar', 'pendant rani har', 'meena ranihar', 'pendant harset', 'set long', 'set antic'],
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
    // "PBB" (as in "LONG PBB") is short for pote black beads. "Braclet pote" is
    // a mangalsutra with bracelet-style pieceworks in it, not a bracelet, and a
    // tanmaniya is a short mangalsutra with a stone-set pendant (owner).
    // Not "thali": in this store's POS a thali is a plate ("PUJA THALI",
    // ".THALI PLAIN-1" in silver), and matching it sent those to Mangalsutra.
    type: 'Mangalsutra', defaultGender: "women's", aspectRatio: '3:4',
    synonyms: ['mangalsutram', 'mangal sutra', 'pote', 'chain pote', 'pote chain', 'pbb', 'mangalpote', 'braclet pote', 'bracelet pote', 'tanmani', 'tanmaniya', 'tanmanya'],
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
  // Kandora / karnda: a waist chain (owner).
  { type: 'Waist Chain', defaultGender: "women's", aspectRatio: '3:4', synonyms: ['kamarbandh', 'kamar band', 'oddiyanam', 'kandora', 'karnda', 'kardora'] },
  // Janwa: the sacred thread (janeu), made in metal.
  { type: 'Janwa',       defaultGender: "men's",   aspectRatio: '3:4', synonyms: ['janwa', 'jaanva', 'janave', 'janeu'] },
  {
    // Ekdani, mohan mala, jondhali and akdani are malas of gold beads (owner);
    // "mal" is how the POS shortens mala ("LONG VERTICAL MAL").
    type: 'Mala', defaultGender: 'unisex', aspectRatio: '3:4',
    synonyms: ['maala', 'mal', 'rudraksh mala', 'ashtapailu mala', 'ekdani', 'akdani', 'mohanmala', 'mohan mala', 'mohan mal', 'jondhali'],
    modelNotes: 'A mala: one or more strands of beads, often gold beads with intricate work on each and in several sizes. Keep the number of strands, the count, size and order of the beads, and the pattern on each bead.',
  },
];

// Style words that say something about the piece whatever its category - the
// owner's own descriptions. Added to the category's notes when the name
// carries the word.
const STYLE_NOTES: { words: string[]; note: string }[] = [
  { words: ['nano'], note: 'Nano: the black-bead section uses very small (nano) black beads, often in an intricate pattern - keep their size, count and pattern.' },
  { words: ['bunch'], note: 'Bunch: three or four machine chains gathered together - keep the number of strands.' },
  { words: ['braclet pote', 'bracelet pote'], note: 'Bracelet-style gold pieceworks are set into the black-bead section - keep each piecework and the beads between them.' },
  { words: ['taramandal'], note: 'Taramandal: a celestial, star-pattern design - keep every star motif.' },
  { words: ['patti', 'designer pote'], note: 'Patti pote: flat gold patti (strip) pieces alternate with the black beads - keep each patti and its pattern.' },
  { words: ['chaplahar', 'chapalahar', 'chapla'], note: 'Chapla: made of flat gold pieceworks - they stay flat, never rounded or domed.' },
  { words: ['rassi', 'rasshi'], note: 'Rassi: a rope chain - twisted, spiral links like a rope.' },
  { words: ['gofe', 'gof'], note: 'Gofe: a hand-made chain of thin gold wire spiralled together.' },
  { words: ['dokiya'], note: 'Dokiya: a machine chain with gold beads and a pendant attached.' },
  { words: ['gahu', 'gehu'], note: 'Gahu: a wheat-grain texture over the surface - keep the texture.' },
  { words: ['flexible'], note: 'Flexible: built from linked segments so it bends - keep the segments and the joins between them.' },
  { words: ['chap', 'chaap'], note: 'Chap nath: a clip-on nose ring held by a wire clamp (no piercing) - keep the clamp.' },
  { words: ['motikudi'], note: 'Motikudi: a large, ornate stud set with pearls - keep every pearl.' },
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
  return [
    'Jhumka', 'Chandbali', 'Latkan Tops', 'Kayamat', 'Sui Dhaga', 'Haar', 'Mangalsutra', 'Ear Chain',
    'Anklet', 'Waist Chain', 'Bracelet', 'Necklace', 'Mala',
  ].includes(category.type);
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
  const name = normalize(raw);
  const blackBeads = category?.type !== 'Mangalsutra' && /(^| )(pote|pbb)( |$)/.test(name) ? BLACK_BEAD_NOTE : null;
  const style = STYLE_NOTES.filter(({ words }) => words.some((w) => new RegExp(`(^| )${normalize(w)}( |$)`).test(name))).map((s) => s.note);
  if (!category) {
    const notes = [blackBeads, ...style].filter(Boolean).join(' ');
    return { line: raw ? `"${raw}" (the store's own style name)` : 'jewellery', notes: notes || null };
  }
  const line = name === normalize(category.type) ? category.type : `${category.type} (store tag name: "${raw}")`;
  const notes = [category.modelNotes, blackBeads, ...style].filter(Boolean).join(' ');
  return { line, notes: notes || null };
}

const BLACK_BEAD_NOTE = 'This piece includes pote: small black glass beads. They must stay black, at the same count and positions, and must never be rendered as gold beads.';
