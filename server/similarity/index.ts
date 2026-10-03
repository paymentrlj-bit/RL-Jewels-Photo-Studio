// Storing fingerprints and finding look-alikes. This is the one place to ask
// "what else looks like this?" - the Shoot-screen duplicate warning, the
// "Similar pieces" panel and the admin duplicates list all go through it, and a
// future embedding model plugs in as another `kind` without touching callers.
import { getDb, nowIso } from '../db';
import { config } from '../config';
import { getLatestPhoto, readImageBuffer, imageExists } from '../storage/images';
import { logEvent } from '../logging';
import {
  fingerprint, similarity, hammingDistance, vecToBuffer, bufferToVec,
  KIND_ORIGINAL, KIND_STUDIO, VECTOR_LENGTH, type Fingerprint, type FeatureDomain,
} from './features';

export { KIND_ORIGINAL, KIND_STUDIO };

export interface Match {
  productId: string;
  score: number;
  /** 'same' = very likely the very same piece; 'similar' = worth a look. */
  tier: 'same' | 'similar';
}

export function tierFor(score: number): Match['tier'] {
  return score >= config.sameScore ? 'same' : 'similar';
}

function saveVector(productId: string, kind: string, fp: Fingerprint): void {
  getDb()
    .prepare(
      `INSERT INTO product_vectors (product_id, kind, dim, vec, dhash, aspect, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, kind) DO UPDATE SET dim = excluded.dim, vec = excluded.vec, dhash = excluded.dhash, aspect = excluded.aspect, updated_at = excluded.updated_at`
    )
    .run(productId, kind, VECTOR_LENGTH, vecToBuffer(fp.vec), fp.dhash, fp.aspect, nowIso());
}

const SOURCES: { kind: string; domain: FeatureDomain; photo: 'original' | 'processed' }[] = [
  { kind: KIND_ORIGINAL, domain: 'original', photo: 'original' },
  { kind: KIND_STUDIO, domain: 'studio', photo: 'processed' },
];

/** (Re)computes the fingerprints this product has photos for. Never throws: this is a convenience, not part of the pipeline. */
export async function indexProduct(productId: string, only?: 'original' | 'studio'): Promise<void> {
  for (const src of SOURCES) {
    if (only && src.domain !== only) continue;
    try {
      const photo = getLatestPhoto(productId, src.photo);
      if (!photo || !imageExists(photo)) continue;
      saveVector(productId, src.kind, await fingerprint(readImageBuffer(photo), src.domain));
    } catch (err) {
      logEvent('similarity.index_failed', { productId, kind: src.kind, errorMessage: (err as Error).message });
    }
  }
}

interface VectorRow { product_id: string; vec: Buffer; dhash: string; aspect: number; dim: number }

function loadKind(kind: string): { productId: string; fp: Pick<Fingerprint, 'vec' | 'dhash' | 'aspect'> }[] {
  const rows = getDb()
    .prepare('SELECT product_id, vec, dhash, aspect, dim FROM product_vectors WHERE kind = ?')
    .all(kind) as VectorRow[];
  // A row from a different vector length (an older algorithm) cannot be compared.
  return rows.filter((r) => r.dim === VECTOR_LENGTH).map((r) => ({ productId: r.product_id, fp: { vec: bufferToVec(r.vec), dhash: r.dhash, aspect: r.aspect } }));
}

export function findSimilar(
  kind: string,
  target: Pick<Fingerprint, 'vec' | 'dhash' | 'aspect'>,
  options: { excludeProductId?: string; limit?: number; minScore?: number } = {}
): Match[] {
  const minScore = options.minScore ?? config.similarScore;
  const out: Match[] = [];
  for (const row of loadKind(kind)) {
    if (row.productId === options.excludeProductId) continue;
    const score = similarity(target, row.fp);
    if (score >= minScore) out.push({ productId: row.productId, score: Number(score.toFixed(3)), tier: tierFor(score) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 5);
}

/** Matches for a product that is already in the system, using its own stored fingerprint. */
export function findSimilarToProduct(productId: string, kind: string, limit = 8): Match[] {
  const row = getDb().prepare('SELECT vec, dhash, aspect, dim FROM product_vectors WHERE product_id = ? AND kind = ?').get(productId, kind) as Omit<VectorRow, 'product_id'> | undefined;
  if (!row || row.dim !== VECTOR_LENGTH) return [];
  return findSimilar(kind, { vec: bufferToVec(row.vec), dhash: row.dhash, aspect: row.aspect }, { excludeProductId: productId, limit });
}

export interface DuplicatePair { a: string; b: string; score: number; tier: Match['tier'] }

/**
 * Every pair of products that look alike. The 64-bit hash narrows the field
 * first (a cheap bit count) so thousands of products compare quickly on the
 * small server; pairs the hash calls clearly different are not examined.
 */
export function findDuplicatePairs(kind: string, minScore = config.similarScore, limit = 60): DuplicatePair[] {
  const rows = loadKind(kind);
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (hammingDistance(rows[i].fp.dhash, rows[j].fp.dhash) > 22) continue;
      const score = similarity(rows[i].fp, rows[j].fp);
      if (score >= minScore) pairs.push({ a: rows[i].productId, b: rows[j].productId, score: Number(score.toFixed(3)), tier: tierFor(score) });
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, limit);
}

/** Products that have a photo but no fingerprint of that kind yet. */
export function productsMissingVectors(kind: string, limit: number): string[] {
  const photoKind = kind === KIND_STUDIO ? 'processed' : 'original';
  const rows = getDb()
    .prepare(
      `SELECT DISTINCT ph.product_id AS id FROM photos ph
       WHERE ph.kind = ? AND NOT EXISTS (SELECT 1 FROM product_vectors v WHERE v.product_id = ph.product_id AND v.kind = ?)
       LIMIT ?`
    )
    .all(photoKind, kind, limit) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Fingerprints products shot before this feature existed, a few at a time so a
 * 1 GB server is never busy for long. Stops by itself once everything is done.
 */
export function startSimilarityBackfill(): void {
  const BATCH = 4;
  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        const ids = [...new Set([...productsMissingVectors(KIND_ORIGINAL, BATCH), ...productsMissingVectors(KIND_STUDIO, BATCH)])];
        if (ids.length === 0) return;
        for (const id of ids) await indexProduct(id);
        logEvent('similarity.backfill', { indexed: ids.length });
      } catch (err) {
        console.warn('[similarity] backfill failed:', (err as Error).message);
      } finally {
        busy = false;
      }
    })();
  }, 20_000);
  timer.unref();
}
