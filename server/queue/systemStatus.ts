// Tracks the handful of pipeline failures that mean EVERY photo is stuck,
// not just the one in front of it - a spend cap, a withdrawn model. Staff
// otherwise have no way to tell "my photo failed" from "nothing is working
// at all and nobody has noticed yet," and the queue count alone just sits
// there climbing with no explanation.
//
// In-memory and best-effort on purpose: this is a banner, not a record - the
// real, permanent account of what happened is the event log. Losing it on a
// restart costs nothing, since the very next job that hits the same problem
// sets it again.

export type BlockingIssueCode = 'billing_cap' | 'escalation_model_missing';

export interface BlockingIssue {
  code: BlockingIssueCode;
  /** Plain-language, staff-facing - shown as-is in the app. */
  message: string;
  since: string;
}

let current: BlockingIssue | null = null;

export function reportBlockingIssue(code: BlockingIssueCode, message: string): void {
  // The first occurrence sets "since" - a second failure of the same kind
  // does not push the clock forward, so the banner honestly shows how long
  // it has actually been broken.
  if (current?.code === code) return;
  current = { code, message, since: new Date().toISOString() };
}

// Called on every successful pipeline completion: proof the account and the
// model both work right now, so whatever was wrong is no longer the case.
export function clearBlockingIssue(): void {
  current = null;
}

export function getBlockingIssue(): BlockingIssue | null {
  return current;
}
