// Look-alike search: "has this been shot already?" before shooting, and "what
// else looks like this?" afterwards.
import express from 'express';
import { requireAuth, type AuthenticatedRequest } from '../auth/session';
import { logEvent, actorFrom } from '../logging';
import { getProduct } from '../db/products';
import { getLatestPhoto, parseDataUrl } from '../storage/images';
import { fingerprint, KIND_ORIGINAL, KIND_STUDIO } from '../similarity/features';
import { findSimilar, findSimilarToProduct, type Match } from '../similarity';

export const similarRouter = express.Router();
similarRouter.use(requireAuth);

export function describeMatches(matches: Match[]) {
  const out = [];
  for (const m of matches) {
    const p = getProduct(m.productId);
    if (!p) continue;
    out.push({
      productId: p.id,
      score: m.score,
      tier: m.tier,
      name: p.name,
      cpc: p.cpc,
      itemType: p.itemType,
      status: p.status,
      originalPhotoId: getLatestPhoto(p.id, 'original')?.id ?? null,
      processedPhotoId: getLatestPhoto(p.id, 'processed')?.id ?? null,
    });
  }
  return out;
}

// Before shooting: compares a fresh counter photo with every photo shot before.
similarRouter.post('/similar/check', async (req: AuthenticatedRequest, res) => {
  const data = req.body?.imageBase64;
  if (!data || typeof data !== 'string') {
    res.status(400).json({ error: 'imageBase64 is required.' });
    return;
  }
  try {
    const { base64 } = parseDataUrl(data);
    const fp = await fingerprint(Buffer.from(base64, 'base64'), 'original');
    const matches = findSimilar(KIND_ORIGINAL, fp, { limit: 3 });
    // Logged for every check, matched or not, so the thresholds can be tuned
    // against what staff then actually did.
    logEvent('similarity.check', { matches: matches.length, topScore: matches[0]?.score ?? null, topTier: matches[0]?.tier ?? null }, actorFrom(req.user));
    res.json({ matches: describeMatches(matches) });
  } catch (err) {
    // A convenience: if the photo cannot be read here, shooting carries on.
    res.json({ matches: [], error: (err as Error).message });
  }
});

// After shooting: the finished catalogue photos that look like this product's.
similarRouter.get('/products/:id/similar', (req, res) => {
  if (!getProduct(req.params.id)) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 8, 1), 24);
  // Studio photos are all on white, so they compare far better than counter
  // photos; fall back to those when this piece has no studio photo yet.
  let matches = findSimilarToProduct(req.params.id, KIND_STUDIO, limit);
  let basis: 'studio' | 'original' = 'studio';
  if (matches.length === 0) {
    matches = findSimilarToProduct(req.params.id, KIND_ORIGINAL, limit);
    basis = 'original';
  }
  res.json({ basis, matches: describeMatches(matches) });
});
