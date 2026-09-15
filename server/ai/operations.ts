// The four Gemini calls this app makes: enhance, audit, segment, copy.
//
// Ported from v1 server.ts. Each function is a single API call with a timeout
// and no retry of its own - retrying is the caller's job via
// withTransientRetry(), so the retry policy lives in one place and every
// attempt gets logged.

import type { GoogleGenAI } from '@google/genai';
import {
  MODEL_AUDIT,
  MODEL_SEGMENT,
  MODEL_COPY,
  ENHANCE_TIMEOUT_MS,
  AUDIT_TIMEOUT_MS,
  SEGMENT_TIMEOUT_MS,
} from './client';
import { buildAuditPrompt, buildCopyPrompt, type AuditContext, type CopyContext } from './prompts';

export interface EnhanceResult {
  imageBase64: string;
  mimeType: string;
}

export async function enhanceImage(
  ai: GoogleGenAI,
  model: string,
  imageBase64: string,
  mimeType: string,
  prompt: string
): Promise<EnhanceResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENHANCE_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
      config: {
        // 1K is visually indistinguishable from 2K at normal web/catalogue
        // display sizes and costs roughly 33% less per image - 2K only
        // matters for print or heavy pinch-zoom, neither of which applies here.
        imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        abortSignal: controller.signal,
      } as never,
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        return { imageBase64: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/png' };
      }
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// The checklist keys here are a contract with the analytics dashboard, which
// aggregates failures per key. Adding a key is fine; renaming one silently
// breaks the historical trend for that check.
export const AUDIT_CHECKS = [
  'sharpFocus',
  'notCropped',
  'backgroundCleanWhite',
  'noBlownHighlights',
  'neutralWhiteBalance',
  'colorConsistentAcrossSurface',
  'clearlyIdentifiableCategory',
  'matchesOriginalDesign',
  'naturalDropPhysics',
] as const;

export type AuditCheck = (typeof AUDIT_CHECKS)[number];

export interface AuditResult {
  overallPass: boolean;
  reason: string;
  checklist: Record<AuditCheck, boolean>;
}

export async function auditOutput(
  ai: GoogleGenAI,
  originalBase64: string,
  originalMime: string,
  enhancedBase64: string,
  enhancedMime: string,
  context: AuditContext
): Promise<AuditResult> {
  const prompt = buildAuditPrompt(context);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: MODEL_AUDIT,
      contents: {
        parts: [
          { inlineData: { mimeType: originalMime, data: originalBase64 } },
          { inlineData: { mimeType: enhancedMime, data: enhancedBase64 } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        abortSignal: controller.signal,
      } as never,
    });

    const parsed = JSON.parse(response.text?.trim() || '{}') as Record<string, unknown>;
    const checklist = Object.fromEntries(
      AUDIT_CHECKS.map((key) => [key, Boolean(parsed[key])])
    ) as Record<AuditCheck, boolean>;

    const overallPass =
      typeof parsed.overallPass === 'boolean'
        ? parsed.overallPass
        : Object.values(checklist).every(Boolean);

    return {
      overallPass,
      reason:
        (parsed.reason as string) ||
        (overallPass ? 'Passed quality check.' : 'Did not meet catalogue quality standards.'),
      checklist,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export interface SegmentationResult {
  boxTwoD: number[];
  polygon: number[][];
  label: string;
}

// Traces the jewelry's real silhouette in the ORIGINAL photo only, via a
// small/fast vision model - not another image-generation call. Used to give
// the enhance prompt real geometric facts (exact outline, interior opening on
// a ring/bangle) instead of leaving the model to guess. Always fails open:
// any error, timeout, or malformed response just returns null and the caller
// proceeds without grounding, at zero extra cost beyond this one short call.
export async function segmentJewelry(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string
): Promise<SegmentationResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEGMENT_TIMEOUT_MS);
  try {
    const prompt = `Give the precise segmentation outline of the single jewelry item in this image.
Output a JSON list with exactly one entry:
{ "box_2d": [ymin, xmin, ymax, xmax], "mask": [[y, x], [y, x], ...polygon points tracing the item's actual silhouette in order...], "label": "short description of the item" }
All coordinates normalized 0-1000. Trace the jewelry's real outline closely, including any visible interior opening (e.g. a ring or bangle's finger/wrist hole) as part of the silhouette, not as a filled solid.`;

    const response = await ai.models.generateContent({
      model: MODEL_SEGMENT,
      contents: {
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        abortSignal: controller.signal,
      } as never,
    });

    const parsed = JSON.parse(response.text?.trim() || '[]');
    const first = Array.isArray(parsed) ? parsed[0] : null;
    if (
      !first ||
      !Array.isArray(first.box_2d) || first.box_2d.length !== 4 ||
      !Array.isArray(first.mask) || first.mask.length < 3
    ) {
      return null;
    }
    return { boxTwoD: first.box_2d, polygon: first.mask, label: String(first.label || 'jewelry item') };
  } catch (err) {
    console.error('Segmentation grounding (non-blocking) failed:', (err as Error)?.message || err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export interface GeneratedCopy {
  name: string;
  description: string;
  metaTitle: string;
  metaDescription: string;
  imageAltText: string;
  searchKeywords: string;
  urlSlug: string;
}

export async function generateCopy(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  context: CopyContext
): Promise<GeneratedCopy | null> {
  const prompt = buildCopyPrompt(context);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model: MODEL_COPY,
      contents: {
        parts: [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }],
      },
      config: {
        responseMimeType: 'application/json',
        abortSignal: controller.signal,
      } as never,
    });

    const parsed = JSON.parse(response.text?.trim() || '{}') as Record<string, unknown>;
    if (!parsed.name || !parsed.description) return null;

    return {
      name: String(parsed.name),
      description: String(parsed.description),
      metaTitle: parsed.metaTitle ? String(parsed.metaTitle) : '',
      metaDescription: parsed.metaDescription ? String(parsed.metaDescription) : '',
      imageAltText: parsed.imageAltText ? String(parsed.imageAltText) : '',
      searchKeywords: parsed.searchKeywords ? String(parsed.searchKeywords) : '',
      urlSlug: parsed.urlSlug ? String(parsed.urlSlug) : '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// Builds the context block appended to the enhance prompt. Kept identical to
// v1's string, including the trailing-newline shape - the prompt was tuned
// against this exact layout.
export function buildContextBlock(input: {
  itemType?: string;
  purity?: string;
  gender?: string;
  weight?: string;
}): string {
  return `

ADDITIONAL CONTEXT (FROM CATALOG FORM):
- Item Category: ${input.itemType || 'jewellery'}
- Purity: ${input.purity || '22kt'} Gold
- Intended For: ${input.gender || "women's"}
${input.weight ? `- Weight: ${input.weight}g` : ''}`;
}

export function buildSegmentationBlock(segmentation: SegmentationResult): string {
  return `

PRECISE JEWELRY OUTLINE (from computer-vision analysis of the original photo, normalized 0-1000 [y, x] coordinates, traced in order around the actual physical silhouette including any interior opening): ${JSON.stringify(segmentation.polygon)}
Bounding box [ymin, xmin, ymax, xmax]: ${JSON.stringify(segmentation.boxTwoD)}
Every point inside this outline is part of the SAME physical piece described above. Use it to make sure you have not missed or misjudged any part of the item's true shape (including its interior opening, if any), and to apply your color correction and finish with perfect uniformity across the whole outlined area - including any motifs, engravings, or recessed details inside it.`;
}
