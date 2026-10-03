// The geometry behind rotate / straighten / crop in the Shoot screen, kept as
// plain functions so the easy-to-get-wrong parts are testable.

export interface CropRect {
  /** Fractions of the (rotated) image, 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };
export const MIN_CROP = 0.1;
export const MAX_STRAIGHTEN_DEG = 15;

/** Size after turning by whole quarter turns: odd numbers swap width and height. */
export function turnedSize(w: number, h: number, quarterTurns: number): { w: number; h: number } {
  return Math.abs(quarterTurns) % 2 === 1 ? { w: h, h: w } : { w, h };
}

/**
 * How much to enlarge an image rotated by `degrees` about its centre so that it
 * still covers its own frame - straightening without blank corners.
 */
export function coverScale(w: number, h: number, degrees: number): number {
  const t = (Math.min(Math.abs(degrees), 45) * Math.PI) / 180;
  const ratio = Math.max(w / h, h / w);
  return Math.cos(t) + Math.sin(t) * ratio;
}

/** Keeps a crop inside the image and no smaller than MIN_CROP on either side. */
export function clampCrop(c: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP, c.w));
  const h = Math.min(1, Math.max(MIN_CROP, c.h));
  const x = Math.min(1 - w, Math.max(0, c.x));
  const y = Math.min(1 - h, Math.max(0, c.y));
  return { x, y, w, h };
}

export function isFullCrop(c: CropRect): boolean {
  return c.x <= 0.001 && c.y <= 0.001 && c.w >= 0.999 && c.h >= 0.999;
}
