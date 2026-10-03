// What is this piece? One independent look at the original photo, by the strong
// model, answering a single narrow question: which kind of product is this, and
// how many separate pieces are there. It exists because the form can be wrong
// (a "Patti Pot" was once rendered as earrings) and nothing before it ever
// checked the form against the photo.
//
// The answer is used three ways: staff are asked for another photo when it
// disagrees with the form, the audit is told what the original really is, and
// the risk score notes a piece the model was unsure about.
import type { GoogleGenAI } from '@google/genai';
import { MODEL_AUDIT_STRONG, type TokenUsage } from './client';
import { callJson } from './inventory';
import { FAMILY_LABEL, PRODUCT_FAMILIES, familyFor, type ProductFamily } from '../catalog/taxonomy';

export interface PieceIdentity {
  family: ProductFamily;
  /** The model's own words, e.g. "long mangalsutra with a patti and black-bead strands". */
  description: string;
  /** Separate physical pieces in the photo: a pair of earrings is 2, a necklace set may be 3. */
  pieceCount: number | null;
  hasBlackBeads: boolean;
  confidence: 'high' | 'medium' | 'low';
}

const IDENTITY_TIMEOUT_MS = 30_000;

export function parseIdentity(raw: unknown): PieceIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const family = String(o.family ?? '').toLowerCase() as ProductFamily;
  if (!PRODUCT_FAMILIES.includes(family)) return null;
  const confidence = o.confidence === 'high' || o.confidence === 'medium' || o.confidence === 'low' ? o.confidence : 'low';
  const count = typeof o.pieceCount === 'number' && Number.isFinite(o.pieceCount) && o.pieceCount > 0 ? Math.round(o.pieceCount) : null;
  return {
    family,
    description: String(o.description ?? '').slice(0, 300),
    pieceCount: count,
    hasBlackBeads: o.hasBlackBeads === true,
    confidence,
  };
}

export async function identifyPiece(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  extra: { base64: string; mimeType: string }[],
  hint: { itemLine: string; sizeInches: number | null },
  onUsage?: (usage: TokenUsage | null) => void
): Promise<PieceIdentity | null> {
  const prompt = `You are identifying ONE piece of Indian gold jewellery from a counter photo${extra.length ? ' (the other photos show the same piece from other angles)' : ''}.
The staff's form says: ${hint.itemLine}${hint.sizeInches ? `, about ${hint.sizeInches} inches long` : ''}. The form can be wrong - answer from what the PHOTO shows.

Pick the family:
- "earring": anything worn on the ear (jhumka, chandbali, bali, studs/tops, ear chains)
- "neckpiece": gold chain, necklace, haar, choker, mala or pendant WITHOUT a black-bead section
- "mangalsutra": a necklace with strings or sections of small BLACK beads (pote, mangalsutra, tanmani, patti pote, nano pote), usually with vati or a pendant
- "ring", "wrist" (bangle, kada, bracelet, armlet), "nose" (nose pin)
- "other": sets, coins, anklets, waist chains, anything else

A long strand of beads and flat gold pieces hanging in a long loop is a neckpiece or mangalsutra, never earrings, however it is laid out on the counter.

Respond ONLY as JSON:
{"family": "earring|neckpiece|mangalsutra|ring|wrist|nose|other", "description": string, "pieceCount": number, "hasBlackBeads": boolean, "confidence": "high|medium|low"}
- description: one short line naming what it is and its main parts.
- pieceCount: how many separate physical pieces are in the photo (a pair of earrings is 2; one necklace is 1).
- confidence: "low" if the photo is too unclear, cropped or ambiguous to be sure of the family.`;
  const parts: object[] = [
    { inlineData: { mimeType, data: imageBase64 } },
    ...extra.map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.base64 } })),
    { text: prompt },
  ];
  return parseIdentity(await callJson(ai, MODEL_AUDIT_STRONG, parts, IDENTITY_TIMEOUT_MS, onUsage));
}

export interface IdentityVerdict {
  /** 'match' | 'mismatch' (ask for another photo) | 'unsure' (could not tell) | 'unchecked' (form has no family). */
  status: 'match' | 'mismatch' | 'unsure' | 'unchecked';
  /** Staff-facing, plain words. Empty for match/unchecked. */
  message: string;
}

/**
 * Compares the form's category with what the photo shows. A mismatch needs a
 * confident look; a low-confidence look is "unsure", which also asks for
 * another photo rather than guessing either way.
 */
export function compareIdentity(formItemType: string | undefined, identity: PieceIdentity | null): IdentityVerdict {
  if (!identity) return { status: 'unchecked', message: '' };
  const formFamily = familyFor(formItemType);
  if (identity.confidence === 'low') {
    return { status: 'unsure', message: 'The AI could not tell for sure what this piece is from the photo. Add another photo from a different angle, or confirm the category.' };
  }
  if (!formFamily || formFamily === 'other' || identity.family === 'other') return { status: 'unchecked', message: '' };
  if (formFamily !== identity.family) {
    return {
      status: 'mismatch',
      message: `The form says "${formItemType}" but the photo looks like ${FAMILY_LABEL[identity.family]}. Check the category - or add another photo from a different angle.`,
    };
  }
  return { status: 'match', message: '' };
}
