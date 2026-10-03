// A compact visual fingerprint of a photo, computed on the server with sharp so
// it costs nothing and needs no AI call. Two photos of the same design (even a
// different lot, a different day, a slightly different angle) score high; two
// different designs score low.
//
// What it captures: the piece's silhouette and inner light/dark structure (a
// 16x16 grayscale grid of the piece alone, background trimmed), its colour mix
// (a 4x4x4 RGB histogram), a difference hash, and its aspect ratio.
//
// What it does NOT capture: "similar style" in the way a person means it
// (peacock motif vs floral). That needs a learned embedding. The vectors are
// stored by `kind`, so an embedding model can be added later as a new kind and
// searched through exactly the same functions (see similarity/index.ts).
import sharp from 'sharp';

sharp.cache(false);
sharp.concurrency(1);

/** Which kind of photo the fingerprint came from; only the same kind is ever compared. */
export const KIND_ORIGINAL = 'orig-v1';
export const KIND_STUDIO = 'studio-v1';
export type FeatureDomain = 'original' | 'studio';

const WORK_EDGE = 256;
const GRID = 16;
const HIST_BINS = 4;
const GRAY_LEN = GRID * GRID;
const HIST_LEN = HIST_BINS ** 3;
export const VECTOR_LENGTH = GRAY_LEN + HIST_LEN;

export interface Fingerprint {
  /** GRAY_LEN centred, unit-length grayscale values, then HIST_LEN colour bins summing to 1. */
  vec: Float32Array;
  /** 64-bit difference hash, 16 hex characters. */
  dhash: string;
  /** Width / height of the piece's bounding box. */
  aspect: number;
}

interface Box { left: number; top: number; width: number; height: number }

/** Bounding box of everything that is not the plain background. Null if it cannot tell. */
export function findPieceBox(rgb: Buffer, w: number, h: number, domain: FeatureDomain): Box | null {
  const px = (x: number, y: number) => (y * w + x) * 3;
  // Studio photos: background is white. Counter photos: it is whatever colour
  // the four corners agree on (the velvet).
  let bg: [number, number, number] = [255, 255, 255];
  let tol = 28;
  if (domain === 'original') {
    const patch = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    const sums = [0, 0, 0];
    let n = 0;
    for (const [cx, cy] of [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]]) {
      for (let y = cy; y < cy + patch; y++) for (let x = cx; x < cx + patch; x++) {
        const i = px(x, y);
        sums[0] += rgb[i]; sums[1] += rgb[i + 1]; sums[2] += rgb[i + 2]; n++;
      }
    }
    bg = [sums[0] / n, sums[1] / n, sums[2] / n];
    tol = 48;
  }
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = px(x, y);
      const d = Math.abs(rgb[i] - bg[0]) + Math.abs(rgb[i + 1] - bg[1]) + Math.abs(rgb[i + 2] - bg[2]);
      if (d > tol) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const box = { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const share = (box.width * box.height) / (w * h);
  // Almost nothing, or nearly the whole frame: the background guess was wrong.
  return share < 0.03 || share > 0.97 ? null : box;
}

export async function fingerprint(image: Buffer, domain: FeatureDomain): Promise<Fingerprint> {
  const { data, info } = await sharp(image)
    .rotate()
    .resize(WORK_EDGE, WORK_EDGE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const box = findPieceBox(data, info.width, info.height, domain) ?? { left: 0, top: 0, width: info.width, height: info.height };
  const crop = () => sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).extract(box);

  const gray = await crop().resize(GRID, GRID, { fit: 'fill' }).greyscale().raw().toBuffer();
  const rgb = await crop().resize(32, 32, { fit: 'fill' }).raw().toBuffer();
  const hashPx = await crop().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();

  const vec = new Float32Array(VECTOR_LENGTH);
  let mean = 0;
  for (let i = 0; i < GRAY_LEN; i++) mean += gray[i];
  mean /= GRAY_LEN;
  let norm = 0;
  for (let i = 0; i < GRAY_LEN; i++) {
    vec[i] = gray[i] - mean;
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < GRAY_LEN; i++) vec[i] /= norm;

  const binOf = (v: number) => Math.min(HIST_BINS - 1, Math.floor((v / 256) * HIST_BINS));
  const pixels = rgb.length / 3;
  for (let i = 0; i < rgb.length; i += 3) {
    vec[GRAY_LEN + binOf(rgb[i]) * HIST_BINS * HIST_BINS + binOf(rgb[i + 1]) * HIST_BINS + binOf(rgb[i + 2])] += 1 / pixels;
  }

  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += hashPx[y * 9 + x] > hashPx[y * 9 + x + 1] ? '1' : '0';
  const dhash = BigInt('0b' + bits).toString(16).padStart(16, '0');

  return { vec, dhash, aspect: box.width / box.height };
}

function popcount32(n: number): number {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function hammingDistance(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) return 64;
  return popcount32(parseInt(a.slice(0, 8), 16) ^ parseInt(b.slice(0, 8), 16)) + popcount32(parseInt(a.slice(8), 16) ^ parseInt(b.slice(8), 16));
}

/** 0..1. Weighted blend of silhouette/structure, colour mix, difference hash and shape proportion. */
export function similarity(a: Pick<Fingerprint, 'vec' | 'dhash' | 'aspect'>, b: Pick<Fingerprint, 'vec' | 'dhash' | 'aspect'>): number {
  let shape = 0;
  for (let i = 0; i < GRAY_LEN; i++) shape += a.vec[i] * b.vec[i];
  shape = Math.max(0, shape);
  let colour = 0;
  for (let i = GRAY_LEN; i < VECTOR_LENGTH; i++) colour += Math.min(a.vec[i], b.vec[i]);
  const hash = 1 - hammingDistance(a.dhash, b.dhash) / 64;
  const proportion = 1 - Math.min(1, Math.abs(Math.log(a.aspect / b.aspect)) * 2);
  return 0.45 * shape + 0.2 * colour + 0.25 * hash + 0.1 * proportion;
}

export function vecToBuffer(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function bufferToVec(b: Buffer): Float32Array {
  // Copy: a Buffer slice from SQLite may not be 4-byte aligned.
  const copy = new Uint8Array(b).buffer;
  return new Float32Array(copy);
}
