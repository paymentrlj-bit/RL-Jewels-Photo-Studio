// Export routes: CSV, ZIP and Google Drive.
//
// The big shift from v1 is that these operate on a BATCH, not a single
// product. v1 produced one CSV and one ZIP per item, so importing a day's
// shoot meant opening hundreds of files by hand.

import express from 'express';
import JSZip from 'jszip';
import { requireAuth, type AuthenticatedRequest } from '../auth/session';
import { logEvent, actorFrom } from '../logging';
import { isDriveConfigured, config } from '../config';
import { getProduct, getBatch, listProducts, type Product } from '../db/products';
import { getLatestPhoto, readImageBuffer, imageExists } from '../storage/images';
import { rowFor, type ExportRow } from '../export/fields';
import { buildCsv, buildProductJsonLd, rowsToCsv } from '../export/csv';
import { allMappings, getMapping } from '../export/mappings';
import { enqueueJob, getLatestJobForProduct } from '../queue/jobs';

export const exportRouter = express.Router();
exportRouter.use(requireAuth);

// Only approved and already-exported items leave the building. A product
// still awaiting review has not been signed off by a human, and v1's
// per-product export made it easy to push one out by accident.
function exportableProducts(batchId: string): Product[] {
  return listProducts({ batchId, statuses: ['approved', 'exported'], limit: 500 });
}

function safeFilePart(value: string, fallback: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

exportRouter.get('/export/mappings', (_req, res) => {
  res.json({
    mappings: allMappings().map((m) => ({
      id: m.id,
      label: m.label,
      description: m.description,
      columnCount: m.columns.length,
    })),
    active: config.erpMapping,
  });
});

exportRouter.get('/export/batch/:batchId/csv', (req: AuthenticatedRequest, res) => {
  const batch = getBatch(req.params.batchId);
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }

  const products = exportableProducts(batch.id);
  if (products.length === 0) {
    res.status(409).json({ error: 'This batch has no approved products to export yet.' });
    return;
  }

  const mappingId = String(req.query.mapping || config.erpMapping);
  const { csv, mapping } = buildCsv(mappingId, products.map(rowFor));

  logEvent('export.csv', {
    batchId: batch.id,
    mapping: mapping.id,
    productCount: products.length,
  }, actorFrom(req.user));

  const filename = `${safeFilePart(batch.name, 'batch')}_${mapping.id}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

// The full studio pack: every approved photo plus one CSV, as a single file.
exportRouter.get('/export/batch/:batchId/zip', async (req: AuthenticatedRequest, res) => {
  const batch = getBatch(req.params.batchId);
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }

  const products = exportableProducts(batch.id);
  if (products.length === 0) {
    res.status(409).json({ error: 'This batch has no approved products to export yet.' });
    return;
  }

  const mappingId = String(req.query.mapping || config.erpMapping);
  const mapping = getMapping(mappingId);
  const zip = new JSZip();
  const rows: ExportRow[] = [];
  let missingPhotos = 0;

  for (const product of products) {
    const row = rowFor(product);
    rows.push(row);

    const photo = getLatestPhoto(product.id, 'processed') || getLatestPhoto(product.id, 'original');
    if (photo && imageExists(photo)) {
      zip.file(`photos/${row.photoFilename}`, readImageBuffer(photo));
    } else {
      missingPhotos++;
    }
  }

  zip.file(`${mapping.id}_import.csv`, rowsToCsv(mapping, rows));

  // A plain-text manifest so whoever opens this months later can tell what
  // it is and which schema the CSV follows, without asking anyone.
  zip.file(
    'README.txt',
    [
      `RL Jewels Studio export`,
      `Batch:      ${batch.name}`,
      `Exported:   ${new Date().toISOString()}`,
      `Products:   ${products.length}`,
      `ERP schema: ${mapping.label} (${mapping.id})`,
      missingPhotos > 0 ? `WARNING:    ${missingPhotos} product(s) had no photo file on disk.` : '',
      ``,
      `photos/  - one studio-finished image per product, named by CPC`,
      `${mapping.id}_import.csv - one row per product, ready to import`,
    ].filter(Boolean).join('\n')
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  logEvent('export.zip', {
    batchId: batch.id,
    mapping: mapping.id,
    productCount: products.length,
    missingPhotos,
    bytes: buffer.length,
  }, actorFrom(req.user));

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeFilePart(batch.name, 'batch')}_studio_pack.zip"`);
  res.send(buffer);
});

exportRouter.get('/export/product/:id/jsonld', (req, res) => {
  const product = getProduct(req.params.id);
  if (!product) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  res.json({ jsonLd: buildProductJsonLd(rowFor(product), String(req.query.imageUrl || '') || undefined) });
});

exportRouter.get('/export/drive-status', (_req, res) => {
  res.json({ configured: isDriveConfigured() });
});

// Queues a whole batch for Drive upload and returns immediately - staff do
// not sit on this page while N products upload one at a time. A worker
// drains these jobs the same way it drains enhance/copy jobs (see
// server/queue/driveExportWorker.ts); the browser polls the status route
// below for progress instead of holding one long request open.
//
// This used to run synchronously in this handler. That meant a batch of 50
// held the connection open for however long 50 sequential uploads took -
// often over a minute - with no way to see progress and a real risk of
// losing the whole thing to a connection hiccup partway through.
exportRouter.post('/export/batch/:batchId/drive', (req: AuthenticatedRequest, res) => {
  if (!isDriveConfigured()) {
    res.status(503).json({ error: 'Google Drive export is not configured on this server. See DRIVE_SETUP.md.' });
    return;
  }

  const batch = getBatch(req.params.batchId);
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }

  const products = exportableProducts(batch.id);
  if (products.length === 0) {
    res.status(409).json({ error: 'This batch has no approved products to export yet.' });
    return;
  }

  // Skip a product that's already uploaded ('exported') or already has a
  // job in flight for it - re-clicking Export while the last run is still
  // draining must not queue a second upload of the same photo alongside the
  // first. A product whose last drive_export job FAILED is fair game again:
  // that's the retry.
  const toUpload = products.filter((p) => {
    if (p.status === 'exported') return false;
    const job = getLatestJobForProduct(p.id, 'drive_export');
    return !job || (job.status !== 'queued' && job.status !== 'running');
  });
  const alreadyExported = products.filter((p) => p.status === 'exported').length;

  const mappingId = String(req.body?.mapping || config.erpMapping);
  for (const product of toUpload) {
    enqueueJob({ productId: product.id, type: 'drive_export', payload: { mapping: mappingId } });
  }

  logEvent('export.drive_enqueued', {
    batchId: batch.id,
    mapping: mappingId,
    enqueued: toUpload.length,
    alreadyExported,
  }, actorFrom(req.user));

  res.json({
    enqueued: toUpload.length,
    alreadyExported,
    folderLink: `https://drive.google.com/drive/folders/${config.drive.rootFolderId}`,
  });
});

// Polled by the Export screen while a Drive upload is in progress. Derives
// everything from job + product state already on disk rather than a
// separate progress table - a product's status flips to 'exported' only on
// a successful upload (see driveExportWorker.ts), so "how many are done" is
// always just a count of that, no extra bookkeeping to keep in sync.
exportRouter.get('/export/batch/:batchId/drive-status', (req, res) => {
  const batch = getBatch(req.params.batchId);
  if (!batch) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }

  const products = exportableProducts(batch.id);
  let succeeded = 0;
  let queued = 0;
  let running = 0;
  let failed = 0;
  const results: { cpc: string; photoLink: string }[] = [];
  const failures: { cpc: string; error: string }[] = [];

  for (const product of products) {
    if (product.status === 'exported') {
      succeeded++;
      const job = getLatestJobForProduct(product.id, 'drive_export');
      results.push({ cpc: product.cpc, photoLink: String(job?.result?.photoLink || '') });
      continue;
    }
    const job = getLatestJobForProduct(product.id, 'drive_export');
    if (!job) continue; // never part of a Drive export run
    if (job.status === 'queued') queued++;
    else if (job.status === 'running') running++;
    else if (job.status === 'failed') {
      failed++;
      failures.push({ cpc: product.cpc, error: job.lastError });
    }
  }

  res.json({
    total: products.length,
    succeeded,
    queued,
    running,
    failed,
    inProgress: queued + running,
    folderLink: `https://drive.google.com/drive/folders/${config.drive.rootFolderId}`,
    results,
    failures,
  });
});
