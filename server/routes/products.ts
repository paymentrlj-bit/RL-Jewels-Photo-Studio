// Products, photos, batches and the queue - the routes staff actually use.
//
// The shape of this API is the whole point of v2. In v1 the capture endpoint
// held an HTTP request open for the length of the AI pipeline. Here, attaching
// a photo enqueues a job and returns in milliseconds, so a staff member can
// photograph the next piece immediately.

import express from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth/session';
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
  deleteProduct,
  createBatch,
  getBatch,
  listBatches,
  closeBatch,
  findOpenBatchFor,
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
  deleteImagesForProduct,
  type PhotoSource,
} from '../storage/images';
import { enqueueJob, getLatestJobForProduct, queueDepth, requeueJob, getJob } from '../queue/jobs';
import { getBlockingIssue } from '../queue/systemStatus';
import { findUserById } from '../auth/users';
import { deriveProductIdFromCpc } from '../integrations/cpcMaster';
import { computeNetWeight } from '../catalog/weights';
import { isFixCode, cleanNote, USE_REAL_PHOTO } from '../catalog/fixes';
import { recordFixRequest } from '../db/fixRequests';

export const productsRouter = express.Router();

productsRouter.use(requireAuth);

// Attaches the things the UI always needs alongside a product row, so the
// client never has to fan out into N follow-up requests per item.
function decorate(productId: string) {
  const product = getProduct(productId);
  if (!product) return null;

  const original = getLatestPhoto(productId, 'original');
  const processed = getLatestPhoto(productId, 'processed');
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
  let batch = findOpenBatchFor(user.id);
  if (!batch) {
    batch = createBatch(`Shoot ${new Date().toLocaleDateString('en-IN')}`, user.id);
    logEvent('batch.created', { batchId: batch.id, name: batch.name, auto: true }, actorFrom(user));
  }
  res.json({ batch });
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
    batchId: body.batchId ? String(body.batchId) : findOpenBatchFor(user.id)?.id ?? null,
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
  });

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
  // Files first: the rows cascade away with the product, and an orphaned
  // photos row is easier to reason about than an orphaned file on disk.
  deleteImagesForProduct(product.id);
  deleteProduct(product.id);
  logEvent('product.deleted', { productId: product.id, cpc: product.cpc }, actorFrom(req.user));
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

  let deleted = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    const product = getProduct(id);
    if (!product) continue;
    if (product.status === 'approved' || product.status === 'exported') {
      skipped.push(id);
      continue;
    }
    deleteImagesForProduct(product.id);
    deleteProduct(product.id);
    deleted++;
  }

  logEvent('product.bulk_deleted', { requested: ids.length, deleted, skipped: skipped.length }, actorFrom(req.user));
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
  });

  setProductStatus(product.id, 'queued');
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

  // Someone is at the counter with the piece in hand - jump the queue.
  const job = enqueueJob({ productId: product.id, type: 'enhance', priority: 10 });
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

productsRouter.post('/products/:id/approve', (req: AuthenticatedRequest, res) => {
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
  logEvent('product.approved', { productId: product.id, cpc: product.cpc }, actorFrom(req.user));
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

  const note = String(req.body?.note || '').trim();
  setProductStatus(product.id, 'needs_reshoot', { reviewNote: note });
  // The reason is design memory for the next piece of this style.
  recordFixRequest({ productId: product.id, itemType: product.itemType, issues: [], note, source: 'reject', createdBy: req.user?.id });
  logEvent('product.rejected', { productId: product.id, cpc: product.cpc, note }, actorFrom(req.user));
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
    payload: useRealPhoto ? { mode: 'faithful' } : { fix: { issues, note }, skipAngleRequest: true },
  });
  setProductStatus(product.id, 'queued');
  logEvent('product.fix_requested', {
    productId: product.id,
    jobId: job.id,
    issues,
    useRealPhoto,
    hasNote: Boolean(note),
    previousStatus: product.status,
    itemType: product.itemType || null,
  }, actorFrom(req.user));
  res.status(202).json({ product: decorate(product.id), jobId: job.id });
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
    ? enqueueJob({ productId: product.id, type: 'enhance', priority: 10, payload: { skipAngleRequest: true } }).id
    : existing && requeueJob(existing.id)
      ? existing.id
      : enqueueJob({ productId: product.id, type: 'enhance', priority: 5 }).id;

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
