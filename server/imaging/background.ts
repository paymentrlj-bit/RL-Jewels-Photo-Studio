// Makes the studio photo's background pure white, deterministically.
//
// The image model often leaves a pale grey or blue-grey gradient behind the
// piece, and the quick audit lets it through (a "clean white" call is a matter
// of degree to a language model). Gold is strongly saturated and a studio
// background is not, so the two separate cleanly by colour: everything
// connected to the frame edge that is bright and nearly colourless is
// background, and becomes exactly white. White stones, pearls and highlights
// inside the piece are enclosed by gold, so a fill from the edge never reaches
// them and they stay as they are.
import sharp from 'sharp';

sharp.cache(false);
sharp.concurrency(1);

const BRIGHT_MIN = 190;       // max channel at least this to count as background
const SAT_MAX = 0.16;         // (max-min)/max at most this
const BLEND_RING = 2;         // pixels around the piece softened toward white
const MIN_BG_SHARE = 0.2;     // less than this and the fill probably went wrong
const MAX_BG_SHARE = 0.97;
const MIN_COLOURED_SHARE = 0.25; // of the non-background pixels; a silver piece has none, so leave it alone

export interface BackgroundReport {
  /** Mean brightness of the outer frame before the fix, 0-255. */
  borderBefore: number;
  /** Largest channel spread across the frame before the fix: 0 = perfectly uniform. */
  borderSpread: number;
  changed: boolean;
  /** Why nothing was changed, when nothing was. */
  skipped?: 'already_white' | 'no_background_found' | 'piece_not_coloured' | 'unreadable';
}

function isBackgroundLike(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b);
  if (max < BRIGHT_MIN) return false;
  return (max - Math.min(r, g, b)) / max <= SAT_MAX;
}

/** How far the outer frame is from pure white. Cheap; used to decide whether to bother. */
export function measureBorder(rgb: Buffer, w: number, h: number): { mean: number; spread: number } {
  const m = Math.max(1, Math.round(Math.min(w, h) * 0.015));
  let sum = 0, n = 0, lo = 255, hi = 0;
  for (let y = 0; y < h; y++) {
    const edgeRow = y < m || y >= h - m;
    for (let x = 0; x < w; x++) {
      if (!edgeRow && x >= m && x < w - m) { x = w - m - 1; continue; }
      const i = (y * w + x) * 3;
      const v = (rgb[i] + rgb[i + 1] + rgb[i + 2]) / 3;
      sum += v; n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { mean: sum / n, spread: hi - lo };
}

/**
 * Returns the image with its background whitened (same format as the input),
 * or the input untouched if it is already white or cannot be fixed safely.
 */
export async function whitenBackground(input: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string; report: BackgroundReport }> {
  let data: Buffer, w: number, h: number;
  try {
    const out = await sharp(input).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    data = out.data; w = out.info.width; h = out.info.height;
  } catch {
    return { buffer: input, mimeType, report: { borderBefore: 0, borderSpread: 0, changed: false, skipped: 'unreadable' } };
  }
  const border = measureBorder(data, w, h);
  const report: BackgroundReport = { borderBefore: Math.round(border.mean), borderSpread: Math.round(border.spread), changed: false };
  const keep = (skipped: BackgroundReport['skipped']) => ({ buffer: input, mimeType, report: { ...report, skipped } });

  // Close enough to flat white that touching it would only risk the edges.
  if (border.mean >= 253 && border.spread <= 3) return keep('already_white');

  const total = w * h;
  const bg = new Uint8Array(total); // 1 = background
  const stack = new Int32Array(total);
  let sp = 0, bgCount = 0;
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (bg[p]) return;
    const i = p * 3;
    if (!isBackgroundLike(data[i], data[i + 1], data[i + 2])) return;
    bg[p] = 1; bgCount++; stack[sp++] = p;
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % w, y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  // Openings the fill could not reach (the hole of a bangle or a closed ring):
  // a big enough colourless patch whose colour matches the backdrop is more
  // backdrop. Small ones (a pearl, a highlight) are left alone.
  if (bgCount > 0) {
    let sr = 0, sg = 0, sb = 0, sn = 0;
    for (let p = 0; p < total; p += 7) {
      if (!bg[p]) continue;
      const i = p * 3;
      sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sn++;
    }
    const mr = sr / sn, mg = sg / sn, mb = sb / sn;
    const seen = new Uint8Array(total);
    const members = new Int32Array(total);
    for (let start = 0; start < total; start++) {
      if (bg[start] || seen[start]) continue;
      const si = start * 3;
      if (!isBackgroundLike(data[si], data[si + 1], data[si + 2])) continue;
      let n = 0, top = 0, cr = 0, cg = 0, cb = 0;
      seen[start] = 1; stack[top++] = start;
      while (top > 0) {
        const p = stack[--top];
        members[n++] = p;
        const i = p * 3;
        cr += data[i]; cg += data[i + 1]; cb += data[i + 2];
        const x = p % w, y = (p - x) / w;
        const visit = (q: number) => {
          if (bg[q] || seen[q]) return;
          const j = q * 3;
          if (!isBackgroundLike(data[j], data[j + 1], data[j + 2])) return;
          seen[q] = 1; stack[top++] = q;
        };
        if (x > 0) visit(p - 1);
        if (x < w - 1) visit(p + 1);
        if (y > 0) visit(p - w);
        if (y < h - 1) visit(p + w);
      }
      const closeToBackdrop = Math.abs(cr / n - mr) + Math.abs(cg / n - mg) + Math.abs(cb / n - mb) <= 60;
      if (n >= total * 0.015 && closeToBackdrop) {
        for (let k = 0; k < n; k++) bg[members[k]] = 1;
        bgCount += n;
      }
    }
  }

  const share = bgCount / total;
  if (share < MIN_BG_SHARE || share > MAX_BG_SHARE) return keep('no_background_found');

  // A silver / white-gold / pearl-only piece has no colour to tell it from the
  // backdrop; leave those to the audit.
  let coloured = 0, rest = 0;
  for (let p = 0; p < total; p += 3) {
    if (bg[p]) continue;
    rest++;
    const i = p * 3;
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    if (max > 0 && (max - Math.min(data[i], data[i + 1], data[i + 2])) / max > 0.3) coloured++;
  }
  if (rest === 0 || coloured / rest < MIN_COLOURED_SHARE) return keep('piece_not_coloured');

  // Background -> pure white.
  for (let p = 0; p < total; p++) {
    if (bg[p]) { const i = p * 3; data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
  }
  // Soften the ring just outside the fill: anti-aliased edge pixels are a mix
  // of gold and grey, so pull the grey part toward white in proportion to how
  // colourless they are. Fully gold pixels (high saturation) are untouched.
  let ring = new Uint8Array(bg);
  for (let pass = 0; pass < BLEND_RING; pass++) {
    const next = new Uint8Array(ring);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (ring[p]) continue;
        if (ring[p - 1] || ring[p + 1] || ring[p - w] || ring[p + w]) {
          next[p] = 1;
          const i = p * 3;
          const max = Math.max(data[i], data[i + 1], data[i + 2]);
          const sat = max > 0 ? (max - Math.min(data[i], data[i + 1], data[i + 2])) / max : 0;
          const keepWeight = Math.min(1, sat / 0.35);
          if (keepWeight < 1 && max >= 150) {
            for (let c = 0; c < 3; c++) data[i + c] = Math.round(data[i + c] * keepWeight + 255 * (1 - keepWeight));
          }
        }
      }
    }
    ring = next;
  }

  const raw = sharp(data, { raw: { width: w, height: h, channels: 3 } });
  const isPng = /png/i.test(mimeType);
  const buffer = isPng ? await raw.png().toBuffer() : await raw.jpeg({ quality: 93 }).toBuffer();
  return { buffer, mimeType: isPng ? 'image/png' : 'image/jpeg', report: { ...report, changed: true } };
}
