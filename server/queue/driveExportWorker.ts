// Handles 'drive_export' jobs: one product's photo + CSV row uploaded to
// Google Drive. Runs through the same worker loop as the AI pipeline (see
// worker.ts's runJob), so Export no longer holds an HTTP request open for
// however long a whole batch's uploads take - staff queue it and move on.

import { getProduct, setProductStatus } from '../db/products';
import { getLatestPhoto, readImageBuffer, imageExists } from '../storage/images';
import { getMapping } from '../export/mappings';
import { rowsToCsv } from '../export/csv';
import { rowFor } from '../export/fields';
import { exportProductToDrive, sharedFolderCache } from '../integrations/drive';
import { debugDetail } from '../ai/client';
import { logEvent } from '../logging';
import { completeJob, failJob, type Job } from './jobs';

export async function runDriveExportJob(job: Job, workerId: string): Promise<void> {
  const product = getProduct(job.productId);
  if (!product) {
    failJob(job.id, 'Product no longer exists.', false);
    return;
  }

  // Already uploaded by an earlier job (e.g. this one's a stale duplicate
  // enqueued before the skip-if-exported check landed) - nothing to do, and
  // definitely not a failure.
  if (product.status === 'exported') {
    completeJob(job.id, 'succeeded', { note: 'Already exported.' });
    return;
  }

  const photo = getLatestPhoto(product.id, 'processed') || getLatestPhoto(product.id, 'original');
  if (!photo || !imageExists(photo)) {
    failJob(job.id, 'No photo file on disk.', false);
    return;
  }

  const mappingId = String((job.payload as { mapping?: string }).mapping || '');
  const mapping = getMapping(mappingId);
  const row = rowFor(product);

  try {
    const result = await exportProductToDrive(
      {
        cpc: row.cpc,
        itemType: product.itemType,
        gender: product.gender,
        photoBase64: readImageBuffer(photo).toString('base64'),
        photoMimeType: photo.mimeType,
        metadataCsv: rowsToCsv(mapping, [row], { bom: false }),
      },
      sharedFolderCache
    );
    setProductStatus(product.id, 'exported');
    completeJob(job.id, 'succeeded', { photoLink: result.photoLink, folderLink: result.folderLink });
    logEvent('export.drive_item', {
      productId: product.id,
      cpc: row.cpc,
      workerId,
      success: true,
    });
  } catch (err) {
    const errorDetail = debugDetail(err);
    // Per-item, not just a batch total: this is what let the actual
    // invalid_grant / duplicate-folder bugs get diagnosed at all, and it
    // still applies here even though uploads no longer run in one request.
    logEvent('export.drive_item_failed', {
      productId: product.id,
      cpc: row.cpc,
      workerId,
      errorMessage: errorDetail,
    });
    // Not retried automatically: a systemic failure (dead OAuth token) would
    // otherwise burn through attempts identically and fast on every one of
    // 50 products, with nothing gained. Re-clicking Export in the UI is the
    // retry, once whatever broke is actually fixed.
    failJob(job.id, errorDetail, false);
  }
}
