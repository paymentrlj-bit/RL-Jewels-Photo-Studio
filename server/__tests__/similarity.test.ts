// Look-alike search on synthetic "jewellery": shapes drawn on velvet / white.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createUser } from '../auth/users';
import { createProduct } from '../db/products';
import { saveImage } from '../storage/images';
import { fingerprint, similarity, hammingDistance, findPieceBox } from '../similarity/features';
import { indexProduct, findSimilar, findSimilarToProduct, findDuplicatePairs, productsMissingVectors, KIND_ORIGINAL, KIND_STUDIO } from '../similarity';

// A ring-and-drop pendant on a coloured backdrop; `variant` changes the design.
async function piece(opts: { bg: string; variant: 'ring' | 'bar' | 'cross'; scale?: number; brightness?: number; size?: number }): Promise<Buffer> {
  const size = opts.size ?? 400;
  const s = opts.scale ?? 1;
  const c = size / 2;
  const shapes = {
    ring: `<circle cx="${c}" cy="${c}" r="${90 * s}" fill="none" stroke="#c9a227" stroke-width="${26 * s}"/><circle cx="${c}" cy="${c + 130 * s}" r="${24 * s}" fill="#c9a227"/>`,
    bar: `<rect x="${c - 150 * s}" y="${c - 28 * s}" width="${300 * s}" height="${56 * s}" fill="#c9a227"/><rect x="${c - 20 * s}" y="${c + 28 * s}" width="${40 * s}" height="${120 * s}" fill="#b8860b"/>`,
    cross: `<rect x="${c - 25 * s}" y="${c - 140 * s}" width="${50 * s}" height="${280 * s}" fill="#c9a227"/><rect x="${c - 110 * s}" y="${c - 40 * s}" width="${220 * s}" height="${50 * s}" fill="#c9a227"/>`,
  }[opts.variant];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${opts.bg}"/>${shapes}</svg>`;
  let img = sharp(Buffer.from(svg)).jpeg({ quality: 85 });
  if (opts.brightness) img = sharp(await img.toBuffer()).modulate({ brightness: opts.brightness }).jpeg({ quality: 80 });
  return img.toBuffer();
}

describe('fingerprint scoring', () => {
  it('scores the same design high even when lit differently or shot at another size, and different designs low', async () => {
    const a = await fingerprint(await piece({ bg: '#1a1a2e', variant: 'ring' }), 'original');
    const sameDim = await fingerprint(await piece({ bg: '#1a1a2e', variant: 'ring', brightness: 1.15 }), 'original');
    const sameSmaller = await fingerprint(await piece({ bg: '#1a1a2e', variant: 'ring', scale: 0.8, size: 500 }), 'original');
    const bar = await fingerprint(await piece({ bg: '#1a1a2e', variant: 'bar' }), 'original');
    const cross = await fingerprint(await piece({ bg: '#1a1a2e', variant: 'cross' }), 'original');
    expect(similarity(a, sameDim)).toBeGreaterThan(0.92);
    expect(similarity(a, sameSmaller)).toBeGreaterThan(0.85);
    expect(similarity(a, bar)).toBeLessThan(0.8);
    expect(similarity(a, cross)).toBeLessThan(0.8);
    expect(similarity(a, a)).toBeGreaterThan(0.99);
  });

  it('finds the piece against a plain background, and gives up on a plain frame', async () => {
    const { data, info } = await sharp(await piece({ bg: '#ffffff', variant: 'ring', size: 200, scale: 0.45 })).raw().toBuffer({ resolveWithObject: true });
    const box = findPieceBox(data, info.width, info.height, 'studio');
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThan(info.width);
    const blank = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#ffffff' } }).raw().toBuffer();
    expect(findPieceBox(blank, 50, 50, 'studio')).toBeNull();
  });

  it('counts differing hash bits', () => {
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('00000000000000ff', '0000000000000000')).toBe(8);
    expect(hammingDistance('bad', 'worse')).toBe(64);
  });
});

describe('the look-alike index', () => {
  let dir: string;
  let userId: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-sim-test-'));
    initDatabase(path.join(dir, 'test.db'));
    userId = (await createUser({ username: 'sim', password: 'a-real-password-1' })).id;
  });
  afterAll(() => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  async function shoot(variant: 'ring' | 'bar' | 'cross', extra: { bg?: string; brightness?: number } = {}) {
    const p = createProduct({ createdBy: userId, itemType: 'Pendant', name: `${variant}` });
    saveImage({ productId: p.id, kind: 'original', data: await piece({ bg: extra.bg ?? '#1a1a2e', variant, brightness: extra.brightness }), mimeType: 'image/jpeg' });
    saveImage({ productId: p.id, kind: 'processed', data: await piece({ bg: '#ffffff', variant }), mimeType: 'image/jpeg' });
    await indexProduct(p.id);
    return p;
  }

  it('finds the earlier shoot of the same design, flags it as the same piece, and ignores other designs', async () => {
    const ring = await shoot('ring');
    await shoot('bar');
    await shoot('cross');
    const again = await fingerprint(await piece({ bg: '#1a1a2e', variant: 'ring', brightness: 1.1 }), 'original');
    const matches = findSimilar(KIND_ORIGINAL, again);
    expect(matches.map((m) => m.productId)).toEqual([ring.id]);
    expect(matches[0].tier).toBe('same');
  });

  it('answers "what else looks like this" from the studio photos, never listing the product itself', async () => {
    const a = await shoot('ring');
    const b = await shoot('ring', { brightness: 1.1 });
    const found = findSimilarToProduct(a.id, KIND_STUDIO).map((m) => m.productId);
    expect(found).toContain(b.id);
    expect(found).not.toContain(a.id);
  });

  it('lists look-alike pairs for tidying the catalogue', async () => {
    const pairs = findDuplicatePairs(KIND_STUDIO);
    expect(pairs.length).toBeGreaterThan(0);
    expect(pairs[0].score).toBeGreaterThanOrEqual(0.8);
  });

  it('fingerprints products shot before the feature existed', async () => {
    const p = createProduct({ createdBy: userId, itemType: 'Ring' });
    saveImage({ productId: p.id, kind: 'original', data: await piece({ bg: '#222222', variant: 'bar' }), mimeType: 'image/jpeg' });
    expect(productsMissingVectors(KIND_ORIGINAL, 50)).toContain(p.id);
    await indexProduct(p.id);
    expect(productsMissingVectors(KIND_ORIGINAL, 50)).not.toContain(p.id);
  });

  it('removes fingerprints with the product', async () => {
    const p = await shoot('cross');
    getDb().prepare('DELETE FROM products WHERE id = ?').run(p.id);
    const left = getDb().prepare('SELECT COUNT(*) AS n FROM product_vectors WHERE product_id = ?').get(p.id) as { n: number };
    expect(left.n).toBe(0);
  });
});
