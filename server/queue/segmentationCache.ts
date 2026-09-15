// Dedupe cache for the Stage 0 grounding call (spec §5 Stage 0).
//
// The outline traced from a photo is a pure function of that photo's bytes, so
// re-running the pipeline on the same image - a "regenerate", a requeue after
// a transient failure, a retry after the prompt changed - has no reason to pay
// for it again.
//
// In-memory and short-lived on purpose. This is a cost optimisation for a
// burst of repeats within one shift, not durable state: losing it on restart
// costs one cheap call, so it does not earn a place in the database.

import crypto from 'crypto';
import type { SegmentationResult } from '../ai/operations';

const TTL_MS = 15 * 60 * 1000;
// Each entry is a small polygon, but an unbounded map would still grow all day
// on a 40-product shift. Oldest-first eviction keeps it flat.
const MAX_ENTRIES = 200;

interface Entry {
  result: SegmentationResult | null;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

function hashImage(base64: string): string {
  return crypto.createHash('sha256').update(base64).digest('hex');
}

function evictExpired(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}

export interface CachedSegmentation {
  result: SegmentationResult | null;
  cacheHit: boolean;
}

/**
 * Runs `compute` for this image unless a recent result is already held.
 *
 * A null result is cached too: an image the segmentation model cannot trace is
 * not going to become traceable on the next attempt within the same quarter of
 * an hour, so re-asking is pure cost. Grounding fails open either way, so a
 * cached null is exactly as harmless as a fresh one.
 */
export async function cachedSegmentation(
  imageBase64: string,
  compute: () => Promise<SegmentationResult | null>
): Promise<CachedSegmentation> {
  const now = Date.now();
  const key = hashImage(imageBase64);

  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) {
    return { result: hit.result, cacheHit: true };
  }

  const result = await compute();

  evictExpired(now);
  if (cache.size >= MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the oldest.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { result, expiresAt: now + TTL_MS });

  return { result, cacheHit: false };
}

export function clearSegmentationCache(): void {
  cache.clear();
}

export function segmentationCacheSize(): number {
  return cache.size;
}
