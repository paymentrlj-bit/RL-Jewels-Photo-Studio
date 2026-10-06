// Catalogue copy is written once, AFTER a piece is approved: a piece that is
// deleted or sent back never needed it, and a re-run never changes it (it is
// written from the original photo). Called from the approve route.
import { getProduct } from '../db/products';
import { enqueueJob, getLatestJobForProduct } from './jobs';

export function queueCopyIfNeeded(productId: string): void {
  const current = getProduct(productId);
  if (!current || current.description.trim()) return;
  const waiting = getLatestJobForProduct(productId, 'copy');
  if (waiting && (waiting.status === 'queued' || waiting.status === 'running')) return;
  enqueueJob({ productId, type: 'copy', priority: -1 });
}
