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
import { debugDetail } from '../ai/client';
import { getProduct, getBatch, listProducts, setProductStatus, type Product } from '../db/products';
import { getLatestPhoto, readImageBuffer, imageExists, extensionForMime } from '../storage/images';
import { findUserById } from '../auth/users';
import { buildExportRow, type ExportRow } from '../export/fields';
import { buildCsv, buildProductJsonLd, rowsToCsv } from '../export/csv';
import { allMappings, getMapping } from '../export/mappings';
import { exportProductToDrive, newFolderCache } from '../integrations/drive';

export const exportRouter = express.Router();
exportRouter.use(requireAuth);

function rowFor(product: Product): ExportRow {
  const creator = findUserById(product.createdBy);
  const batch = product.batchId ? getBatch(product.batchId) : null;
  const photo = getLatestPhoto(product.id, 'processed') || getLatestPhoto(product.id, 'original');
  const cpc = product.cpc.trim() || 'RLJ-UNKNOWN';

  return buildExportRow({
    product,
    staffName: creator?.displayName || creator?.username || 'Unknown',
    batchName: batch?.name,
    photoFilename: photo ? `${cpc}_photo.${extensionForMime(photo.mimeType)}` : '',
  });
}

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

// Uploads a whole batch to Drive, one product at a time.
//
// Partial success is reported rather than hidden: with 50 products and one
// network blip, "43 uploaded, 7 failed, here is which" is actionable, whereas
// a single error for the whole batch is not.
exportRouter.post('/export/batch/:batchId/drive', async (req: AuthenticatedRequest, res) => {
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

  // 'exported' means this exact product already has a photo + CSV sitting in
  // Drive from a previous run - re-uploading it on every retry or re-click
  // was the actual cause of "it keeps duplicating in Drive", not the folder
  // naming. Skipped, not re-sent: the record stays exactly as it is (no
  // change to status, history, or anything else in the app), it just never
  // goes to Drive a second time.
  const toUpload = products.filter((p) => p.status !== 'exported');
  const alreadyExported = products.length - toUpload.length;

  const mapping = getMapping(String(req.body?.mapping || config.erpMapping));
  const startedAt = Date.now();
  const uploaded: { productId: string; cpc: string; photoLink: string }[] = [];
  const failed: { productId: string; cpc: string; error: string }[] = [];
  // Points at the shared root, not one product's leaf folder: since products
  // now nest into category/gender/style subfolders, a batch spanning more
  // than one of those has no single "the" folder any upload landed in - the
  // root is the one link that is always where everything from this batch
  // actually is.
  const folderLink = `https://drive.google.com/drive/folders/${config.drive.rootFolderId}`;
  // Shared across every product below: without it, each one re-searches
  // Drive for its category/gender/style folder from scratch even when the
  // previous product just resolved the identical path - the main reason a
  // big batch felt slow.
  const folderCache = newFolderCache();

  for (const product of toUpload) {
    const row = rowFor(product);
    const photo = getLatestPhoto(product.id, 'processed') || getLatestPhoto(product.id, 'original');

    if (!photo || !imageExists(photo)) {
      failed.push({ productId: product.id, cpc: row.cpc, error: 'No photo file on disk.' });
      continue;
    }

    try {
      const result = await exportProductToDrive({
        cpc: row.cpc,
        itemType: product.itemType,
        gender: product.gender,
        photoBase64: readImageBuffer(photo).toString('base64'),
        photoMimeType: photo.mimeType,
        metadataCsv: rowsToCsv(mapping, [row], { bom: false }),
      }, folderCache);
      uploaded.push({ productId: product.id, cpc: row.cpc, photoLink: result.photoLink });
      setProductStatus(product.id, 'exported');
    } catch (err) {
      const errorDetail = debugDetail(err);
      // Per-item, not just the batch total: the summary event below only ever
      // carried counts, so a systemic failure (bad OAuth token, wrong root
      // folder) that failed every item, every time, left nobody able to see
      // WHY without re-triggering the upload and reading the HTTP response
      // in the moment - which staff have no reason to inspect.
      logEvent('export.drive_item_failed', {
        batchId: batch.id,
        productId: product.id,
        cpc: row.cpc,
        errorMessage: errorDetail,
      }, actorFrom(req.user));
      failed.push({ productId: product.id, cpc: row.cpc, error: errorDetail });
    }
  }

  logEvent('export.drive', {
    batchId: batch.id,
    mapping: mapping.id,
    uploaded: uploaded.length,
    failed: failed.length,
    alreadyExported,
    latencyMs: Date.now() - startedAt,
  }, actorFrom(req.user));

  res.json({
    success: failed.length === 0,
    uploaded: uploaded.length,
    failedCount: failed.length,
    alreadyExported,
    folderLink,
    results: uploaded,
    failures: failed,
  });
});
