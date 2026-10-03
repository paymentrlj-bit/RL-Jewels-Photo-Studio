// Applies rotate / straighten / crop to a photo in the browser and returns a new
// JPEG data URL. Straightening enlarges the image just enough to leave no blank
// corners, so what you see in the editor is what is sent.
import { coverScale, turnedSize, isFullCrop, clampCrop, type CropRect } from '../../server/catalog/imageEditMath';

export interface PhotoEdits {
  /** Whole 90 degree turns, clockwise. */
  quarterTurns: number;
  /** Fine tilt in degrees, clockwise. */
  straighten: number;
  crop: CropRect;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read the photo.'));
    img.src = src;
  });
}

/** Renders the rotated + straightened image (no crop yet) at most `maxEdge` px on its long side. */
export async function renderTurned(src: string, edits: Pick<PhotoEdits, 'quarterTurns' | 'straighten'>, maxEdge: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const turned = turnedSize(img.naturalWidth, img.naturalHeight, edits.quarterTurns);
  const k = Math.min(1, maxEdge / Math.max(turned.w, turned.h));
  const cw = Math.max(1, Math.round(turned.w * k));
  const ch = Math.max(1, Math.round(turned.h * k));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot edit photos.');
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(((edits.quarterTurns * 90 + edits.straighten) * Math.PI) / 180);
  const s = edits.straighten ? coverScale(cw, ch, edits.straighten) : 1;
  const dw = (edits.quarterTurns % 2 === 0 ? cw : ch) * s;
  const dh = (edits.quarterTurns % 2 === 0 ? ch : cw) * s;
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
  return canvas;
}

/** Full-quality result of all edits, or the original when there are none. */
export async function applyEdits(src: string, edits: PhotoEdits, maxEdge = 2200, quality = 0.92): Promise<string> {
  const untouched = edits.quarterTurns % 4 === 0 && !edits.straighten && isFullCrop(edits.crop);
  if (untouched) return src;
  const turned = await renderTurned(src, edits, maxEdge);
  const c = clampCrop(edits.crop);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(turned.width * c.w));
  out.height = Math.max(1, Math.round(turned.height * c.h));
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('Your browser cannot edit photos.');
  ctx.drawImage(turned, turned.width * c.x, turned.height * c.y, turned.width * c.w, turned.height * c.h, 0, 0, out.width, out.height);
  return out.toDataURL('image/jpeg', quality);
}
