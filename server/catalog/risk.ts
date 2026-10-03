// A fidelity-risk score for every product: how likely is it that the AI render
// of THIS piece is wrong? Recorded for all products (not just the shaky ones) so
// that, over time, approved and rejected pieces can be compared against the
// score and the weights below tuned from data instead of guesswork.
//
// The number is a triage aid and an analysis column. It never blocks anything.
import { familyFor, parseLengthInches, resolveCategory } from './taxonomy';
import { checkWeight } from './plausibility';

export type RiskTier = 'low' | 'medium' | 'high';

export interface RiskInput {
  itemType?: string;
  size?: string;
  /** Net weight, grams. */
  weight?: string | number | null;
  /** Did the detail inventory run? Undefined = not yet known (pre-flight estimate). */
  inventoryRan?: boolean;
  /** Close-up counts the inspector was unsure of. */
  lowConfidenceElements?: number;
  /** identity check outcome */
  identity?: 'match' | 'mismatch' | 'unsure' | 'unchecked';
  attempts?: number;
  escalated?: boolean;
  /** 'faithful' = the real photo cut out, which cannot hallucinate. */
  renderMode?: 'ai' | 'faithful';
  /** Audit checks that failed on any attempt. */
  failedChecks?: string[];
  hadAngles?: boolean;
}

export interface RiskResult {
  score: number;
  tier: RiskTier;
  reasons: string[];
}

const COMPLEX_TYPES = new Set(['Haar', 'Mala', 'Kansakhali', 'Kayamat', 'Choker', 'Necklace', 'Bridal Set', 'Temple Set', 'Waist Chain', 'Sui Dhaga', 'Chandbali']);

export function tierFor(score: number): RiskTier {
  return score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
}

export function computeRisk(input: RiskInput): RiskResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, why: string) => {
    score += points;
    reasons.push(why);
  };

  const category = resolveCategory(input.itemType ?? '');
  const family = familyFor(input.itemType);
  if (!category && family === null) add(15, 'category not recognised');
  if (family === 'mangalsutra') add(20, 'black-bead strand');
  else if (category && COMPLEX_TYPES.has(category.type)) add(15, `complex piece (${category.type})`);

  const inches = parseLengthInches(input.size);
  if (inches && inches >= 24) add(10, `long piece (${inches} in)`);

  const grams = typeof input.weight === 'string' ? Number(input.weight) : input.weight;
  const w = checkWeight(input.itemType, grams);
  if (w.status === 'low' || w.status === 'high') add(15, `weight looks ${w.status === 'low' ? 'light' : 'heavy'} for the category`);

  if (input.identity === 'mismatch') add(40, 'photo does not look like the category on the form');
  else if (input.identity === 'unsure') add(15, 'AI unsure what the piece is');

  if (input.inventoryRan === false) add(15, 'detail count unavailable');
  if (input.lowConfidenceElements) add(Math.min(20, input.lowConfidenceElements * 10), 'part of the detail was hidden or unclear');

  if (input.escalated) add(10, 'needed the stronger model');
  if ((input.attempts ?? 1) > 1) add(5, 'more than one attempt');
  if (input.failedChecks?.length) add(Math.min(30, input.failedChecks.length * 10), `audit flagged: ${input.failedChecks.join(', ')}`);

  if (input.hadAngles) score -= 5;
  if (input.renderMode === 'faithful') {
    score = Math.min(score, 20);
    reasons.push('real photo cut-out');
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tier: tierFor(score), reasons };
}
