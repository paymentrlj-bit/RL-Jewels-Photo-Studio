import type { Product } from '../types';
import { AUDIT_CHECK_LABELS, AUDIT_CHECK_FAILURE_LABELS } from '../types';

// What staff actually need to know is "what's wrong", in their own words -
// not the AI's paragraph of reasoning ("Bead count mismatch: original had
// 14 gold balls (7 per side), enhanced image has 16 gold balls (8 per
// side)."). Where a checklist exists, this turns the failed checks into the
// same short phrases used everywhere else in the app (AUDIT_CHECK_LABELS),
// and keeps the AI's full sentence as an optional "Details" underneath
// rather than the headline.
export function plainSummary(product: Product): string | null {
  const failed = Object.entries(product.auditChecklist || {}).filter(([, passed]) => !passed);
  if (failed.length === 0) return null;
  return failed.map(([key]) => AUDIT_CHECK_FAILURE_LABELS[key] || AUDIT_CHECK_LABELS[key] || key).join(', ');
}


/** Why a piece needs another go, in the words a photographer needs: the manager's note first, then the failed checks, then the AI's sentence. */
export function retakeReason(product: Product): string {
  return product.reviewNote || plainSummary(product) || product.auditReason || 'Please retake this photo.';
}
