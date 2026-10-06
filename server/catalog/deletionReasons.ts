// Why staff delete a product. Asked when they delete (the delete itself is an
// archive - see db/products.ts), so the Archive tab can show not only WHAT was
// thrown away but WHY, which is the part that tells us what to fix: the AI's
// picture, the counter photo, or just a mistake at the keyboard.
//
// Shared with the browser, so keep it dependency-free.

export interface DeletionReason {
  code: string;
  /** What staff tap. */
  label: string;
  /** What the Archive tab says. */
  short: string;
  /** True when a few words of explanation are needed. */
  needsNote?: boolean;
}

export const DELETION_REASONS: DeletionReason[] = [
  { code: 'ai_not_true', label: 'The studio picture was not true to my piece', short: 'AI picture not true to the piece' },
  { code: 'ai_looks_bad', label: 'The studio picture looked bad (colour, light, shape)', short: 'AI picture looked bad' },
  { code: 'photo_bad', label: 'My own photo was bad (blurry, cropped, dark)', short: 'Counter photo was bad' },
  { code: 'wrong_details', label: 'Wrong category or details were entered', short: 'Wrong category or details' },
  { code: 'duplicate', label: 'Shot twice by mistake', short: 'Duplicate' },
  { code: 'test', label: 'Test or practice entry', short: 'Test entry' },
  { code: 'other', label: 'Something else', short: 'Other', needsNote: true },
];

/** Staff delete from a screen that predates this question, or an old cached app. */
export const UNSPECIFIED_REASON: DeletionReason = { code: '', label: '', short: 'No reason given' };

export function findReason(code: string | null | undefined): DeletionReason {
  return DELETION_REASONS.find((r) => r.code === code) ?? UNSPECIFIED_REASON;
}

/** A reason code from a request, or '' when missing or not one of ours. */
export function cleanReasonCode(value: unknown): string {
  const code = String(value ?? '').trim();
  return DELETION_REASONS.some((r) => r.code === code) ? code : '';
}

export function cleanReasonNote(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}
