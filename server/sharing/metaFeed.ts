// The Meta (Facebook / Instagram / WhatsApp) commerce catalogue feed, and the
// signed public photo links it needs. Meta fetches photos with no login, so each
// link carries an HMAC of the photo id: unguessable, can be handed out, and
// never exposes a photo whose id nobody was given.
import { createHmac, timingSafeEqual } from 'crypto';
import { config } from '../config';
import { escapeCsvValue } from '../export/csv';
import { cleanPrice } from './caption';

function sign(photoId: string): string {
  return createHmac('sha256', config.sessionSecret).update(`public-photo:${photoId}`).digest('base64url').slice(0, 24);
}

export function publicPhotoPath(photoId: string): string {
  return `/public/photo/${photoId}/${sign(photoId)}`;
}

export function verifyPhotoToken(photoId: string, token: string): boolean {
  const expected = Buffer.from(sign(photoId));
  const given = Buffer.from(String(token ?? ''));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function feedKeyMatches(given: unknown): boolean {
  if (!config.metaFeedKey) return false;
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(config.metaFeedKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface FeedProduct {
  cpc: string;
  id: string;
  name: string;
  description: string;
  priceInr: string;
  itemType: string;
  urlSlug: string;
  photoId: string | null;
}

export const FEED_HEADERS = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'product_type'] as const;

/**
 * One row per product that is complete enough for Meta to accept: a photo, a
 * name, a description and a price. Everything else is counted as skipped, so
 * nothing is ever published with a guessed price or a missing photo.
 */
export function buildMetaFeed(products: FeedProduct[], baseUrl: string): { csv: string; included: number; skipped: number } {
  const rows: string[] = [FEED_HEADERS.join(',')];
  let skipped = 0;
  for (const p of products) {
    const price = cleanPrice(p.priceInr);
    if (!p.photoId || !p.name || !p.description || !price) {
      skipped++;
      continue;
    }
    const link = config.catalogLinkBase ? `${config.catalogLinkBase}/${p.urlSlug || p.cpc || p.id}` : '';
    const values = [
      p.cpc || p.id,
      p.name,
      p.description,
      'in stock',
      'new',
      `${price}.00 INR`,
      link,
      `${baseUrl}${publicPhotoPath(p.photoId)}`,
      'RL Jewels',
      p.itemType,
    ];
    rows.push(values.map(escapeCsvValue).join(','));
  }
  return { csv: rows.join('\r\n') + '\r\n', included: rows.length - 1, skipped };
}
