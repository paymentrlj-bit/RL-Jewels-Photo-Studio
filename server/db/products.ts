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
// needs_angle   - part of the piece is hidden in the photo; one more photo
//                 from another angle before paying for the enhancement
// needs_reshoot - AI QA failed twice; the photo itself is the problem
// failed        - a transient error exhausted its retries; safe to requeue
export const PRODUCT_STATUSES = [
  'draft',
  'queued',
  'processing',
  'awaiting_review',
  'approved',
  'exported',
  'needs_angle',
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
  /** Fidelity risk of the AI render (catalog/risk.ts). Null until the pipeline has run. */
  riskScore: number | null;
  riskTier: '' | 'low' | 'medium' | 'high';
  riskReasons: string[];
  /** Design tags staff tapped when shooting, and what the AI saw. */
  tags: string[];
  aiTags: string[];
  staffNote: string;
  /** Selling price in rupees (digits only), or '' when not set. */
  priceInr: string;
  modelUsed: string;
  attemptCount: number;
  estimatedCostUsd: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  exportedAt: string | null;
  /** Set when staff deleted it. Archived products are invisible everywhere except the admin Archive tab. */
  archivedAt: string | null;
  archivedBy: string | null;
  /** The status it had when it was deleted. */
  archivedStatus: string;
  /** Why staff said they deleted it (catalog/deletionReasons.ts code), or ''. */
  archivedReason: string;
  archivedNote: string;
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
  risk_score: number | null;
  risk_tier: string;
  risk_reasons: string;
  tags: string;
  ai_tags: string;
  staff_note: string;
  price_inr: string;
  model_used: string;
  attempt_count: number;
  estimated_cost_usd: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  exported_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  archived_status: string;
  archived_reason: string;
  archived_note: string;
}

function parseStringArray(json: string | null): string[] {
  try {
    const v = JSON.parse(json || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
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
    riskScore: row.risk_score,
    riskTier: (row.risk_tier || '') as Product['riskTier'],
    riskReasons: parseStringArray(row.risk_reasons),
    tags: parseStringArray(row.tags),
    aiTags: parseStringArray(row.ai_tags),
    staffNote: row.staff_note,
    priceInr: row.price_inr,
    modelUsed: row.model_used,
    attemptCount: row.attempt_count,
    estimatedCostUsd: row.estimated_cost_usd,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    exportedAt: row.exported_at,
    archivedAt: row.archived_at ?? null,
    archivedBy: row.archived_by ?? null,
    archivedStatus: row.archived_status ?? '',
    archivedReason: row.archived_reason ?? '',
    archivedNote: row.archived_note ?? '',
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
  priceInr: 'price_inr',
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
    risk_score: null,
    risk_tier: '',
    risk_reasons: '[]',
    tags: JSON.stringify(input.tags ?? []),
    ai_tags: '[]',
    staff_note: input.staffNote ?? '',
    price_inr: '',
    model_used: '',
    attempt_count: 0,
    estimated_cost_usd: 0,
    created_by: input.createdBy,
    created_at: at,
    updated_at: at,
    approved_at: null,
    exported_at: null,
    archived_at: null,
    archived_by: null,
    archived_status: '',
    archived_reason: '',
    archived_note: '',
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

/**
 * A product, unless it has been deleted: an archived product reads as "not found"
 * to everything that serves staff (and to the pipeline, so a deleted photo is
 * never processed). Only the admin Archive tab asks for archived ones.
 */
export function getProduct(id: string, options: { includeArchived?: boolean } = {}): Product | null {
  const row = getDb().prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
  if (!row || (row.archived_at && !options.includeArchived)) return null;
  return toProduct(row);
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

export function recordAiTags(id: string, tags: string[]): void {
  getDb().prepare('UPDATE products SET ai_tags = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(tags), nowIso(), id);
}

export function recordRisk(id: string, risk: { score: number; tier: string; reasons: string[] }): void {
  getDb()
    .prepare('UPDATE products SET risk_score = ?, risk_tier = ?, risk_reasons = ?, updated_at = ? WHERE id = ?')
    .run(risk.score, risk.tier, JSON.stringify(risk.reasons), nowIso(), id);
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
  /** 'exclude' (default) hides deleted products; 'only' lists just those. */
  archived?: 'exclude' | 'only';
  batchId?: string;
  statuses?: ProductStatus[];
  search?: string;
  limit?: number;
  offset?: number;
}

export function listProducts(options: ListProductsOptions = {}): Product[] {
  const clauses: string[] = [options.archived === 'only' ? 'archived_at IS NOT NULL' : 'archived_at IS NULL'];
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
    .prepare(`SELECT * FROM products ${where} ORDER BY ${options.archived === 'only' ? 'archived_at' : 'created_at'} DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(options.limit ?? 100, 500), options.offset ?? 0) as ProductRow[];

  return rows.map(toProduct);
}

/**
 * Just the columns a category or weight filter needs, for every matching product
 * (no 500-row cap), newest first. The caller filters, then loads the page it shows.
 */
export function listFilterRows(options: { statuses?: ProductStatus[]; search?: string } = {}): { id: string; itemType: string; netWeightGrams: string; grossWeightGrams: string }[] {
  const clauses = ['archived_at IS NULL'];
  const params: unknown[] = [];
  if (options.statuses?.length) {
    clauses.push(`status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  if (options.search) {
    clauses.push('(cpc LIKE ? OR name LIKE ? OR item_type LIKE ?)');
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  const rows = getDb()
    .prepare(`SELECT id, item_type, net_weight_grams, gross_weight_grams FROM products WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
    .all(...params) as { id: string; item_type: string; net_weight_grams: string; gross_weight_grams: string }[];
  return rows.map((r) => ({ id: r.id, itemType: r.item_type, netWeightGrams: r.net_weight_grams, grossWeightGrams: r.gross_weight_grams }));
}

export function countProductsByStatus(): Record<string, number> {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS n FROM products WHERE archived_at IS NULL GROUP BY status')
    .all() as { status: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export function listOutcomeRows(sinceIso: string): { itemType: string; status: string; riskTier: string; riskScore: number | null }[] {
  const rows = getDb()
    .prepare("SELECT item_type, status, risk_tier, risk_score FROM products WHERE created_at >= ? AND status NOT IN ('draft') AND archived_at IS NULL")
    .all(sinceIso) as { item_type: string; status: string; risk_tier: string; risk_score: number | null }[];
  return rows.map((r) => ({ itemType: r.item_type, status: r.status, riskTier: r.risk_tier, riskScore: r.risk_score }));
}

export function listStaffRows(sinceIso: string): { userId: string; name: string; status: string; riskScore: number | null; checklist: Record<string, boolean> | null }[] {
  const rows = getDb()
    .prepare(
      `SELECT p.created_by AS user_id, COALESCE(NULLIF(u.display_name, ''), u.username, 'Unknown') AS name,
              p.status, p.risk_score, p.audit_checklist
         FROM products p LEFT JOIN users u ON u.id = p.created_by
        WHERE p.created_at >= ? AND p.status NOT IN ('draft') AND p.archived_at IS NULL`
    )
    .all(sinceIso) as { user_id: string; name: string; status: string; risk_score: number | null; audit_checklist: string | null }[];
  return rows.map((r) => {
    let checklist: Record<string, boolean> | null = null;
    try {
      checklist = r.audit_checklist ? (JSON.parse(r.audit_checklist) as Record<string, boolean>) : null;
    } catch {
      checklist = null;
    }
    return { userId: r.user_id, name: r.name, status: r.status, riskScore: r.risk_score, checklist };
  });
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
         AND archived_at IS NULL
         AND status IN ('approved', 'exported')
       ORDER BY created_at DESC LIMIT 5`
    )
    .all(catalogProductId, excludeProductId ?? null) as ProductRow[];
  return rows.map(toProduct);
}

// Statuses that mean "someone already has this exact tag in progress right
// now" - as opposed to approved/exported, which is a finished catalogue
// entry that a legitimate restock or refresh can reasonably shoot again.
const ACTIVE_STATUSES = "'draft','queued','processing','awaiting_review','needs_angle','needs_reshoot','failed'";

/**
 * The real duplicate check: the exact same CPC (the code printed on the
 * tag), not just the same ProductId - a ProductId covers every lot of a
 * style (1516 alone is 307 different physical pieces), so matching on that
 * alone would wrongly flag shooting a different piece of the same design.
 *
 * Scoped to statuses that mean the earlier shoot is still unfinished
 * business: scanning the same tag while it is already queued, awaiting
 * review, or waiting on a reshoot is very likely the same piece getting
 * photographed twice by mistake, not two different sessions of real work.
 */
export function findActiveDuplicate(cpc: string, excludeProductId?: string): Product | null {
  const normalized = cpc.trim().toUpperCase();
  if (!normalized) return null;
  const row = getDb()
    .prepare(
      `SELECT * FROM products
       WHERE UPPER(TRIM(cpc)) = ? AND id != COALESCE(?, '')
         AND archived_at IS NULL
         AND status IN (${ACTIVE_STATUSES})
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(normalized, excludeProductId ?? null) as ProductRow | undefined;
  return row ? toProduct(row) : null;
}

/** Removes the row for good. Only the admin Archive tab's "Delete forever" uses this. */
export function deleteProduct(id: string): void {
  getDb().prepare('DELETE FROM products WHERE id = ?').run(id);
}

/**
 * What "delete" means for staff: the product vanishes from every screen, but the
 * row, photos and audit data stay for the admin Archive tab. Any waiting job is
 * cancelled so a deleted photo is never processed (and never paid for).
 * Returns false when it was already archived or does not exist.
 */
export function archiveProduct(id: string, by: string, why: { reason?: string; note?: string } = {}): boolean {
  const db = getDb();
  const at = nowIso();
  const res = db
    .prepare(`UPDATE products SET archived_at = ?, archived_by = ?, archived_status = status, archived_reason = ?, archived_note = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`)
    .run(at, by, why.reason ?? '', why.note ?? '', at, id);
  if (res.changes === 0) return false;
  db.prepare(`UPDATE jobs SET status = 'failed', last_error = 'Deleted before it was processed.', finished_at = ? WHERE product_id = ? AND status = 'queued'`).run(at, id);
  return true;
}

/** Brings an archived product back exactly as it was. */
export function restoreProduct(id: string): boolean {
  const res = getDb()
    .prepare(`UPDATE products SET archived_at = NULL, archived_by = NULL, archived_status = '', archived_reason = '', archived_note = '', updated_at = ? WHERE id = ? AND archived_at IS NOT NULL`)
    .run(nowIso(), id);
  return res.changes > 0;
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
    name: name.trim() || batchNameFor(),
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
      `SELECT b.*, (SELECT COUNT(*) FROM products p WHERE p.batch_id = b.id AND p.archived_at IS NULL) AS product_count
       FROM batches b ORDER BY b.created_at DESC LIMIT ?`
    )
    .all(limit) as (BatchRow & { product_count: number })[];
  return rows.map((row) => ({ ...toBatch(row), productCount: row.product_count }));
}

export function closeBatch(id: string): void {
  getDb().prepare('UPDATE batches SET closed_at = ? WHERE id = ?').run(nowIso(), id);
}

/** A date as the store reads it - d/m/yyyy in India time, whatever timezone the server runs in. */
export function istDate(at: Date | string = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

export const batchNameFor = (at: Date | string = new Date()) => `Shoot ${istDate(at)}`;

/**
 * The batch everyone shoots into today: one shared "Shoot d/m/yyyy" per day,
 * opened by whoever shoots first. (It used to be one per person that stayed
 * open for ever, so a photo taken today could land in a batch named for a week
 * ago and never show up under today's date in Export.)
 */
export function getOrCreateTodaysBatch(userId: string): Batch {
  const today = istDate();
  const open = getDb()
    .prepare('SELECT * FROM batches WHERE closed_at IS NULL ORDER BY created_at DESC LIMIT 20')
    .all() as BatchRow[];
  const found = open.find((b) => istDate(b.created_at) === today);
  if (found) return toBatch(found);
  return createBatch(batchNameFor(), userId);
}

/**
 * One-time tidy of history: each product belongs in the batch for the day it
 * was shot. Moves any product whose batch is from a different day, then drops
 * batches left empty. Guarded by a settings flag so it runs once.
 */
export function rehomeProductsByShootDate(): { moved: number } {
  const db = getDb();
  const flag = db.prepare("SELECT value FROM settings WHERE key = 'batches_rehomed_v1'").get();
  if (flag) return { moved: 0 };
  const rows = db
    .prepare('SELECT p.id, p.created_at AS p_at, p.created_by, b.created_at AS b_at FROM products p JOIN batches b ON b.id = p.batch_id')
    .all() as { id: string; p_at: string; created_by: string; b_at: string }[];
  let moved = 0;
  db.transaction(() => {
    const byDay = new Map<string, string>();
    for (const r of rows) {
      const day = istDate(r.p_at);
      if (istDate(r.b_at) === day) continue;
      let batchId = byDay.get(day);
      if (!batchId) {
        const existing = db.prepare('SELECT id FROM batches WHERE name = ? ORDER BY created_at LIMIT 1').get(batchNameFor(r.p_at)) as { id: string } | undefined;
        if (existing && istDate((db.prepare('SELECT created_at FROM batches WHERE id = ?').get(existing.id) as { created_at: string }).created_at) === day) {
          batchId = existing.id;
        } else {
          batchId = newId('bch');
          db.prepare('INSERT INTO batches (id, name, created_by, created_at, closed_at) VALUES (?, ?, ?, ?, NULL)').run(batchId, batchNameFor(r.p_at), r.created_by, r.p_at);
        }
        byDay.set(day, batchId);
      }
      db.prepare('UPDATE products SET batch_id = ? WHERE id = ?').run(batchId, r.id);
      moved++;
    }
    db.prepare('DELETE FROM batches WHERE id NOT IN (SELECT DISTINCT batch_id FROM products WHERE batch_id IS NOT NULL) AND created_at < ?').run(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    db.prepare("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('batches_rehomed_v1', ?, ?, NULL)").run(String(moved), nowIso());
  })();
  return { moved };
}
