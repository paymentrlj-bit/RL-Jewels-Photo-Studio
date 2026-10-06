// Products, photos, batches and the queue - the routes staff actually use.
//
// The shape of this API is the whole point of v2. In v1 the capture endpoint
// held an HTTP request open for the length of the AI pipeline. Here, attaching
// a photo enqueues a job and returns in milliseconds, so a staff member can
// photograph the next piece immediately.

import express from 'express';
import { requireAuth, requireManager, type AuthenticatedRequest } from '../auth/session';
import { logEvent, actorFrom } from '../logging';
import {
  createProduct,
  getProduct,
  updateProduct,
  setProductStatus,
  listProducts,
  countProductsByStatus,
  findPreviousShoots,
  findActiveDuplicate,
  archiveProduct,
  listFilterRows,
  createBatch,
  getBatch,
  listBatches,
  closeBatch,
  getOrCreateTodaysBatch,
  type ProductStatus,
  PRODUCT_STATUSES,
} from '../db/products';
import {
  saveImage,
  getPhoto,
  getLatestPhoto,
  listPhotos,
  readImageBuffer,
  imageExists,
  type PhotoSource,
} from '../storage/images';
import { enqueueJob, enqueueOrCoalesceEnhance, getLatestJobForProduct, queueDepth, requeueJob, getJob } from '../queue/jobs';
import { getBlockingIssue } from '../queue/systemStatus';
import { findUserById } from '../auth/users';
import { deriveProductIdFromCpc } from '../integrations/cpcMaster';
import { computeNetWeight } from '../catalog/weights';
import { indexProduct } from '../similarity';
import { whitenBackground } from '../imaging/background';
import { cleanPrice } from '../sharing/caption';
import { cleanTags, cleanStaffNote, recordTagsPicked, recordTagsApproved } from '../catalog/tags';
import { isFixCode, isReshootReason, fixOption, RESHOOT_ONLY_REASONS, cleanNote, USE_REAL_PHOTO } from '../catalog/fixes';
import { recordFixRequest } from '../db/fixRequests';
import { matchesFilter, categoryOptions, parseWeightParam } from '../catalog/filters';
import { cleanReasonCode, cleanReasonNote } from '../catalog/deletionReasons';

/** How long a new angle photo waits for the next one before the run starts. */
const ANGLE_SETTLE_MS = Number(process.env.ANGLE_SETTLE_MS) || 8000;

export const productsRouter = express.Router();

productsRouter.use(requireAuth);

// Attaches the things the UI always needs alongside a product row, so the
// client never has to fan out into N follow-up requests per item.
function decorate(productId: string) {
  const product = getProduct(productId);
  if (!product) return null;

  const original = getLatestPhoto(productId, 'original');
  const processed = getLatestPhoto(productId, 'processed');
  // The real-photo cut-out kept beside an AI render that passed, so the
  // reviewer can compare the two. Only for the current original, and only while
  // the catalogue photo is still the AI one.
  const cutout = getLatestPhoto(productId, 'cutout');
  const showCutout = Boolean(
    cutout && original && processed && processed.source !== 'faithful' && cutout.createdAt >= original.createdAt
  );
  // An AI version that failed its check, kept next to whatever replaced it.
  const aiRender = getLatestPhoto(productId, 'airender');
  const showAiRender = Boolean(aiRender && original && aiRender.createdAt >= original.createdAt && (!processed || processed.createdAt >= aiRender.createdAt));
  // Only angles taken for the current original - an older shoot's angles no
  // longer describe what is being processed.
  const angles = original
    ? listPhotos(productId).filter((p) => p.kind === 'angle' && p.createdAt >= original.createdAt)
    : [];
  const job = getLatestJobForProduct(productId, 'enhance');
  const creator = findUserById(product.createdBy);

  return {
    ...product,
    staffName: creator?.displayName || creator?.username || 'Unknown',
    originalPhotoId: original?.id || null,
    processedPhotoId: processed?.id || null,
    // 'faithful' = the piece cut out of the real photo, nothing generated.
    renderMode: processed ? (processed.source === 'faithful' ? 'faithful' : 'ai') : null,
    cutoutPhotoId: showCutout ? cutout!.id : null,
    aiRenderPhotoId: showAiRender ? aiRender!.id : null,
    anglePhotoIds: angles.map((p) => p.id),
    job: job
      ? {
          id: job.id,
          status: job.status,
          stage: job.stage,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          lastError: job.lastError,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Batches
// ---------------------------------------------------------------------------

productsRouter.get('/batches', (_req, res) => {
  res.json({ batches: listBatches() });
});

productsRouter.post('/batches', (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const batch = createBatch(String(req.body?.name || ''), user.id);
  logEvent('batch.created', { batchId: batch.id, name: batch.name }, actorFrom(user));
  res.status(201).json({ batch });
});

// The batch this staff member is shooting into right now, opening one if they
// have none. Saves making someone pick a batch before every single capture.
productsRouter.get('/batches/current', (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  res.json({ batch: getOrCreateTodaysBatch(user.id) });
});

productsRouter.post('/batches/:id/close', (req: AuthenticatedRequest, res) => {
  const batch = getBatch(req.params.id);
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }
  closeBatch(batch.id);
  logEvent('batch.closed', { batchId: batch.id }, actorFrom(req.user));
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

productsRouter.get('/products', (req, res) => {
  const statusParam = String(req.query.status || '').trim();
  const statuses = statusParam
    ? (statusParam.split(',').filter((s) => (PRODUCT_STATUSES as readonly string[]).includes(s)) as ProductStatus[])
    : undefined;

  // Category and weight filters (the Share tab). A category is not a column - it
  // comes from the store's vocabulary - so these are applied to the matching rows
  // first, and only the page being shown is loaded in full.
  const category = req.query.category ? String(req.query.category) : '';
  const minWeight = parseWeightParam(req.query.minWeight);
  const maxWeight = parseWeightParam(req.query.maxWeight);
  if (category.trim() || minWeight !== null || maxWeight !== null) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const matching = listFilterRows({ statuses, search: req.query.search ? String(req.query.search) : undefined }).filter((r) =>
      matchesFilter(r, { category, minWeight, maxWeight })
    );
    const page = matching.slice(offset, offset + limit).map((r) => decorate(r.id)).filter(Boolean);
    res.json({ products: page, total: matching.length, counts: countProductsByStatus() });
    return;
  }

  const products = listProducts({
    batchId: req.query.batchId ? String(req.query.batchId) : undefined,
    statuses,
    search: req.query.search ? String(req.query.search) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  });

  res.json({
    products: products.map((p) => decorate(p.id)).filter(Boolean),
    counts: countProductsByStatus(),
  });
});

// The categories present among products in these statuses, for the Share tab's
// category picker (scroll the list, or type and it narrows).
productsRouter.get('/products/categories', (req, res) => {
  const statusParam = String(req.query.status || '').trim();
  const statuses = statusParam
    ? (statusParam.split(',').filter((s) => (PRODUCT_STATUSES as readonly string[]).includes(s)) as ProductStatus[])
    : undefined;
  res.json({ categories: categoryOptions(listFilterRows({ statuses })) });
});

productsRouter.post('/products', (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const body = req.body || {};

  const cpc = String(body.cpc || '').trim();

  // The same rule the Shoot screen checks before submitting, enforced here
  // too so a slow connection or a stale screen can never create a second
  // product for a tag that is already being worked on.
  if (cpc) {
    const duplicate = findActiveDuplicate(cpc);
    if (duplicate) {
      res.status(409).json({
        error: `${cpc} is already in the system (${duplicate.itemType || 'no item type yet'}, ${duplicate.status.replace('_', ' ')}). Open it in Review instead of shooting it again.`,
        existingProductId: duplicate.id,
      });
      return;
    }
  }

  // Net is derived, never taken from the request: Gross - Other, or Gross
  // when there is no other weight.
  const weights = computeNetWeight(body.grossWeightGrams, body.otherWeightGrams);
  if (!weights.ok) {
    res.status(400).json({ error: weights.error });
    return;
  }
  const product = createProduct({
    createdBy: user.id,
    // Always today's shared batch: a tab left open overnight would otherwise
    // keep filing new shots under yesterday's date.
    batchId: getOrCreateTodaysBatch(user.id).id,
    cpc,
    catalogProductId: cpc ? deriveProductIdFromCpc(cpc) : null,
    itemType: String(body.itemType || ''),
    purity: String(body.purity || '22kt'),
    gender: String(body.gender || 'unisex'),
    size: String(body.size || 'DEFAULT'),
    grossWeightGrams: String(body.grossWeightGrams || ''),
    otherWeightGrams: String(body.otherWeightGrams || ''),
    netWeightGrams: weights.net,
    name: String(body.name || ''),
    tags: cleanTags(body.tags),
    staffNote: cleanStaffNote(body.staffNote),
  });
  recordTagsPicked(product.itemType, product.tags);

  logEvent('product.created', { productId: product.id, cpc, batchId: product.batchId }, actorFrom(user));
  res.status(201).json({ product: decorate(product.id) });
});

productsRouter.get('/products/:id', (req, res) => {
  const product = decorate(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  res.json({
    product,
    photos: listPhotos(req.params.id),
    previousShoots: product.catalogProductId
      ? findPreviousShoots(product.catalogProductId, product.id)
      : [],
  });
});

productsRouter.patch('/products/:id', (req: AuthenticatedRequest, res) => {
  const existing = getProduct(req.params.id);
  if (!existing) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  const body = req.body || {};
  const fields: Record<string, unknown> = {};
  for (const key of [
    'cpc', 'name', 'description', 'seoMetaTitle', 'seoMetaDescription', 'seoKeywords',
    'imageAltText', 'urlSlug', 'itemType', 'purity', 'gender', 'size',
    'grossWeightGrams', 'otherWeightGrams', 'reviewNote',
  ]) {
    if (key in body) fields[key] = String(body[key] ?? '');
  }

  // Photographers fix mistakes in what they entered (CPC, type, weights); the
  // catalogue copy and price belong to managers.
  const MANAGER_ONLY = ['name', 'description', 'seoMetaTitle', 'seoMetaDescription', 'seoKeywords', 'imageAltText', 'urlSlug', 'reviewNote', 'priceInr'];
  if (req.user!.role === 'photographer' && MANAGER_ONLY.some((k) => k in body)) {
    res.status(403).json({ error: 'Only a manager or admin can change the name, description or price.' });
    return;
  }

  if ('priceInr' in body) {
    const price = cleanPrice(body.priceInr);
    if (String(body.priceInr ?? '').trim() && !price) {
      res.status(400).json({ error: 'The price must be a whole number of rupees, e.g. 45000.' });
      return;
    }
    fields.priceInr = price;
  }

  // Any change to either weight recomputes net from the merged values; a net
  // sent on its own is ignored, since it is never entered by hand.
  if ('grossWeightGrams' in fields || 'otherWeightGrams' in fields) {
    const weights = computeNetWeight(
      (fields.grossWeightGrams as string | undefined) ?? existing.grossWeightGrams,
      (fields.otherWeightGrams as string | undefined) ?? existing.otherWeightGrams
    );
    if (!weights.ok) {
      res.status(400).json({ error: weights.error });
      return;
    }
    fields.netWeightGrams = weights.net;
  }

  // Keep the derived catalog id in step with the CPC, so the duplicate-shoot
  // check keeps working after an edit.
  if (typeof fields.cpc === 'string') {
    fields.catalogProductId = deriveProductIdFromCpc(fields.cpc as string);
  }

  const product = updateProduct(req.params.id, fields);
  logEvent('product.updated', { productId: req.params.id, fields: Object.keys(fields) }, actorFrom(req.user));
  res.json({ product: decorate(product!.id) });
});

productsRouter.delete('/products/:id', (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  // "Delete" hides the product from staff but keeps it, with its photos and audit
  // data, in the admin Archive tab: a piece someone threw away is a piece whose
  // output was not good, which is what we learn from. Staff are told it is gone.
  const reason = cleanReasonCode(req.body?.reason);
  const note = cleanReasonNote(req.body?.note);
  archiveProduct(product.id, req.user!.id, { reason, note });
  logEvent('product.deleted', { productId: product.id, cpc: product.cpc, status: product.status, riskScore: product.riskScore, archived: true, reason, note }, actorFrom(req.user));
  res.json({ success: true });
});

// Deletes several products in one tap - "Clear all pending" in Review, for a
// batch that needs to be wiped and reshot, or a run of test/mistake entries.
// Never touches an approved or exported product, even if its id is somehow
// passed in: those are finished catalogue entries, not "pending" by any
// definition, and this is a delete with no undo.
productsRouter.post('/products/bulk-delete', (req: AuthenticatedRequest, res) => {
  const rawIds: unknown[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids: string[] = [...new Set(rawIds.map((v) => String(v)))].slice(0, 500);
  if (ids.length === 0) {
    res.status(400).json({ error: 'ids is required and must be a non-empty list.' });
    return;
  }

  const reason = cleanReasonCode(req.body?.reason);
  const note = cleanReasonNote(req.body?.note);
  let deleted = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    const product = getProduct(id);
    if (!product) continue;
    if (product.status === 'approved' || product.status === 'exported') {
      skipped.push(id);
      continue;
    }
    archiveProduct(product.id, req.user!.id, { reason, note });
    deleted++;
  }

  logEvent('product.bulk_deleted', { requested: ids.length, deleted, skipped: skipped.length, reason, note }, actorFrom(req.user));
  res.json({ success: true, deleted, skipped });
});

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

// Attach a captured photo and queue it for processing. Returns immediately -
// this is the call that makes batch shooting possible.
productsRouter.post('/products/:id/photo', (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  const imageData = req.body?.imageBase64;
  if (!imageData || typeof imageData !== 'string') {
    res.status(400).json({ error: 'imageBase64 is required.' });
    return;
  }

  let photo;
  try {
    photo = saveImage({
      productId: product.id,
      kind: 'original',
      data: imageData,
      source: (String(req.body?.source || 'upload') as PhotoSource),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  // A reshoot is someone standing at the counter waiting, so it goes ahead of
  // the backlog queued earlier in the day.
  const isReshoot = product.status === 'needs_reshoot' || product.status === 'needs_angle' || product.status === 'failed';
  const job = enqueueJob({
    productId: product.id,
    type: 'enhance',
    priority: isReshoot ? 10 : 0,
    payload: { trigger: isReshoot ? 'retake' : 'photo' },
  });

  setProductStatus(product.id, 'queued');
  // Fingerprint the new counter photo so the next shoot can be checked against it.
  void indexProduct(product.id, 'original');
  logEvent('product.photo_attached', {
    productId: product.id,
    photoId: photo.id,
    bytes: photo.bytes,
    source: photo.source,
    isReshoot,
    jobId: job.id,
  }, actorFrom(user));

  res.status(202).json({ product: decorate(product.id), photoId: photo.id, jobId: job.id });
});

// Adds a photo of the same piece from another angle and reprocesses it with
// both. Used when the pipeline found part of the piece hidden (needs_angle), or
// after a failed audit, as a cheaper and more targeted alternative to a full
// reshoot: the original photo stays, the new one only fills in what it hid.
productsRouter.post('/products/:id/angle', (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  if (!getLatestPhoto(product.id, 'original')) {
    res.status(400).json({ error: 'Take the main photo first - an extra angle is added alongside it.' });
    return;
  }

  const imageData = req.body?.imageBase64;
  if (!imageData || typeof imageData !== 'string') {
    res.status(400).json({ error: 'imageBase64 is required.' });
    return;
  }

  let photo;
  try {
    photo = saveImage({ productId: product.id, kind: 'angle', data: imageData, source: 'upload' });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  // Someone is at the counter with the piece in hand - jump the queue. Photos
  // arrive one after another, so wait a few seconds and let them become one run.
  const job = enqueueOrCoalesceEnhance({ productId: product.id, priority: 10, payload: { trigger: 'angle' }, holdMs: ANGLE_SETTLE_MS });
  setProductStatus(product.id, 'queued');
  logEvent('product.angle_added', {
    productId: product.id,
    photoId: photo.id,
    bytes: photo.bytes,
    previousStatus: product.status,
    jobId: job.id,
  }, actorFrom(req.user));

  res.status(202).json({ product: decorate(product.id), photoId: photo.id, jobId: job.id });
});

// Images are served through this route rather than as static files so they
// stay behind the same auth as everything else - the store's unreleased
// catalogue should not be publicly readable by anyone who guesses a filename.
productsRouter.get('/photos/:photoId', (req, res) => {
  const photo = getPhoto(req.params.photoId);
  if (!photo || !imageExists(photo)) {
    res.status(404).json({ error: 'Photo not found.' });
    return;
  }

  res.setHeader('Content-Type', photo.mimeType);
  // Immutable: a photo id always refers to the same bytes - a reshoot creates
  // a new row rather than replacing this one.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.send(readImageBuffer(photo));
});

// ---------------------------------------------------------------------------
// Review actions
// ---------------------------------------------------------------------------

productsRouter.post('/products/:id/approve', requireManager, (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  if (product.status !== 'awaiting_review') {
    res.status(409).json({ error: `Cannot approve a product that is "${product.status}".` });
    return;
  }

  setProductStatus(product.id, 'approved', { reviewNote: String(req.body?.note || '') });
  // Everything now known to describe a good photo of this category joins its tag list.
  recordTagsApproved(product.itemType, product.tags, product.aiTags);
  logEvent('product.approved', { productId: product.id, cpc: product.cpc, tags: product.tags.join(','), aiTags: product.aiTags.join(',') }, actorFrom(req.user));
  res.json({ product: decorate(product.id) });
});

// Sends an item back for reshoot. Distinct from the AI's own needs_reshoot
// verdict: this is a human overruling a photo the AI passed.
productsRouter.post('/products/:id/reject', (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  // Pulling back something already approved (it may be in Drive or the Meta
  // feed by now) is an admin decision; everyone else sends back what is still in review.
  if ((product.status === 'approved' || product.status === 'exported') && !req.user!.isAdmin) {
    res.status(403).json({ error: 'Only an admin can send back a piece that has already been approved.' });
    return;
  }

  // What was wrong: tapped reasons (the same problems as Fix, plus "my photo was bad")
  // and/or a few words. Both are kept - the counts show which problems keep coming back.
  const typed = cleanNote(req.body?.note);
  const rawReasons: unknown[] = Array.isArray(req.body?.reasons) ? req.body.reasons : [];
  const reasons: string[] = [...new Set(rawReasons.map(String).filter(isReshootReason))];
  const labels = reasons.map((c) => fixOption(c)?.label ?? RESHOOT_ONLY_REASONS.find((r) => r.code === c)?.label).filter(Boolean) as string[];
  const note = typed || labels.join(', ');
  const wasApproved = product.status === 'approved' || product.status === 'exported';
  setProductStatus(product.id, 'needs_reshoot', { reviewNote: note });
  // The reason is design memory for the next piece of this style.
  recordFixRequest({ productId: product.id, itemType: product.itemType, issues: reasons.filter(isFixCode), note: typed, source: 'reject', createdBy: req.user?.id });
  logEvent('product.rejected', { productId: product.id, cpc: product.cpc, note, reasons, wasApproved, previousStatus: product.status, itemType: product.itemType || null }, actorFrom(req.user));
  res.json({ product: decorate(product.id) });
});

// One-tap fix: staff say what is wrong with the photo ("black beads turned
// gold") and it is redone with that exact instruction - or, for "use my real
// photo", cut out of the original instead (faithful mode). Cheaper than a
// reshoot, and it uses the eye of someone who knows the piece. Every fix is
// also remembered against the style (design memory).
productsRouter.post('/products/:id/fix', (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  if (!getLatestPhoto(product.id, 'original')) {
    res.status(400).json({ error: 'This product has no photo to fix.' });
    return;
  }
  if (product.status === 'queued' || product.status === 'processing') {
    res.status(409).json({ error: 'This piece is already being processed.' });
    return;
  }

  const requested: string[] = Array.isArray(req.body?.issues) ? req.body.issues.map(String) : [];
  const useRealPhoto = requested.includes(USE_REAL_PHOTO);
  const issues = [...new Set(requested.filter(isFixCode))];
  const note = cleanNote(req.body?.note);
  if (!useRealPhoto && issues.length === 0 && !note) {
    res.status(400).json({ error: 'Pick what is wrong with the photo, or write a short note.' });
    return;
  }

  recordFixRequest({ productId: product.id, itemType: product.itemType, issues, note, source: 'staff', createdBy: req.user?.id });
  // The piece is usually still on the reviewer's screen - jump the queue.
  const job = enqueueJob({
    productId: product.id,
    type: 'enhance',
    priority: 10,
    payload: useRealPhoto ? { mode: 'faithful', trigger: 'real_photo' } : { fix: { issues, note }, skipAngleRequest: true, trigger: 'fix' },
  });
  setProductStatus(product.id, 'queued');
  logEvent('product.fix_requested', {
    productId: product.id,
    jobId: job.id,
    issues,
    useRealPhoto,
    hasNote: Boolean(note),
    // What staff wrote, so the patterns in what they keep asking for can be read back.
    note,
    previousStatus: product.status,
    itemType: product.itemType || null,
  }, actorFrom(req.user));
  res.status(202).json({ product: decorate(product.id), jobId: job.id });
});

// "Use the real photo": makes the cut-out kept beside the AI render the
// catalogue photo. No AI call - it is already made - so it is instant and free.
productsRouter.post('/products/:id/use-cutout', requireManager, (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  const cutout = getLatestPhoto(product.id, 'cutout');
  if (!cutout || !imageExists(cutout)) {
    res.status(400).json({ error: 'There is no real-photo version to switch to for this piece.' });
    return;
  }
  const photo = saveImage({
    productId: product.id,
    kind: 'processed',
    data: readImageBuffer(cutout),
    mimeType: cutout.mimeType,
    source: 'faithful',
  });
  void indexProduct(product.id, 'studio');
  logEvent('product.cutout_chosen', { productId: product.id, cpc: product.cpc, photoId: photo.id, itemType: product.itemType || null }, actorFrom(req.user));
  res.json({ product: decorate(product.id) });
});

// Free, instant clean-up of a studio photo whose background is not white: the
// same step the pipeline now applies to every render, for photos made before it.
productsRouter.post('/products/:id/whiten-background', requireManager, async (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  const photo = product ? getLatestPhoto(product.id, 'processed') : null;
  if (!product || !photo || !imageExists(photo)) {
    res.status(404).json({ error: 'There is no studio photo to clean up for this piece.' });
    return;
  }
  const out = await whitenBackground(readImageBuffer(photo), photo.mimeType);
  if (!out.report.changed) {
    const why = out.report.skipped === 'already_white' ? 'The background is already white.' : 'The background could not be separated from the piece safely - use Fix, or reshoot.';
    res.status(409).json({ error: why });
    return;
  }
  saveImage({ productId: product.id, kind: 'processed', data: out.buffer, mimeType: out.mimeType, source: photo.source });
  void indexProduct(product.id, 'studio');
  logEvent('product.background_whitened', { productId: product.id, cpc: product.cpc, borderBefore: out.report.borderBefore }, actorFrom(req.user));
  res.json({ product: decorate(product.id) });
});

// "Use the AI version anyway": the reviewer looked at the AI render that failed
// its own check and prefers it to the real-photo fallback.
productsRouter.post('/products/:id/use-ai-render', requireManager, (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  const render = product ? getLatestPhoto(product.id, 'airender') : null;
  if (!product || !render || !imageExists(render)) {
    res.status(404).json({ error: 'There is no AI version to switch to for this piece.' });
    return;
  }
  const photo = saveImage({ productId: product.id, kind: 'processed', data: readImageBuffer(render), mimeType: render.mimeType, source: 'upload' });
  void indexProduct(product.id, 'studio');
  logEvent('product.ai_render_chosen', { productId: product.id, cpc: product.cpc, photoId: photo.id }, actorFrom(req.user));
  res.json({ product: decorate(product.id) });
});

// Re-runs the pipeline on the photo already on file - for a transient failure,
// or to try again after an admin has changed the enhance prompt. Does not need
// a new photo.
productsRouter.post('/products/:id/requeue', (req: AuthenticatedRequest, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  if (!getLatestPhoto(product.id, 'original')) {
    res.status(400).json({ error: 'This product has no original photo to reprocess.' });
    return;
  }

  // "Process anyway" on a needs_angle item: a fresh job carrying the flag that
  // tells the pipeline not to stop and ask for an angle again.
  const proceedWithoutAngle = req.body?.proceedWithoutAngle === true;
  const existing = getLatestJobForProduct(product.id, 'enhance');
  const jobId = proceedWithoutAngle
    ? enqueueJob({ productId: product.id, type: 'enhance', priority: 10, payload: { skipAngleRequest: true, trigger: 'process_anyway' } }).id
    : existing && requeueJob(existing.id)
      ? existing.id
      : enqueueJob({ productId: product.id, type: 'enhance', priority: 5, payload: { trigger: 'requeue' } }).id;

  setProductStatus(product.id, 'queued');
  logEvent('product.requeued', { productId: product.id, jobId, proceedWithoutAngle }, actorFrom(req.user));
  res.status(202).json({ product: decorate(product.id), jobId });
});

// ---------------------------------------------------------------------------
// Queue status
// ---------------------------------------------------------------------------

productsRouter.get('/queue/status', (_req, res) => {
  res.json({ depth: queueDepth(), productCounts: countProductsByStatus(), blockingIssue: getBlockingIssue() });
});

productsRouter.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  res.json({ job });
});
