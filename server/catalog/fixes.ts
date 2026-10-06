// The one-tap fixes staff can ask for in Review, and what each one tells the
// image model. Shared by the Review screen (labels) and the server (prompt
// text, and design memory).
//
// Each fix names ONE concrete problem in the words staff would use, and turns
// it into an exact instruction. "Try again" with no reason just rolls the dice
// again; "the black beads were turned gold" tells the model what to protect.

import type { AuditCheck } from '../ai/operations';

export interface FixOption {
  code: string;
  /** What staff tap. Short - these are buttons on a phone. */
  label: string;
  /** What the image model is told when staff pick it. */
  instruction: string;
  /** How design memory phrases it for the next piece of the same style. */
  lesson: string;
}

export const FIX_OPTIONS: FixOption[] = [
  {
    code: 'black_beads',
    label: 'Black beads turned gold',
    instruction: 'Black beads (pote) were turned gold or dropped. Every black bead in the original must stay black, at the same count and in the same positions. None may be turned gold, removed or added.',
    lesson: 'black beads were turned gold or dropped - keep every black bead black, same count and positions',
  },
  {
    code: 'beads',
    label: 'Beads, moti or latkan changed',
    instruction: 'Beads, moti (pearls), latkan (hanging drops), balls or tassels were changed. Keep every one exactly as in the original: same count, size, shape and positions.',
    lesson: 'beads, moti, latkan or drops were changed - keep every one, same count and positions',
  },
  {
    code: 'hook',
    label: 'Hook or clasp wrong',
    instruction: 'The hook or clasp was changed. Keep the exact hook from the original, at the same end, same size and style, fully visible. Most pieces here close with an S hook (a small S-shaped wire hook): if the original shows one, draw that same S hook - never swap it for a lobster clasp, spring ring or box clasp, and never leave it out.',
    lesson: 'the hook or clasp was changed - keep the exact hook (usually an S hook), visible, at the same end',
  },
  {
    code: 'chain_cut',
    label: 'Chain cut off or too short',
    instruction: 'The chain was cut off, faded out or shortened. Draw the WHOLE chain from one end to the other, as long as in the original, with both ends and the hook inside the frame. If needed, make the piece smaller in the frame - never crop or shorten it.',
    lesson: 'the chain came out cut off or too short - show it end to end with both ends and the hook in the frame',
  },
  {
    code: 'earring_design',
    label: 'Earring design changed',
    instruction: 'The earrings were changed. Copy each earring exactly as in the original: same shape, size, stones, beads, drops and top fitting, and a matching pair like the original. Do not redesign, simplify or restyle them.',
    lesson: 'the earrings were redesigned - copy each one exactly, same shape, drops and top fitting',
  },
  {
    code: 'stones',
    label: 'Stones changed',
    instruction: 'Stones were changed. Keep every stone exactly as in the original: same count, colour, cut and position. Do not add, remove or recolour any.',
    lesson: 'stones were changed - keep every stone, same count, colour and positions',
  },
  {
    code: 'chain',
    label: 'Chain or links changed',
    instruction: 'The chain was changed. Keep the exact link style, link size and number of strands from the original.',
    lesson: 'the chain link style or strand count was changed - keep it exactly',
  },
  {
    code: 'motif',
    label: 'Design or motif changed',
    instruction: 'The design was changed. Keep every motif, engraving, cut-out and pattern exactly as in the original. Do not simplify, redraw, smooth over or add decoration.',
    lesson: 'motifs or patterns were redrawn - keep every motif and cut-out exactly',
  },
  {
    code: 'shape',
    label: 'Shape or drape wrong',
    instruction: 'The shape was changed. Keep the real shape and proportions of the piece, and let chains and drops hang as they do in the original.',
    lesson: 'the shape or drape was changed - keep the real proportions and natural hang',
  },
  {
    code: 'too_yellow',
    label: 'Gold too yellow',
    instruction: 'The gold came out too yellow or orange. Render natural 22kt gold: warm, but not orange and not over-saturated.',
    lesson: 'gold came out too yellow - keep it natural 22kt, not orange',
  },
  {
    code: 'too_pale',
    label: 'Gold too pale or dull',
    instruction: 'The gold came out too pale or dull. Render rich, bright 22kt gold with natural highlights.',
    lesson: 'gold came out pale or dull - keep it rich and bright',
  },
  {
    code: 'background',
    label: 'Background not clean',
    instruction: 'The background was not clean. It must be pure, even white with only a soft, natural shadow under the piece.',
    lesson: 'the background was not clean white',
  },
  {
    code: 'leftovers',
    label: 'Thread, tag, back chain or stand showing',
    instruction: 'Something that is not part of the jewellery was left in. Remove every thread, string or tie, price tag, label, sticker, stand, pin, clip and finger completely, and any holding chain that is only there to hang or hold the piece. Only the jewellery itself may remain.',
    lesson: 'a thread, tag, stand or holding chain was left in - remove everything that is not part of the jewellery',
  },
];

/** Reasons for sending a piece back for a new photo that are about the photo, not the AI. Not an AI instruction. */
export const RESHOOT_ONLY_REASONS: { code: string; label: string }[] = [
  { code: 'photo_bad', label: 'My own photo was bad (blurry, cropped, dark)' },
];

/** Every reason the Reshoot picker accepts: the fix problems, plus the photo being bad. */
export function isReshootReason(code: string): boolean {
  return BY_CODE.has(code) || RESHOOT_ONLY_REASONS.some((r) => r.code === code);
}

/** Not an AI instruction: cut the piece out of the real photo instead (faithful mode). */
export const USE_REAL_PHOTO = 'real_photo';

const BY_CODE = new Map(FIX_OPTIONS.map((f) => [f.code, f]));

export function isFixCode(code: string): boolean {
  return BY_CODE.has(code);
}

export function fixOption(code: string): FixOption | undefined {
  return BY_CODE.get(code);
}

// The audit's fidelity checks, as the fix staff would have picked for them.
// Only checks a prompt can do something about - a blurry or cropped source
// photo is not a lesson for the next piece.
export const AUDIT_CHECK_TO_FIX: Partial<Record<AuditCheck, string>> = {
  beadDetailPreserved: 'beads',
  stoneCountMatches: 'stones',
  chainPatternMatches: 'chain',
  engravingPreserved: 'motif',
  naturalDropPhysics: 'shape',
  backgroundCleanWhite: 'background',
  hookClaspMatches: 'hook',
  chainComplete: 'chain_cut',
};

// Staff notes go into a prompt, so they are kept short and on one line.
export function cleanNote(note: unknown): string {
  return String(note ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * The block added to the enhance prompt when staff asked for specific fixes.
 * Placed after every other rule, so it is the last thing the model reads.
 */
export function buildFixBlock(codes: string[], note: string): string {
  const lines = codes.map((c) => BY_CODE.get(c)?.instruction).filter(Boolean) as string[];
  const cleaned = cleanNote(note);
  if (lines.length === 0 && !cleaned) return '';
  return `

STAFF CORRECTION - HIGHEST PRIORITY:
A previous version of this photo was rejected by the store's staff, who know this piece. Fix each of these problems while still following every rule above:
${lines.map((l) => `- ${l}`).join('\n')}${cleaned ? `\n- Staff note: "${cleaned}"` : ''}`;
}
