// A one-line "how to place and shoot this" for each kind of piece, shown on the
// Shoot screen once the item type is known. Plain words on purpose: it is read
// at the counter, with the piece in one hand. Most reshoots trace back to how
// the piece was laid out, so this is the cheapest accuracy gain there is.
import { resolveCategory, familyFor } from './taxonomy';

const BY_CATEGORY: Record<string, string> = {
  Mangalsutra: 'Lay it flat in a straight line or a gentle U - not coiled or bunched. Keep the pendant and the black beads in the frame, and add a close-up of the pendant as a second photo.',
  Haar: 'Lay it flat so it hangs in its natural shape, nothing curled or crossed. Add a close-up of the pendant or centre piece, and of both end stones.',
  Necklace: 'Lay it flat in its natural curve. Add a close-up of the pendant or centre piece.',
  Choker: 'Lay it flat in a gentle curve with the clasp visible. Add a close-up of the centre.',
  Chain: 'Lay it in a loose, even curve with the clasp end visible. Add a close-up of the links.',
  Mala: 'Lay it flat in one smooth loop. Add a close-up of a few beads.',
  Jhumka: 'Photograph the pair side by side with a gap between them, or one earring hanging straight. Keep every drop visible.',
  Chandbali: 'Photograph the pair side by side with a gap, or one earring facing the camera. Keep every drop visible.',
  Earrings: 'Photograph the pair side by side with a gap, both facing the camera.',
  Kansakhali: 'Lay it flat at full length so every chain and the top clip are in the frame.',
  Bangle: 'Stand it on its edge or lay it flat so the full circle shows. Show the opening or screw if it has one.',
  Kada: 'Stand it on its edge or lay it flat so the full circle shows. Show the opening or screw if it has one.',
  Bracelet: 'Lay it flat in a gentle curve with the clasp visible.',
  Ring: 'Stand it up with the top facing the camera. Add a side photo if the band has design.',
  Pendant: 'Lay it face-on with the loop at the top. Keep the chain out of the way unless it is part of the piece.',
};

const BY_FAMILY: Record<string, string> = {
  earring: 'Photograph the pair side by side with a gap between them, both facing the camera.',
  neckpiece: 'Lay it flat in its natural shape, nothing curled or crossed. Add a close-up of any pendant.',
};

/** The tip for this item, or null when there is nothing useful to say. */
export function shootingTipFor(itemType: string | undefined): string | null {
  const category = resolveCategory(itemType ?? '');
  if (category && BY_CATEGORY[category.type]) return BY_CATEGORY[category.type];
  const family = familyFor(itemType);
  return family ? BY_FAMILY[family] ?? (family === 'mangalsutra' ? BY_CATEGORY.Mangalsutra : null) : null;
}
