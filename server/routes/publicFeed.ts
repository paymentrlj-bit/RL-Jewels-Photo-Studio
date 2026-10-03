// The only routes in this app that need no login, on purpose: Meta's catalogue
// importer cannot sign in. Both are locked by a secret instead - the feed by
// META_FEED_KEY, each photo by a signed token (sharing/metaFeed.ts).
import express from 'express';
import { config } from '../config';
import { logEvent } from '../logging';
import { getPhoto, getLatestPhoto, readImageBuffer, imageExists } from '../storage/images';
import { listProducts } from '../db/products';
import { buildMetaFeed, feedKeyMatches, verifyPhotoToken, type FeedProduct } from '../sharing/metaFeed';

export const publicRouter = express.Router();

export function baseUrlFor(req: express.Request): string {
  return config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
}

export function collectFeedProducts(): FeedProduct[] {
  return listProducts({ statuses: ['approved', 'exported'], limit: 5000 }).map((p) => ({
    id: p.id,
    cpc: p.cpc,
    name: p.name,
    description: p.description,
    priceInr: p.priceInr,
    itemType: p.itemType,
    urlSlug: p.urlSlug,
    photoId: (getLatestPhoto(p.id, 'processed') ?? getLatestPhoto(p.id, 'original'))?.id ?? null,
  }));
}

publicRouter.get('/public/photo/:photoId/:token', (req, res) => {
  const { photoId, token } = req.params;
  const photo = verifyPhotoToken(photoId, token) ? getPhoto(photoId) : null;
  if (!photo || !imageExists(photo)) {
    res.status(404).end();
    return;
  }
  res.setHeader('Content-Type', photo.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(readImageBuffer(photo));
});

publicRouter.get('/feeds/meta-catalog.csv', (req, res) => {
  // 404, not 401: with no key set the feed does not exist, and a wrong key must not reveal that it does.
  if (!feedKeyMatches(req.query.key)) {
    res.status(404).end();
    return;
  }
  const { csv, included, skipped } = buildMetaFeed(collectFeedProducts(), baseUrlFor(req));
  logEvent('feed.meta_fetched', { included, skipped, userAgent: String(req.get('user-agent') ?? '').slice(0, 80) });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(csv);
});
