// Faithful mode's cut-out (imaging/faithful.ts), on synthetic photos built to
// look like the counter: a gold piece on navy velvet, with a white price tag.
//
// What matters is not pixel-exactness but the promises staff rely on: the
// piece survives (including where a tag box overlaps it), the tag and the
// velvet do not, and a photo that cannot be cut out cleanly is refused rather
// than turned into a bad catalogue image.
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { buildFaithfulImage, FaithfulUnavailableError } from '../imaging/faithful';

const W = 600;
const H = 800;
const NAVY = { r: 28, g: 34, b: 66 };
const GOLD = { r: 214, g: 168, b: 62 };

// A counter photo: velvet with a little noise, a gold "pendant" (disc) with a
// dark stone in the middle, and a white tag card whose box clips the disc.
async function counterPhoto(opts: { goldBackground?: boolean; pieceAtEdge?: boolean } = {}): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 3);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cx = opts.pieceAtEdge ? 20 : 300;
  const cy = 450;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      let c = opts.goldBackground
        ? { r: GOLD.r - 6 + rand() * 12, g: GOLD.g - 6 + rand() * 12, b: GOLD.b - 6 + rand() * 12 }
        : { r: NAVY.r + rand() * 10, g: NAVY.g + rand() * 10, b: NAVY.b + rand() * 12 };
      const d = Math.hypot(x - cx, y - cy);
      if (d < 120) c = { ...GOLD };
      if (d < 25) c = { r: 20, g: 20, b: 20 }; // a black stone set in the gold
      if (x >= 330 && x < 480 && y >= 180 && y < 300) c = { r: 245, g: 245, b: 240 }; // the tag card
      raw[i] = c.r; raw[i + 1] = c.g; raw[i + 2] = c.b;
    }
  }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

// Outline in the 0-1000 [y, x] convention segmentation returns.
const outline = (cx: number, cy: number, r: number) =>
  Array.from({ length: 24 }, (_, k) => {
    const a = (k / 24) * Math.PI * 2;
    return [((cy + Math.sin(a) * r) / H) * 1000, ((cx + Math.cos(a) * r) / W) * 1000];
  });
const tagBox = [(170 / H) * 1000, (320 / W) * 1000, (360 / H) * 1000, (490 / W) * 1000];

async function pixel(buffer: Buffer, x: number, y: number) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.round(y) * info.width + Math.round(x)) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

describe('faithful cut-out', () => {
  it('puts the real piece on white, keeping its dark stone, and drops the tag', async () => {
    const image = await counterPhoto();
    const result = await buildFaithfulImage({
      image,
      polygon: outline(300, 450, 130),
      exclusions: [{ box: tagBox, kind: 'tag' }],
      aspectRatio: '1:1',
    });

    expect(result.mimeType).toBe('image/jpeg');
    expect([result.width, result.height]).toEqual([1600, 1600]);

    // Corners are clean white - no velvet left.
    const corner = await pixel(result.buffer, 10, 10);
    expect(Math.min(corner.r, corner.g, corner.b)).toBeGreaterThan(245);

    // The centre of the piece is the stone, and it stays dark - a cut-out
    // never "fixes" a detail the way a redraw can.
    const centre = await pixel(result.buffer, 800, 800);
    expect(Math.max(centre.r, centre.g, centre.b)).toBeLessThan(70);

    // Between the stone and the rim is gold, still gold - not lemon-yellow
    // from over-brightening, and not blue from the velvet.
    const gold = await pixel(result.buffer, 800, 800 + 200);
    expect(gold.r).toBeGreaterThan(gold.b + 100);
    expect(gold.r - gold.g).toBeGreaterThan(25);
  });

  it('keeps gold that a tag box overlaps, and blanks only the tag', async () => {
    const image = await counterPhoto();
    const result = await buildFaithfulImage({
      image,
      polygon: outline(300, 450, 130),
      exclusions: [{ box: tagBox, kind: 'tag' }],
      aspectRatio: '1:1',
    });
    // The disc is round: the framed piece is as tall as it is wide, so the
    // part of it under the tag box was not cut away.
    const { data, info } = await sharp(result.buffer).raw().toBuffer({ resolveWithObject: true });
    let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
    for (let y = 0; y < info.height; y += 2) {
      for (let x = 0; x < info.width; x += 2) {
        const i = (y * info.width + x) * 3;
        if (data[i] > data[i + 2] + 60) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    const ratio = (maxX - minX) / (maxY - minY);
    expect(ratio).toBeGreaterThan(0.93);
    expect(ratio).toBeLessThan(1.07);
  });

  it('frames elongated pieces tall', async () => {
    const result = await buildFaithfulImage({ image: await counterPhoto(), polygon: outline(300, 450, 130), aspectRatio: '3:4' });
    expect([result.width, result.height]).toEqual([1200, 1600]);
  });

  it('refuses a piece on a background of its own colour instead of producing a bad cut-out', async () => {
    const image = await counterPhoto({ goldBackground: true });
    await expect(buildFaithfulImage({ image, polygon: outline(300, 450, 130), aspectRatio: '1:1' }))
      .rejects.toBeInstanceOf(FaithfulUnavailableError);
  });

  it('refuses a piece that runs off the edge of the photo', async () => {
    const image = await counterPhoto({ pieceAtEdge: true });
    await expect(buildFaithfulImage({ image, polygon: outline(20, 450, 130), aspectRatio: '1:1' }))
      .rejects.toMatchObject({ code: 'touches_edge' });
  });

  it('refuses without an outline to work from', async () => {
    const error = await buildFaithfulImage({ image: await counterPhoto(), aspectRatio: '1:1' }).catch((e) => e);
    expect(error).toBeInstanceOf(FaithfulUnavailableError);
    expect(error.code).toBe('no_outline');
  });
});
