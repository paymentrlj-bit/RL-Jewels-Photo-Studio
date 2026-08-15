import { PreflightIssue } from '../types';

/**
 * Client-side, zero-cost checks that run before a photo is ever sent to Gemini.
 * These exist to catch the obvious disasters (badly blurred, pointed at nothing,
 * blown-out exposure) instantly and for free, rather than spending an API call
 * to find out. They are a coarse gate, not a replacement for the AI self-QA
 * step - false negatives are fine (the AI/human review still catches those),
 * false positives that block a genuinely fine photo are not, so thresholds
 * below are intentionally forgiving.
 */

// Downscale a captured photo before upload. A 50MP phone photo is far larger
// than the ~2000px square output we actually need, and just slows the upload
// and the model's own image-tokenization on mobile data for no quality gain.
export async function downscaleImage(dataUrl: string, maxDim = 2200, quality = 0.92): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= maxDim && h <= maxDim) {
        resolve(dataUrl);
        return;
      }
      const scale = maxDim / Math.max(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Best-effort EXIF "Flash fired" detection, read from the raw file bytes before
// any canvas re-encoding strips the metadata. Never throws - returns null if
// the file has no readable EXIF, which just means we skip the warning.
export async function checkFlashFired(file: File): Promise<boolean | null> {
  try {
    const buf = await file.slice(0, 131072).arrayBuffer(); // EXIF lives near the start
    const view = new DataView(buf);
    if (view.getUint16(0) !== 0xffd8) return null; // not a JPEG

    let offset = 2;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset);
      if (marker === 0xffe1) {
        const segLength = view.getUint16(offset + 2);
        const exifStart = offset + 4;
        if (
          view.getUint8(exifStart) === 0x45 && // E
          view.getUint8(exifStart + 1) === 0x78 && // x
          view.getUint8(exifStart + 2) === 0x69 && // i
          view.getUint8(exifStart + 3) === 0x66 // f
        ) {
          return parseExifFlash(view, exifStart + 6);
        }
        offset += 2 + segLength;
      } else if ((marker & 0xff00) === 0xff00) {
        if (marker === 0xffd8 || marker === 0xffd9) {
          offset += 2;
        } else {
          const segLength = view.getUint16(offset + 2);
          offset += 2 + segLength;
        }
      } else {
        break;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function parseExifFlash(view: DataView, tiffStart: number): boolean | null {
  const byteOrder = view.getUint16(tiffStart);
  const little = byteOrder === 0x4949;
  const ifd0Offset = view.getUint32(tiffStart + 4, little);

  const readIfdEntries = (ifdAbsOffset: number) => {
    const count = view.getUint16(ifdAbsOffset, little);
    const entries: { tag: number; type: number; value: number }[] = [];
    for (let i = 0; i < count; i++) {
      const entryOffset = ifdAbsOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, little);
      const type = view.getUint16(entryOffset + 2, little);
      const value = view.getUint16(entryOffset + 8, little);
      entries.push({ tag, type, value });
    }
    return entries;
  };

  const ifd0 = readIfdEntries(tiffStart + ifd0Offset);
  const exifIfdPointerEntry = ifd0.find((e) => e.tag === 0x8769);
  if (!exifIfdPointerEntry) return null;

  // Exif SubIFD pointer is a LONG stored across the full 4-byte value field
  const entryIdx = ifd0.findIndex((e) => e.tag === 0x8769);
  const entryAbsOffset = tiffStart + ifd0Offset + 2 + entryIdx * 12;
  const exifIfdOffset = view.getUint32(entryAbsOffset + 8, little);

  const exifEntries = readIfdEntries(tiffStart + exifIfdOffset);
  const flashEntry = exifEntries.find((e) => e.tag === 0x9209);
  if (!flashEntry) return null;

  return (flashEntry.value & 0x1) === 1;
}

interface QualityAnalysis {
  issues: PreflightIssue[];
}

export async function analyzeImageQuality(dataUrl: string): Promise<QualityAnalysis> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 320;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve({ issues: [] });
          return;
        }
        const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
        const dw = Math.round(img.naturalWidth * scale);
        const dh = Math.round(img.naturalHeight * scale);
        const dx = Math.round((size - dw) / 2);
        const dy = Math.round((size - dh) / 2);
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, dx, dy, dw, dh);

        const { data } = ctx.getImageData(0, 0, size, size);
        const gray = new Float32Array(size * size);
        let darkCount = 0;
        let brightCount = 0;
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          gray[p] = lum;
          if (lum < 35) darkCount++;
          if (lum > 248) brightCount++;
        }

        // Simple Laplacian-style edge-variance blur estimate
        let edgeSum = 0;
        let edgeSumSq = 0;
        let edgeCount = 0;
        for (let y = 1; y < size - 1; y++) {
          for (let x = 1; x < size - 1; x++) {
            const idx = y * size + x;
            const lap =
              4 * gray[idx] - gray[idx - 1] - gray[idx + 1] - gray[idx - size] - gray[idx + size];
            edgeSum += lap;
            edgeSumSq += lap * lap;
            edgeCount++;
          }
        }
        const mean = edgeSum / edgeCount;
        const variance = edgeSumSq / edgeCount - mean * mean;

        // Rough subject-bounding-box estimate: pixels that differ a lot from the
        // image's median brightness are "subject", used only to flag a piece
        // that's tiny in the frame - not for isolation/editing.
        const sorted = Float32Array.from(gray).sort();
        const median = sorted[Math.floor(sorted.length / 2)];
        let minX = size, maxX = 0, minY = size, maxY = 0, subjectPx = 0;
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const idx = y * size + x;
            if (Math.abs(gray[idx] - median) > 28) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
              subjectPx++;
            }
          }
        }

        const issues: PreflightIssue[] = [];

        if (variance < 90) {
          issues.push({
            code: 'blurry',
            message: 'This photo looks blurry or out of focus. Hold the phone steady and tap the screen to focus before shooting.',
          });
        }

        const totalPx = size * size;
        if (darkCount / totalPx > 0.65) {
          issues.push({
            code: 'too_dark',
            message: 'This photo looks too dark. Move to better light or get closer to a light source.',
          });
        } else if (brightCount / totalPx > 0.5) {
          issues.push({
            code: 'too_bright',
            message: 'This photo looks washed out / overexposed. Avoid direct glare and try again.',
          });
        }

        const boxW = Math.max(1, maxX - minX);
        const boxH = Math.max(1, maxY - minY);
        if (subjectPx > 30 && (boxW * boxH) / totalPx < 0.04) {
          issues.push({
            code: 'subject_too_small',
            message: 'The jewelry looks small in the frame. Get closer so it fills more of the shot.',
          });
        }

        resolve({ issues });
      } catch {
        resolve({ issues: [] });
      }
    };
    img.onerror = () => resolve({ issues: [] });
    img.src = dataUrl;
  });
}