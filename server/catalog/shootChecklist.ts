// "Before you save": the few things to check on the photo, for THIS kind of piece,
// before it is sent for processing. A picture is paid for every time it is drawn,
// and almost every re-run traces back to a photo that hid the hook, cut off the
// chain or left an earring out - so the check happens at the counter, with the
// piece still in hand, instead of after the AI has already drawn it.
//
// Plain words on purpose, one idea per line. Shared with the browser.
import { resolveCategory, familyFor, setPieces } from './taxonomy';

export interface ChecklistItem {
  id: string;
  text: string;
}

export interface ShootChecklist {
  /** "Chain", "Haar set"... for the heading. */
  title: string;
  items: ChecklistItem[];
}

const COMMON: ChecklistItem[] = [
  { id: 'whole', text: 'The whole piece is in the photo, in the middle, shot from straight above - no part touches or crosses the edge.' },
  { id: 'sharp', text: 'It is sharp. Zoom in: the beads, links and engraving look crisp, not soft.' },
  { id: 'clean', text: 'Plain background. No hand, finger, stand or bright glare on the metal.' },
];

const LAID_OUT: ChecklistItem = { id: 'laid', text: 'It is laid out smooth - nothing twisted, folded, bunched or crossing over.' };
const ENDS: ChecklistItem = { id: 'ends', text: 'BOTH ends and the hook (usually an S hook) are in the photo and easy to see.' };
const EXTRA: ChecklistItem = {
  id: 'extra',
  text: 'Anything hidden (the back, the hook, behind the pendant) has its own extra photo - or nothing is hidden.',
};

const LONG: ChecklistItem[] = [LAID_OUT, ENDS];

const BY_CATEGORY: Record<string, ChecklistItem[]> = {
  Chain: [LAID_OUT, ENDS],
  Necklace: [...LONG, { id: 'centre', text: 'The pendant or centre piece is fully visible and not hidden behind the chain.' }, EXTRA],
  Choker: [...LONG, { id: 'centre', text: 'The centre piece is fully visible and not hidden behind the chain.' }, EXTRA],
  Haar: [
    ...LONG,
    { id: 'centre', text: 'The pendant or centre piece and every hanging drop are visible, none hidden behind the chain.' },
    EXTRA,
  ],
  Mala: [LAID_OUT, ENDS, { id: 'beads', text: 'Every bead is visible - the string is not bunched at any point.' }],
  Mangalsutra: [
    ...LONG,
    { id: 'black', text: 'Every string of black beads is laid straight and shows end to end, with the vati or pendant in view.' },
    EXTRA,
  ],
  Bracelet: [
    { id: 'curve', text: 'It lies flat in a gentle curve, nothing twisted.' },
    { id: 'hook', text: 'The S hook is visible at one end, and the other end is visible too.' },
  ],
  Anklet: [LAID_OUT, ENDS],
  'Waist Chain': [LAID_OUT, ENDS],
  Kansakhali: [
    { id: 'full', text: 'It is laid flat at full length - every chain and the top clip or hook are in the photo.' },
    EXTRA,
  ],
  Ring: [
    { id: 'face', text: 'The top faces the camera, with the band showing - not a flat disc face-on.' },
    { id: 'detail', text: 'Any design on the side of the band is visible, or there is an extra photo of it.' },
  ],
  Bangle: [{ id: 'circle', text: 'The full circle shows, and the opening or screw is visible if it has one.' }],
  Kada: [{ id: 'circle', text: 'The full circle shows, and the opening or screw is visible if it has one.' }],
  Pendant: [{ id: 'loop', text: 'The loop at the top is visible and the face of the pendant is straight on.' }],
};

const EARRING: ChecklistItem[] = [
  { id: 'pair', text: 'BOTH earrings are in the photo, side by side with a gap, facing the camera the same way.' },
  { id: 'fitting', text: 'The top fitting (hook or post) of each earring is visible.' },
  { id: 'drops', text: 'Every drop and bell is visible - none tangled or hidden behind another.' },
];

const BY_FAMILY: Record<string, ChecklistItem[]> = {
  earring: EARRING,
  neckpiece: [...LONG, EXTRA],
  mangalsutra: BY_CATEGORY.Mangalsutra,
  wrist: [{ id: 'curve', text: 'It lies flat in a gentle curve, and the hook or opening is visible.' }],
};

const SET_ITEMS: ChecklistItem[] = [
  { id: 'pieces', text: 'The necklace AND both earrings of the set are in the photo, laid next to each other.' },
];

/** The checks for this piece. Always a few; never more than eight. */
export function shootChecklistFor(itemType: string | undefined): ShootChecklist {
  const category = resolveCategory(itemType ?? '');
  const family = familyFor(itemType);
  const specific = (category && BY_CATEGORY[category.type]) || (family && BY_FAMILY[family]) || [];
  const earringCategory = category && ['Jhumka', 'Chandbali', 'Bali', 'Stud', 'Earrings', 'U Hoop', 'J Hoop', 'Latkan Tops'].includes(category.type);
  const isSet = setPieces(itemType) !== null;

  const items = [
    ...COMMON,
    ...(isSet ? SET_ITEMS : []),
    ...(earringCategory ? EARRING : specific),
  ];
  // The same idea can arrive twice (a set that is also a haar): keep the first.
  const seen = new Set<string>();
  const unique = items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true))).slice(0, 8);
  return { title: category?.type ?? (itemType?.trim() || 'this piece'), items: unique };
}
