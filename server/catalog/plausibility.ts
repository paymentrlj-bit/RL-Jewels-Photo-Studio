// Is the weight typed on the form believable for this kind of piece? A slip
// like 4.2 for 42 grams is the commonest data-entry error at the counter and it
// quietly poisons the catalogue (and, now, the AI's idea of how big the piece
// is). Warn-only: nothing is blocked, staff can always carry on.
import { resolveCategory } from './taxonomy';

// Net gold weight in grams a retail piece of this category plausibly has. Wide
// on purpose - the point is to catch a slipped decimal, not to police designs.
const WEIGHT_BANDS: Record<string, [number, number]> = {
  Ring: [0.5, 40],
  Jhumka: [1.5, 60], Chandbali: [2, 80], Bali: [0.5, 30], 'U Hoop': [0.5, 30], Stud: [0.2, 15], 'Latkan Tops': [1, 40],
  Earrings: [0.3, 40], 'J Hoop': [0.5, 30], Kansakhali: [2, 60], Kayamat: [2, 60], 'Sui Dhaga': [0.3, 12],
  Pendant: [0.3, 60], 'Pendant Set': [2, 80], 'Vati Set': [1, 40], Dorla: [0.5, 30],
  Bangle: [4, 120], Kada: [8, 200], Bajuband: [8, 150], Bracelet: [2, 100],
  'Nose Pin': [0.05, 4], Aakda: [1, 40], Bindi: [0.1, 10], Rakhi: [0.3, 30], Coin: [0.1, 500],
  'Temple Set': [10, 500], 'Bridal Set': [30, 800],
  Chain: [1.5, 150], Necklace: [3, 150], Haar: [10, 300], Choker: [6, 200], Mala: [5, 200],
  Mangalsutra: [3, 120], Anklet: [4, 150], 'Waist Chain': [10, 300], Janwa: [0.5, 30],
};

export interface WeightCheck {
  status: 'ok' | 'low' | 'high' | 'unknown';
  band: [number, number] | null;
  /** Staff-facing, one line. Empty when ok or unknown. */
  message: string;
}

/** Net weight in grams (falls back to whatever the caller has) against the category's usual range. */
export function checkWeight(itemType: string | undefined, grams: number | string | null | undefined): WeightCheck {
  const g = typeof grams === 'string' ? Number(grams.replace(',', '.')) : grams;
  const category = resolveCategory(itemType ?? '');
  const band = category ? WEIGHT_BANDS[category.type] ?? null : null;
  if (!band || g === null || g === undefined || !Number.isFinite(g) || g <= 0) return { status: 'unknown', band, message: '' };
  if (g < band[0]) {
    return { status: 'low', band, message: `${g} g looks light for ${category!.type.toLowerCase()} (usually ${band[0]}-${band[1]} g). Check the decimal point.` };
  }
  if (g > band[1]) {
    return { status: 'high', band, message: `${g} g looks heavy for ${category!.type.toLowerCase()} (usually ${band[0]}-${band[1]} g). Check the decimal point.` };
  }
  return { status: 'ok', band, message: '' };
}
