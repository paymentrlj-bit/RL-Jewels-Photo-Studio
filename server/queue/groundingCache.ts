// Dedupe caches for the Stage 0 grounding calls (spec §5 Stage 0): the
// outline trace and the detail inventory.
//
// Both are pure functions of the photo's bytes, so re-running the pipeline on
// the same image - a "regenerate", a requeue after a transient failure, a
// retry after the prompt changed - has no reason to pay for them again.
//
// In-memory and short-lived on purpose. This is a cost optimisation for a
// burst of repeats within one shift, not durable state: losing it on restart
// costs one call, so it does not earn a place in the database.

import crypto from 'crypto';
import type { SegmentationResult } from '../ai/operations';
import type { InventoryAnalysis } from '../ai/inventory';

const TTL_MS = 15 * 60 * 1000;
// Each entry is small (a polygon, or a few hundred bytes of inventory JSON -
// never image data), but an unbounded map would still grow all day on a
// 40-product shift. Oldest-first eviction keeps it flat.
const MAX_ENTRIES = 200;

export interface CachedResult<T> {
  result: T;
  cacheHit: boolean;
}

function hashImage(base64: string): string {
  return crypto.createHash('sha256').update(base64).digest('hex');
}

function createImageResultCache<T>() {
  const cache = new Map<string, { result: T; expiresAt: number }>();

  return {
    // A thrown error is never cached - only a returned value is - so a
    // transient API failure is retried on the next attempt rather than
    // remembered for fifteen minutes.
    async get(imageBase64: string, compute: () => Promise<T>): Promise<CachedResult<T>> {
      const now = Date.now();
      const key = hashImage(imageBase64);

      const hit = cache.get(key);
      if (hit && hit.expiresAt > now) {
        return { result: hit.result, cacheHit: true };
      }

      const result = await compute();

      for (const [k, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(k);
      }
      if (cache.size >= MAX_ENTRIES) {
        // Map preserves insertion order, so the first key is the oldest.
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(key, { result, expiresAt: now + TTL_MS });

      return { result, cacheHit: false };
    },
    clear(): void {
      cache.clear();
    },
    size(): number {
      return cache.size;
    },
  };
}

const segmentationCache = createImageResultCache<SegmentationResult | null>();
const inventoryCache = createImageResultCache<InventoryAnalysis>();

/**
 * A null result is cached too: an image the segmentation model cannot trace is
 * not going to become traceable on the next attempt within the same quarter of
 * an hour, so re-asking is pure cost. Grounding fails open either way, so a
 * cached null is exactly as harmless as a fresh one.
 */
export function cachedSegmentation(
  imageBase64: string,
  compute: () => Promise<SegmentationResult | null>
): Promise<CachedResult<SegmentationResult | null>> {
  return segmentationCache.get(imageBase64, compute);
}

export function cachedInventory(
  imageBase64: string,
  compute: () => Promise<InventoryAnalysis>
): Promise<CachedResult<InventoryAnalysis>> {
  return inventoryCache.get(imageBase64, compute);
}

export function clearSegmentationCache(): void {
  segmentationCache.clear();
}

export function segmentationCacheSize(): number {
  return segmentationCache.size();
}

export function clearInventoryCache(): void {
  inventoryCache.clear();
}
