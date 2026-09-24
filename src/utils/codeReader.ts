// Reads QR codes and barcodes off a live video frame or a still photo.
//
// Two engines, fastest first:
//   1. The browser's own BarcodeDetector. On the store's Android phones this
//      is Google's on-device scanner: it reads a whole 1080p frame in a few
//      milliseconds and copes with small, tilted and slightly soft codes.
//   2. jsQR plus ZXing on a canvas, for browsers without it (iPhone Safari,
//      desktop Firefox). Slower, so it looks only at the centre of the frame,
//      where the guide box tells staff to put the tag.
//
// The old scanner ran ZXing alone on a 640x480 stream every 500ms. A tag QR
// is about a centimetre across, which at that resolution is a smudge of a few
// dozen pixels - which is why it never read anything.

import jsQR from 'jsqr';
import {
  BarcodeFormat,
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
} from '@zxing/library';
import { HTMLCanvasElementLuminanceSource } from '@zxing/browser';
import { extractCpc } from '../../server/catalog/tagCode';

export type ReaderKind = 'native' | 'fallback';

export interface CodeReader {
  kind: ReaderKind;
  /** One attempt on the current video frame. Cheap enough to call every frame. */
  readVideo(video: HTMLVideoElement): Promise<string | null>;
  /** A thorough attempt on a still photo: slower, tries harder. */
  readImage(image: ImageBitmap): Promise<string | null>;
}

// Formats with a real checksum only. The old scanner also tried the
// checksum-less 1D formats (Code 39, ITF, Codabar), which "read" short random
// numbers out of velvet texture and tag print - at the store it returned
// 411152, 32382 and 144608 for a tag whose QR holds 1516L387.
const NATIVE_FORMATS = ['qr_code', 'data_matrix', 'code_128', 'ean_13'];

interface DetectedBarcode { rawValue: string; boundingBox?: DOMRectReadOnly }
interface NativeDetector { detect(source: CanvasImageSource | ImageBitmap): Promise<DetectedBarcode[]> }

async function createNativeDetector(): Promise<NativeDetector | null> {
  const Detector = (globalThis as { BarcodeDetector?: any }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const supported: string[] = await Detector.getSupportedFormats();
    const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
    if (!formats.includes('qr_code')) return null;
    return new Detector({ formats }) as NativeDetector;
  } catch {
    return null;
  }
}

// When a frame holds more than one code, one that carries a CPC wins; after
// that, the biggest is the one the phone is pointed at.
function pickLargest(codes: DetectedBarcode[]): string | null {
  const readable = codes.filter((c) => c.rawValue?.trim());
  if (readable.length === 0) return null;
  readable.sort((a, b) => Number(extractCpc(b.rawValue).matched) - Number(extractCpc(a.rawValue).matched) || area(b) - area(a));
  return readable[0].rawValue.trim();
}
const area = (c: DetectedBarcode) => (c.boundingBox ? c.boundingBox.width * c.boundingBox.height : 0);

const zxingHints = (tryHarder: boolean) => {
  const hints = new Map<DecodeHintType, unknown>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX, BarcodeFormat.CODE_128, BarcodeFormat.EAN_13,
  ]);
  if (tryHarder) hints.set(DecodeHintType.TRY_HARDER, true);
  return hints;
};

function readCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, zxing: MultiFormatReader | null, thorough: boolean): string | null {
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height);
  const qr = jsQR(pixels.data, width, height, { inversionAttempts: thorough ? 'attemptBoth' : 'dontInvert' });
  if (qr?.data?.trim()) return qr.data.trim();
  if (!zxing) return null;
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new HTMLCanvasElementLuminanceSource(canvas)));
    // decodeWithState keeps the hints set once up front; plain decode()
    // would silently reset them to "every format, don't try hard".
    return zxing.decodeWithState(bitmap).getText().trim() || null;
  } catch {
    return null; // NotFound on this frame - the normal case
  }
}

export async function createCodeReader(): Promise<CodeReader> {
  const native = await createNativeDetector();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const liveZxing = new MultiFormatReader();
  liveZxing.setHints(zxingHints(false));
  const stillZxing = new MultiFormatReader();
  stillZxing.setHints(zxingHints(true));
  let frame = 0;

  // Draws a region of the source into the work canvas, scaled so its longer
  // side is at most `maxSide` pixels.
  const draw = (source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxSide: number) => {
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  };

  const readVideoFallback = (video: HTMLVideoElement): string | null => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    // The centre square under the guide box, at native resolution where
    // possible: downscaling is exactly what makes a small code unreadable.
    const side = Math.round(Math.min(vw, vh) * 0.7);
    draw(video, (vw - side) / 2, (vh - side) / 2, side, side, 720);
    // ZXing is the slower of the two, and the only one that reads 1D
    // barcodes; running it every third frame keeps the preview smooth.
    frame++;
    return readCanvas(canvas, ctx, frame % 3 === 0 ? liveZxing : null, false);
  };

  const readImageFallback = (image: ImageBitmap): string | null => {
    const { width, height } = image;
    // Whole photo first, then the centre at twice the detail - a tag held
    // at arm's length is small in a full-frame photo.
    draw(image, 0, 0, width, height, 1600);
    const whole = readCanvas(canvas, ctx, stillZxing, true);
    if (whole) return whole;
    const w = width / 2;
    const h = height / 2;
    draw(image, w / 2, h / 2, w, h, 1600);
    return readCanvas(canvas, ctx, stillZxing, true);
  };

  if (native) {
    return {
      kind: 'native',
      async readVideo(video) {
        try {
          return pickLargest(await native.detect(video));
        } catch {
          return readVideoFallback(video);
        }
      },
      async readImage(image) {
        try {
          const found = pickLargest(await native.detect(image));
          if (found) return found;
        } catch {
          // fall through to the canvas readers
        }
        return readImageFallback(image);
      },
    };
  }

  return {
    kind: 'fallback',
    readVideo: async (video) => readVideoFallback(video),
    readImage: async (image) => readImageFallback(image),
  };
}
