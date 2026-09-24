// Faithful mode: a catalogue photo built from the REAL photo's pixels.
//
// When the AI's redraw fails on fidelity - a bead count changed, a motif was
// redrawn - the old answer was "reshoot", and the new photo usually failed the
// same way. This takes the other route: cut the actual piece out of the
// counter photo, put it on white with a soft shadow, and frame it. Nothing is
// generated, so nothing can be miscounted or invented. It is less polished
// than a studio render (same angle, same lighting as the counter), which is
// why a person approves it in Review like any other photo.
//
// The cut-out is plain image processing, not a model: the counter photos are
// gold on dark navy velvet, which colour separates cleanly. The outline from
// the segmentation call limits where the piece can be, and the boxes it
// returns for tags, fingers and camera watermarks are blanked. It runs on the
// server's CPU in well under a second and costs nothing per photo.
//
// When the photo does not separate cleanly (a busy background, a piece the
// same colour as its stand), this refuses rather than producing a bad cut-out,
// and the piece falls back to a reshoot as before.

import sharp from 'sharp';

export type Box = [number, number, number, number]; // [ymin, xmin, ymax, xmax], 0-1000

export interface Exclusion {
  box: number[];
  kind: 'tag' | 'hand' | 'watermark' | 'other';
}

export interface FaithfulInput {
  image: Buffer;
  /** The piece's outline from segmentation, [y, x] points normalised 0-1000. */
  polygon?: number[][] | null;
  box?: number[] | null;
  /**
   * Things to blank, 0-1000 boxes. A hand is blanked outright; anything else
   * (tag, string, watermark) only where it is paper-white or grey, so a tag
   * box that overlaps the piece never cuts gold out of it.
   */
  exclusions?: Exclusion[];
  aspectRatio: '1:1' | '3:4';
}

export interface FaithfulResult {
  buffer: Buffer;
  mimeType: 'image/jpeg';
  /** Share of the outlined area kept as piece - for the logs. */
  coverage: number;
  /** How spread the background colours are; high means a busy background. */
  backgroundSpread: number;
  width: number;
  height: number;
}

export class FaithfulUnavailableError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'FaithfulUnavailableError';
  }
}

// Working resolution: the phone upload is at most 2200px on its long side, so
// this is the photo's own detail for all but the largest uploads - a small
// ring has few enough pixels as it is. The passes below take about a second.
const WORK_LONG_SIDE = 2000;
const OUTPUT_LONG_SIDE = 1600;
const BG_CLUSTERS = 4;

// ---------------------------------------------------------------------------
// Colour: CIELAB, so "how different from the velvet" matches what the eye sees.
// ---------------------------------------------------------------------------

const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

function toLab(rgb: Buffer, pixels: number): Float32Array {
  const lab = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const r = SRGB_TO_LINEAR[rgb[i * 3]];
    const g = SRGB_TO_LINEAR[rgb[i * 3 + 1]];
    const b = SRGB_TO_LINEAR[rgb[i * 3 + 2]];
    const fx = labF((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = labF(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = labF((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    lab[i * 3] = 116 * fy - 16;
    lab[i * 3 + 1] = 500 * (fx - fy);
    lab[i * 3 + 2] = 200 * (fy - fz);
  }
  return lab;
}

// Lightness counts for less than colour: velvet folds and shading swing its
// brightness a lot while its hue stays put, and gold differs from navy mostly
// in hue.
const L_WEIGHT = 0.5;
function labDistance(lab: Float32Array, i: number, c: number[]): number {
  const dl = (lab[i * 3] - c[0]) * L_WEIGHT;
  const da = lab[i * 3 + 1] - c[1];
  const db = lab[i * 3 + 2] - c[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

function kMeans(lab: Float32Array, samples: number[], k: number): number[][] {
  // Deterministic seeding (evenly spaced samples) so the same photo always
  // produces the same cut-out.
  let centers = Array.from({ length: k }, (_, j) => {
    const i = samples[Math.floor(((j + 0.5) / k) * samples.length)];
    return [lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]];
  });
  for (let iter = 0; iter < 8; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const i of samples) {
      let best = 0;
      let bestD = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = labDistance(lab, i, centers[j]);
        if (d < bestD) { bestD = d; best = j; }
      }
      const s = sums[best];
      s[0] += lab[i * 3]; s[1] += lab[i * 3 + 1]; s[2] += lab[i * 3 + 2]; s[3]++;
    }
    centers = sums.filter((s) => s[3] > 0).map((s) => [s[0] / s[3], s[1] / s[3], s[2] / s[3]]);
  }
  return centers;
}

// An outline that cuts a corner leaves a sliver of the piece in the
// background sample, and a cluster fitted to that sliver would then call the
// whole piece "background". Real background dominates the sample, so a
// cluster holding only a small share of it is dropped.
const MIN_CLUSTER_SHARE = 0.12;
function dropMinorClusters(lab: Float32Array, samples: number[], centers: number[][]): number[][] {
  const counts = centers.map(() => 0);
  for (const i of samples) {
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < centers.length; j++) {
      const d = labDistance(lab, i, centers[j]);
      if (d < bestD) { bestD = d; best = j; }
    }
    counts[best]++;
  }
  const kept = centers.filter((_, j) => counts[j] >= samples.length * MIN_CLUSTER_SHARE);
  return kept.length > 0 ? kept : [centers[counts.indexOf(Math.max(...counts))]];
}

// Below this chroma a pixel is neutral: white card, grey print, black text.
const PAPER_CHROMA = 18;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function rasterizePolygon(points: number[][], w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const pts = points.map(([y, x]) => [(x / 1000) * w, (y / 1000) * h]);
  // Even-odd scanline fill.
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function boxToRect(box: number[], w: number, h: number) {
  const [ymin, xmin, ymax, xmax] = box;
  return {
    x0: Math.max(0, Math.floor((Math.min(xmin, xmax) / 1000) * w)),
    y0: Math.max(0, Math.floor((Math.min(ymin, ymax) / 1000) * h)),
    x1: Math.min(w, Math.ceil((Math.max(xmin, xmax) / 1000) * w)),
    y1: Math.min(h, Math.ceil((Math.max(ymin, ymax) / 1000) * h)),
  };
}

// Two-pass chamfer distance to the nearest set pixel, in pixels (approx.).
function distanceFrom(mask: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? 0 : INF;
  const a = 1, b = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + a);
      if (y > 0) {
        v = Math.min(v, d[i - w] + a);
        if (x > 0) v = Math.min(v, d[i - w - 1] + b);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + b);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + a);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + a);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + b);
        if (x > 0) v = Math.min(v, d[i + w - 1] + b);
      }
      d[i] = v;
    }
  }
  return d;
}

// Keeps only connected blobs that reach into the outline itself. Drops specks
// of velvet sheen and anything that lives only in the margin round the
// outline (the end of a tag's string, a stand edge).
function keepAnchoredComponents(fg: Uint8Array, inside: Uint8Array, w: number, h: number, minArea: number): void {
  const label = new Int32Array(w * h);
  const stack: number[] = [];
  let next = 1;
  for (let start = 0; start < fg.length; start++) {
    if (!fg[start] || label[start]) continue;
    const members: number[] = [];
    let anchored = false;
    label[start] = next;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      if (inside[i]) anchored = true;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0 && fg[i - 1] && !label[i - 1]) { label[i - 1] = next; stack.push(i - 1); }
      if (x < w - 1 && fg[i + 1] && !label[i + 1]) { label[i + 1] = next; stack.push(i + 1); }
      if (y > 0 && fg[i - w] && !label[i - w]) { label[i - w] = next; stack.push(i - w); }
      if (y < h - 1 && fg[i + w] && !label[i + w]) { label[i + w] = next; stack.push(i + w); }
    }
    if (!anchored || members.length < minArea) for (const i of members) fg[i] = 0;
    next++;
  }
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / span;
      acc += src[y * w + Math.min(w - 1, x + r + 1)] - src[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / span;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// The cut-out
// ---------------------------------------------------------------------------

export async function buildFaithfulImage(input: FaithfulInput): Promise<FaithfulResult> {
  const { data: rgb, info } = await sharp(input.image)
    .rotate()
    .resize({ width: WORK_LONG_SIDE, height: WORK_LONG_SIDE, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const n = w * h;
  const lab = toLab(rgb, n);

  // --- where the piece can be ---
  let inside: Uint8Array;
  if (input.polygon && input.polygon.length >= 3) {
    inside = rasterizePolygon(input.polygon, w, h);
  } else if (input.box && input.box.length === 4) {
    inside = new Uint8Array(n);
    const r = boxToRect(input.box, w, h);
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) inside[y * w + x] = 1;
  } else {
    throw new FaithfulUnavailableError('no_outline', 'No outline of the piece was available to cut it out.');
  }
  let insideArea = 0;
  for (let i = 0; i < n; i++) insideArea += inside[i];
  if (insideArea < n * 0.002) throw new FaithfulUnavailableError('no_outline', 'The outline of the piece was too small to use.');

  // A traced outline is approximate - a model's polygon cuts corners - so the
  // piece is allowed a margin beyond it. The colour test decides inside that.
  const dist = distanceFrom(inside, w, h);
  const margin = Math.max(6, Math.round(Math.min(w, h) * 0.03));
  const band = margin * 3;

  const excluded = new Uint8Array(n);
  for (const ex of input.exclusions ?? []) {
    if (!Array.isArray(ex?.box) || ex.box.length !== 4) continue;
    const r = boxToRect(ex.box, w, h);
    const hard = ex.kind === 'hand';
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const i = y * w + x;
        // Tag card, its print and string, a watermark: all near-neutral.
        // Gold is strongly coloured, so it survives a box that overlaps it.
        if (hard || Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]) < PAPER_CHROMA) excluded[i] = 1;
      }
    }
  }

  // --- what the background looks like: the ring just outside the margin ---
  let ring: number[] = [];
  for (let i = 0; i < n; i++) if (dist[i] > margin && dist[i] <= margin + band && !excluded[i]) ring.push(i);
  if (ring.length < 2000) {
    ring = [];
    for (let i = 0; i < n; i++) if (dist[i] > margin && !excluded[i]) ring.push(i);
  }
  if (ring.length < 500) {
    throw new FaithfulUnavailableError('no_background', 'The piece fills the photo, so there is no background to separate it from.');
  }
  const stride = Math.max(1, Math.floor(ring.length / 12000));
  const samples = ring.filter((_, k) => k % stride === 0);
  const centers = dropMinorClusters(lab, samples, kMeans(lab, samples, BG_CLUSTERS));

  // How far real background pixels sit from their own nearest cluster tells
  // how tidy the background is, and sets the threshold for "not background".
  const selfDist = samples.map((i) => Math.min(...centers.map((c) => labDistance(lab, i, c)))).sort((a, b) => a - b);
  const p95 = selfDist[Math.floor(selfDist.length * 0.95)];
  if (p95 > 40) {
    throw new FaithfulUnavailableError('busy_background', 'The background is too busy to cut the piece out cleanly.');
  }
  const t0 = Math.max(10, p95 * 1.15);
  const t1 = t0 + 14;

  // --- per-pixel matte ---
  const alpha = new Float32Array(n);
  const nearest = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (dist[i] > margin || excluded[i]) continue;
    let best = Infinity;
    let bestJ = 0;
    for (let j = 0; j < centers.length; j++) {
      const d = labDistance(lab, i, centers[j]);
      if (d < best) { best = d; bestJ = j; }
    }
    nearest[i] = bestJ;
    alpha[i] = smoothstep(t0, t1, best);
  }

  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = alpha[i] >= 0.5 ? 1 : 0;
  keepAnchoredComponents(fg, inside, w, h, Math.max(12, Math.round(n * 0.00002)));

  let kept = 0;
  let keptInside = 0;
  for (let i = 0; i < n; i++) {
    if (!fg[i]) continue;
    kept++;
    if (inside[i]) keptInside++;
  }
  const coverage = keptInside / insideArea;
  // A photo where most of the outline turned out to be background colour is
  // one where the piece and background are too alike to separate.
  if (coverage < 0.08 || kept < n * 0.001) {
    throw new FaithfulUnavailableError('no_separation', 'The piece and the background are too similar in colour to separate.');
  }

  // A piece that runs off the edge of the photo would be shown cut off. The
  // audit normally catches that first, but a cut-out must never ship one.
  let onBorder = 0;
  for (let x = 0; x < w; x++) onBorder += fg[x] + fg[w + x] + fg[(h - 1) * w + x] + fg[(h - 2) * w + x];
  for (let y = 0; y < h; y++) onBorder += fg[y * w] + fg[y * w + 1] + fg[y * w + w - 1] + fg[y * w + w - 2];
  if (onBorder > Math.max(20, kept * 0.002)) {
    throw new FaithfulUnavailableError('touches_edge', 'The piece runs off the edge of the photo, so a cut-out would show it cut off.');
  }

  // Soften the edge by a pixel so it does not look scissor-cut: just outside
  // the kept shape, a pixel keeps part of its own matte value only where it
  // touches the piece. Dropped specks, away from the piece, go fully white.
  const soft = boxBlur(Float32Array.from(fg), w, h, 1);
  for (let i = 0; i < n; i++) alpha[i] = fg[i] ? Math.max(alpha[i], soft[i]) : soft[i] * alpha[i];

  // --- bounding box of the piece ---
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (fg[y * w + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }

  // --- premultiplied RGBA of the piece, with the velvet's colour lifted out
  //     of the semi-transparent edge pixels so they do not ring blue ---
  const centersRgb = centers.map((c) => labToRgb(c));
  const rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    if (a < 0.02) continue;
    const bg = centersRgb[nearest[i]];
    for (let ch = 0; ch < 3; ch++) {
      const c = rgb[i * 3 + ch];
      const fgc = a >= 0.98 ? c : (c - (1 - a) * bg[ch]) / a;
      rgba[i * 4 + ch] = Math.max(0, Math.min(255, Math.round(fgc)));
    }
    rgba[i * 4 + 3] = Math.round(a * 255);
  }

  // Gentle levels on the piece itself: counter lighting is usually a little
  // dim. The brightest 2% of the metal is lifted towards bright gold, capped,
  // so a correctly exposed photo is barely touched. Each pixel's lift is
  // limited so no channel clips - clipping red first is what turns gold lemon.
  const lum: number[] = [];
  for (let i = 0; i < n; i += 3) if (fg[i]) lum.push(0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]);
  lum.sort((a, b) => a - b);
  const p98 = lum.length ? lum[Math.floor(lum.length * 0.98)] : 255;
  const gain = Math.min(1.15, Math.max(1, 235 / Math.max(1, p98)));
  if (gain > 1.01) {
    for (let i = 0; i < n; i++) {
      if (!rgba[i * 4 + 3]) continue;
      const peak = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
      const g = Math.min(gain, 255 / Math.max(1, peak));
      for (let ch = 0; ch < 3; ch++) rgba[i * 4 + ch] = Math.round(rgba[i * 4 + ch] * g);
    }
  }

  const pieceW = maxX - minX + 1;
  const pieceH = maxY - minY + 1;
  const piece = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: minX, top: minY, width: pieceW, height: pieceH })
    .png()
    .toBuffer();

  // --- frame: white canvas at the category's shape, piece centred with a margin ---
  const [ratioW, ratioH] = input.aspectRatio === '3:4' ? [3, 4] : [1, 1];
  const outH = OUTPUT_LONG_SIDE;
  const outW = Math.round((OUTPUT_LONG_SIDE * ratioW) / ratioH);
  const fill = 0.84;
  // Enlarging past 3x only makes blur bigger; a very small piece is better
  // left smaller in the frame.
  const scale = Math.min((outW * fill) / pieceW, (outH * fill) / pieceH, 3);
  const drawW = Math.max(1, Math.round(pieceW * scale));
  const drawH = Math.max(1, Math.round(pieceH * scale));
  const left = Math.round((outW - drawW) / 2);
  const top = Math.round((outH - drawH) / 2);

  const scaled = await sharp(piece).resize(drawW, drawH, { kernel: 'lanczos3' }).png().toBuffer();

  // A soft contact shadow, so the piece sits on the white instead of floating.
  const blurSigma = Math.max(4, Math.round(Math.min(outW, outH) * 0.012));
  const shadowAlpha = await sharp(scaled).extractChannel('alpha').linear(0.28, 0).toBuffer();
  const shadow = await sharp({ create: { width: drawW, height: drawH, channels: 3, background: { r: 60, g: 50, b: 40 } } })
    .joinChannel(shadowAlpha)
    .png()
    .toBuffer();
  const pad = blurSigma * 3;
  const shadowBlurred = await sharp(shadow)
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(blurSigma)
    .png()
    .toBuffer();

  const offsetY = Math.round(outH * 0.008);
  const buffer = await sharp({ create: { width: outW, height: outH, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([
      { input: shadowBlurred, left: left - pad, top: top - pad + offsetY },
      { input: scaled, left, top },
    ])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return { buffer, mimeType: 'image/jpeg', coverage: Number(coverage.toFixed(3)), backgroundSpread: Number(p95.toFixed(1)), width: outW, height: outH };
}

function labToRgb([L, a, b]: number[]): number[] {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const lin = [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
  return lin.map((c) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  });
}
