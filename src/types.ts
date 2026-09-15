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
}

export interface QueueDepth {
  queued: number;
  running: number;
  failed: number;
}

export interface HealthFeatures {
  ai: boolean;
  driveExport: boolean;
  studioCamera: boolean;
  axiomMirror: boolean;
}

// Human-readable labels for the audit checklist keys the server returns.
// Keys must match AUDIT_CHECKS in server/ai/operations.ts.
export const AUDIT_CHECK_LABELS: Record<string, string> = {
  sharpFocus: 'Sharp focus',
  notCropped: 'Nothing cropped',
  backgroundCleanWhite: 'Clean white background',
  noBlownHighlights: 'No blown highlights',
  neutralWhiteBalance: 'Neutral white balance',
  colorConsistentAcrossSurface: 'Even colour across the piece',
  clearlyIdentifiableCategory: 'Clearly identifiable',
  matchesOriginalDesign: 'Matches the real design',
  naturalDropPhysics: 'Natural drape and drop',
};

export const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  processing: 'Processing',
  awaiting_review: 'Ready to review',
  approved: 'Approved',
  exported: 'Exported',
  needs_reshoot: 'Needs reshoot',
  failed: 'Failed',
};
