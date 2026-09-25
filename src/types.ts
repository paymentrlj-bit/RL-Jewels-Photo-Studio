// Client-side types, mirroring what the API actually returns.
//
// Much smaller than v1's: most of what lived here was UI state for a
// single in-flight product held in React. The server owns that state now,
// so these are mostly response shapes.

export type GoldPurity = '18kt' | '22kt' | '24kt';
export type ProductGender = "women's" | "men's" | 'unisex' | "kids'";

export type ProductStatus =
  | 'draft'
  | 'queued'
  | 'processing'
  | 'awaiting_review'
  | 'approved'
  | 'exported'
  | 'needs_angle'
  | 'needs_reshoot'
  | 'failed';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_reshoot';

export interface JobSummary {
  id: string;
  status: JobStatus;
  stage: string;
  attempts: number;
  maxAttempts: number;
  lastError: string;
}

export interface Product {
  id: string;
  batchId: string | null;
  cpc: string;
  catalogProductId: string | null;
  name: string;
  description: string;
  seoMetaTitle: string;
  seoMetaDescription: string;
  seoKeywords: string;
  imageAltText: string;
  urlSlug: string;
  itemType: string;
  purity: string;
  gender: string;
  size: string;
  grossWeightGrams: string;
  otherWeightGrams: string;
  netWeightGrams: string;
  status: ProductStatus;
  reviewNote: string;
  auditChecklist: Record<string, boolean> | null;
  auditReason: string;
  modelUsed: string;
  attemptCount: number;
  estimatedCostUsd: number;
  createdAt: string;
  approvedAt: string | null;
  staffName: string;
  originalPhotoId: string | null;
  processedPhotoId: string | null;
  /** 'faithful' = the piece cut out of the real photo, nothing generated. */
  renderMode: 'ai' | 'faithful' | null;
  /** Extra photos of this piece from other angles, for the current original. */
  anglePhotoIds: string[];
  job: JobSummary | null;
}

export interface Batch {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
  productCount?: number;
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

export interface CpcMasterRecord {
  productId: string;
  styleName: string;
  sizeName: string;
  designName: string;
  groupName: string;
  purity: string;
  sellByPiece: string;
  lotCount: string;
}

export interface CpcLookupResult {
  matchType: 'certain' | 'guess' | 'none';
  cpcNumber: string;
  productId: string | null;
  record: CpcMasterRecord | null;
  normalizedPurity: GoldPurity | null;
  genderGuess: ProductGender | null;
  previousShoots: Product[];
  /** This exact tag is already mid-process somewhere in the system. */
  activeDuplicate: Product | null;
}

/** A failure that isn't about one photo - the whole queue is stuck until this clears. */
export interface BlockingIssue {
  code: 'billing_cap' | 'escalation_model_missing';
  message: string;
  since: string;
}

export interface QueueDepth {
  queued: number;
  running: number;
  failed: number;
}

export interface HealthFeatures {
  ai: boolean;
  driveExport: boolean;
  axiomMirror: boolean;
}

// Human-readable labels for the audit checklist keys the server returns.
// Keys must match AUDIT_CHECKS in server/ai/operations.ts.
// Plain, simple words on purpose - this is read by staff who may not be
// native English speakers, not photographers. "No blown highlights" and
// "neutral white balance" are correct camera terms nobody on the floor uses.
export const AUDIT_CHECK_LABELS: Record<string, string> = {
  sharpFocus: 'In focus, not blurry',
  notCropped: 'Whole piece in the photo',
  backgroundCleanWhite: 'Clean white background',
  noBlownHighlights: 'No harsh white glare',
  neutralWhiteBalance: 'Natural colour, not yellow or blue',
  colorConsistentAcrossSurface: 'Even colour across the piece',
  clearlyIdentifiableCategory: 'Easy to tell what it is',
  stoneCountMatches: 'Stone count unchanged',
  beadDetailPreserved: 'Bead and tassel count unchanged',
  chainPatternMatches: 'Chain and strand pattern unchanged',
  engravingPreserved: 'Engraving and motifs unchanged',
  naturalDropPhysics: 'Hangs naturally, like the original',
};

// The same checks, worded as what's WRONG rather than what a pass looks
// like - AUDIT_CHECK_LABELS above reads backwards when used to explain a
// failure ("Bead and tassel count unchanged" next to a rejected photo reads
// as if it passed). Used anywhere a failed check is the headline.
export const AUDIT_CHECK_FAILURE_LABELS: Record<string, string> = {
  sharpFocus: 'Photo is blurry',
  notCropped: 'Part of the piece is cut off',
  backgroundCleanWhite: "Background isn't clean white",
  noBlownHighlights: 'Harsh white glare on the piece',
  neutralWhiteBalance: 'Colour looks too yellow or too blue',
  colorConsistentAcrossSurface: 'Colour is uneven across the piece',
  clearlyIdentifiableCategory: "Hard to tell what it is",
  stoneCountMatches: "Stone count doesn't match the original",
  beadDetailPreserved: "Bead or tassel count doesn't match the original",
  chainPatternMatches: "Chain or strand pattern doesn't match the original",
  engravingPreserved: "Engraving or motifs don't match the original",
  naturalDropPhysics: "Doesn't hang the way the original does",
};

export const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  processing: 'Processing',
  awaiting_review: 'Ready to review',
  approved: 'Approved',
  exported: 'Exported',
  needs_angle: 'Needs another angle',
  needs_reshoot: 'Needs reshoot',
  failed: 'Failed',
};
