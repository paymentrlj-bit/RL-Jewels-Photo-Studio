// Product and batch repository - every read and write of the two tables that
// hold the actual work product goes through here.

import { getDb, newId, nowIso } from './index';
import type { AuditCheck } from '../ai/operations';

// draft         - created, no photo yet
// queued        - photo captured, waiting for a worker
// processing    - a worker has it
// awaiting_review - AI passed its own QA, a human needs to sign off
// approved      - human approved, ready to export
// exported      - written out to CSV/Drive
// needs_reshoot - AI QA failed twice; the photo itself is the problem
// failed        - a transient error exhausted its retries; safe to requeue
export const PRODUCT_STATUSES = [
  'draft',
  'queued',
  'processing',
  'awaiting_review',
  'approved',
  'exported',
  'needs_reshoot',
  'failed',
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

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
  auditChecklist: Record<AuditCheck, boolean> | null;
  auditReason: string;
  modelUsed: string;
  attemptCount: number;
  estimatedCostUsd: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  exportedAt: string | null;
}

interface ProductRow {
  id: string;
  batch_id: string | null;
  cpc: string;
  catalog_product_id: string | null;
  name: string;
  description: string;
  seo_meta_title: string;
  seo_meta_description: string;
  seo_keywords: string;
  image_alt_text: string;
  url_slug: string;
  item_type: string;
  purity: string;
  gender: string;
  size: string;
  gross_weight_grams: string;
  other_weight_grams: string;
  net_weight_grams: string;
  status: string;
  review_note: string;
  audit_checklist: string | null;
  audit_reason: string;
  model_used: string;
  attempt_count: number;
  estimated_cost_usd: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  exported_at: string | null;
}

function toProduct(row: ProductRow): Product {
  let auditChecklist: Record<AuditCheck, boolean> | null = null;
  if (row.audit_checklist) {
    try {
      auditChecklist = JSON.parse(row.audit_checklist);
    } catch {
      auditChecklist = null;
    }
  }
  return {
    id: row.id,
    batchId: row.batch_id,
    cpc: row.cpc,
    catalogProductId: row.catalog_product_id,
    name: row.name,
    description: row.description,
    seoMetaTitle: row.seo_meta_title,
    seoMetaDescription: row.seo_meta_description,
    seoKeywords: row.seo_keywords,
    imageAltText: row.image_alt_text,
    urlSlug: row.url_slug,
    itemType: row.item_type,
    purity: row.purity,
    gender: row.gender,
    size: row.size,
    grossWeightGrams: row.gross_weight_grams,
    otherWeightGrams: row.other_weight_grams,
    netWeightGrams: row.net_weight_grams,
    status: row.status as ProductStatus,
    reviewNote: row.review_note,
    auditChecklist,
    auditReason: row.audit_reason,
    modelUsed: row.model_used,
    attemptCount: row.attempt_count,
    estimatedCostUsd: row.estimated_cost_usd,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    exportedAt: row.exported_at,
  };
}

// Maps camelCase fields onto their snake_case columns. Only these are
// writable through updateProduct - status transitions and AI results have
// their own dedicated functions so they cannot be set by accident from a
// form submission.
const EDITABLE_COLUMNS: Record<string, string> = {
  cpc: 'cpc',
  catalogProductId: 'catalog_product_id',
  name: 'name',
  description: 'description',
  seoMetaTitle: 'seo_meta_title',
  seoMetaDescription: 'seo_meta_description',
  seoKeywords: 'seo_keywords',
  imageAltText: 'image_alt_text',
  urlSlug: 'url_slug',
  itemType: 'item_type',
  purity: 'purity',
  gender: 'gender',
  size: 'size',
  grossWeightGrams: 'gross_weight_grams',
  otherWeightGrams: 'other_weight_grams',
  netWeightGrams: 'net_weight_grams',
  reviewNote: 'review_note',
  batchId: 'batch_id',
};

export function createProduct(input: { createdBy: string; batchId?: string | null } & Partial<Product>): Product {
  const id = newId('prd');
  const at = nowIso();

  const row: ProductRow = {
    id,
    batch_id: input.batchId ?? null,
    cpc: input.cpc ?? '',
    catalog_product_id: input.catalogProductId ?? null,
    name: input.name ?? '',
    description: input.description ?? '',
    seo_meta_title: '',
    seo_meta_description: '',
    seo_keywords: '',
    image_alt_text: '',
    url_slug: '',
    item_type: input.itemType ?? '',
    purity: input.purity ?? '22kt',
    gender: input.gender ?? 'unisex',
    size: input.size ?? 'DEFAULT',
    gross_weight_grams: input.grossWeightGrams ?? '',
    other_weight_grams: input.otherWeightGrams ?? '',
    net_weight_grams: input.netWeightGrams ?? '',
    status: 'draft',
    review_note: '',
    audit_checklist: null,
    audit_reason: '',
    model_used: '',
    attempt_count: 0,
    estimated_cost_usd: 0,
    created_by: input.createdBy,
    created_at: at,
    updated_at: at,
    approved_at: null,
    exported_at: null,
  };

  getDb()
    .prepare(
      `INSERT INTO products (
        id, batch_id, cpc, catalog_product_id, name, description,
        seo_meta_title, seo_meta_description, seo_keywords, image_alt_text, url_slug,
        item_type, purity, gender, size,
        gross_weight_grams, other_weight_grams, net_weight_grams,
        status, review_note, audit_checklist, audit_reason, model_used,
        attempt_count, estimated_cost_usd, created_by, created_at, updated_at,
        approved_at, exported_at
      ) VALUES (
        @id, @batch_id, @cpc, @catalog_product_id, @name, @description,
        @seo_meta_title, @seo_meta_description, @seo_keywords, @image_alt_text, @url_slug,
        @item_type, @purity, @gender, @size,
        @gross_weight_grams, @other_weight_grams, @net_weight_grams,
        @status, @review_note, @audit_checklist, @audit_reason, @model_used,
        @attempt_count, @estimated_cost_usd, @created_by, @created_at, @updated_at,
        @approved_at, @exported_at
      )`
    )
    .run(row);

  return toProduct(row);
}

export function getProduct(id: string): Product | null {
  const row = getDb().prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
  return row ? toProduct(row) : null;
}

export function updateProduct(id: string, fields: Partial<Product>): Product | null {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id, updated_at: nowIso() };

  for (const [key, column] of Object.entries(EDITABLE_COLUMNS)) {
    if (key in fields) {
      sets.push(`${column} = @${column}`);
      params[column] = (fields as Record<string, unknown>)[key];
    }
  }

  if (sets.length === 0) return getProduct(id);

  getDb()
    .prepare(`UPDATE products SET ${sets.join(', ')}, updated_at = @updated_at WHERE id = @id`)
    .run(params);

  return getProduct(id);
}

export function setProductStatus(id: string, status: ProductStatus, extra?: { reviewNote?: string }): void {
  const at = nowIso();
  const approvedAt = status === 'approved' ? at : null;
  const exportedAt = status === 'exported' ? at : null;

  getDb()
    .prepare(
      `UPDATE products SET
         status = ?,
         review_note = COALESCE(?, review_note),
         approved_at = COALESCE(?, approved_at),
         exported_at = COALESCE(?, exported_at),
         updated_at = ?
       WHERE id = ?`
    )
    .run(status, extra?.reviewNote ?? null, approvedAt, exportedAt, at, id);
}

export function recordAuditResult(
  id: string,
  result: {
    checklist: Record<AuditCheck, boolean> | null;
    reason: string;
    modelUsed: string;
    attemptCount: number;
    estimatedCostUsd: number;
  }
): void {
  getDb()
    .prepare(
      `UPDATE products SET
         audit_checklist = ?, audit_reason = ?, model_used = ?,
         attempt_count = ?, estimated_cost_usd = estimated_cost_usd + ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      result.checklist ? JSON.stringify(result.checklist) : null,
      result.reason,
      result.modelUsed,
      result.attemptCount,
      result.estimatedCostUsd,
      nowIso(),
      id
    );
}

export function applyGeneratedCopy(
  id: string,
  copy: {
    name: string;
    description: string;
    metaTitle: string;
    metaDescription: string;
    imageAltText: string;
    searchKeywords: string;
    urlSlug: string;
  },
  costUsd: number
): void {
  // Does not overwrite a name or description a staff member has already
  // written - AI copy is a starting point, and re-running it must never
  // silently discard a human's edit.
  getDb()
    .prepare(
      `UPDATE products SET
         name = CASE WHEN name = '' THEN ? ELSE name END,
         description = CASE WHEN description = '' THEN ? ELSE description END,
         seo_meta_title = ?, seo_meta_description = ?, image_alt_text = ?,
         seo_keywords = ?, url_slug = ?,
         estimated_cost_usd = estimated_cost_usd + ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      copy.name,
      copy.description,
      copy.metaTitle,
      copy.metaDescription,
      copy.imageAltText,
      copy.searchKeywords,
      copy.urlSlug,
      costUsd,
      nowIso(),
      id
    );
}

export interface ListProductsOptions {
  batchId?: string;
  statuses?: ProductStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

export function listProducts(options: ListProductsOptions = {}): Product[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.batchId) {
    clauses.push('batch_id = ?');
    params.push(options.batchId);
  }
  if (options.statuses?.length) {
    clauses.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  if (options.search) {
    clauses.push('(cpc LIKE ? OR name LIKE ? OR item_type LIKE ?)');
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM products ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(options.limit ?? 100, 500), options.offset ?? 0) as ProductRow[];

  return rows.map(toProduct);
}

export function countProductsByStatus(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS n FROM products GROUP BY status')
    .all() as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

// "Have we already shot this?" - the question a 3,247-SKU catalogue run needs
// answered constantly and v1 could not answer at all, because it kept no
// history. Matches on the catalog ProductId, so a different lot of the same
// product still counts as already shot.
export function findPreviousShoots(catalogProductId: string, excludeProductId?: string): Product[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM products
       WHERE catalog_product_id = ? AND id != COALESCE(?, '')
         AND status IN ('approved', 'exported')
       ORDER BY created_at DESC LIMIT 5`
    )
    .all(catalogProductId, excludeProductId ?? null) as ProductRow[];
  return rows.map(toProduct);
}

export function deleteProduct(id: string): void {
  getDb().prepare('DELETE FROM products WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

export interface Batch {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  closedAt: string | null;
}

interface BatchRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

function toBatch(row: BatchRow): Batch {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

export function createBatch(name: string, createdBy: string): Batch {
  const row: BatchRow = {
    id: newId('bch'),
    name: name.trim() || `Shoot ${new Date().toLocaleDateString('en-IN')}`,
    created_by: createdBy,
    created_at: nowIso(),
    closed_at: null,
  };
  getDb()
    .prepare('INSERT INTO batches (id, name, created_by, created_at, closed_at) VALUES (@id, @name, @created_by, @created_at, @closed_at)')
    .run(row);
  return toBatch(row);
}

export function getBatch(id: string): Batch | null {
  const row = getDb().prepare('SELECT * FROM batches WHERE id = ?').get(id) as BatchRow | undefined;
  return row ? toBatch(row) : null;
}

export function listBatches(limit = 50): (Batch & { productCount: number })[] {
  const rows = getDb()
    .prepare(
      `SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.batch_id = b.id) AS product_count
       FROM batches b ORDER BY b.created_at DESC LIMIT ?`
    )
    .all(limit) as (BatchRow & { product_count: number })[];
  return rows.map((row) => ({ ...toBatch(row), productCount: row.product_count }));
}

export function closeBatch(id: string): void {
  getDb().prepare('UPDATE batches SET closed_at = ? WHERE id = ?').run(nowIso(), id);
}

// The batch a staff member is actively shooting into: their most recent open
// one. Saves making them pick a batch on every single capture.
export function findOpenBatchFor(userId: string): Batch | null {
  const row = getDb()
    .prepare('SELECT * FROM batches WHERE created_by = ? AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1')
    .get(userId) as BatchRow | undefined;
  return row ? toBatch(row) : null;
}
