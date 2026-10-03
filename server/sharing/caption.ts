// The text that goes out with a photo on WhatsApp, Instagram and the like, built
// from the catalogue copy so every channel says the same thing. Shared with the
// browser (the Share screen builds it on the phone).

/** Digits only, no leading zeros; "" when not a usable rupee amount. */
export function cleanPrice(raw: unknown): string {
  const digits = String(raw ?? '').replace(/[₹,\s]|rs\.?|inr/gi, '').replace(/\.\d*$/, '');
  if (!/^\d{1,9}$/.test(digits)) return '';
  const n = String(Number(digits));
  return n === '0' ? '' : n;
}

/** "12,345" in the Indian style (12,34,567). */
export function formatRupees(price: string): string {
  const p = cleanPrice(price);
  if (!p) return '';
  const last3 = p.slice(-3);
  const rest = p.slice(0, -3);
  return `₹${rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},` : ''}${last3}`;
}

/** Up to `max` hashtags from the SEO keywords: plain letters only, each keyword phrase joined into one tag. */
export function hashtagsFrom(keywords: string, max = 8): string[] {
  const tags: string[] = [];
  for (const phrase of String(keywords ?? '').split(',')) {
    const words = phrase.replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 4) continue;
    const tag = '#' + words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
    if (tag.length > 3 && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= max) break;
  }
  return tags;
}

export interface CaptionInput {
  name: string;
  description: string;
  searchKeywords?: string;
  priceInr?: string;
}

export function buildShareCaption(p: CaptionInput): string {
  const price = formatRupees(p.priceInr ?? '');
  const tags = hashtagsFrom(p.searchKeywords ?? '');
  return [
    p.name.trim(),
    p.description.trim(),
    price ? `Price: ${price}` : '',
    tags.length ? [...tags, '#RLJewels'].join(' ') : '#RLJewels',
  ].filter(Boolean).join('\n\n');
}
