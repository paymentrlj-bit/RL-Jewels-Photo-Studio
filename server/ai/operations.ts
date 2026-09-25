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
  extractUsage,
  type TokenUsage,
} from './client';
import { buildAuditPrompt, buildCopyPrompt, type AuditContext, type CopyContext } from './prompts';
import { buildAuditInventoryBlock, type DetailInventory, type ReferenceImage } from './inventory';
import { describeItemType } from '../catalog/taxonomy';
import type { Exclusion } from '../imaging/faithful';

export interface EnhanceResult {
  imageBase64: string;
  mimeType: string;
}

// referenceImages are close-up crops of the same photo, sent after it as extra
// input so the model can see fine detail at full resolution. The prompt must
// say what they are (see buildReferenceImagesBlock) or the model may treat them
// as additional pieces to include.
export async function enhanceImage(
  ai: GoogleGenAI,
  model: string,
  imageBase64: string,
  mimeType: string,
  prompt: string,
  aspectRatio: '1:1' | '3:4' = '1:1',
  referenceImages: ReferenceImage[] = [],
  onUsage?: (usage: TokenUsage | null) => void
): Promise<EnhanceResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENHANCE_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType, data: imageBase64 } },
          ...referenceImages.map((r) => ({ inlineData: { mimeType: r.mimeType, data: r.base64 } })),
          { text: prompt },
        ],
      },
      config: {
        // Branched by category, never hardcoded square - forcing an elongated
        // piece (chain, mangalsutra, haar) into 1:1 either crops it or shrinks
        // it to a thread in a white field. See server/catalog/taxonomy.ts.
        //
        // 1K is visually indistinguishable from 2K at normal web/catalogue
        // display sizes and costs roughly 33% less per image - 2K only
        // matters for print or heavy pinch-zoom, neither of which applies here.
        imageConfig: { aspectRatio, imageSize: '1K' },
        abortSignal: controller.signal,
      } as never,
    });
    onUsage?.(extractUsage(response));
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

// Checks a STRONGER MODEL CANNOT FIX (spec §5 Stage 3).
//
// These are properties of the source photo, or of hallucination risk. A blurry
// counter photo stays blurry no matter how capable the next model is, and a
// model that has already invented a stone does not become less likely to
// invent one by being more expensive. The spec records that escalating on
// exactly these fields measured WORSE than the default tier on real production
// data - pure wasted spend.
//
// A failure here routes straight to needs_reshoot.
export const UNFIXABLE_BY_ESCALATION = [
  'sharpFocus',
  'notCropped',
  'clearlyIdentifiableCategory',
  'naturalDropPhysics',
  // The four design-fidelity fields. Fabrication is not a capability problem.
  'stoneCountMatches',
  'beadDetailPreserved',
  'chainPatternMatches',
  'engravingPreserved',
] as const;

// Checks a stronger pass plausibly DOES fix: rendering quality, not fidelity
// and not the source photo. These earn the one escalated retry.
export const FIXABLE_BY_ESCALATION = [
  'backgroundCleanWhite',
  'noBlownHighlights',
  'neutralWhiteBalance',
  'colorConsistentAcrossSurface',
] as const;

// The checklist keys are a contract with the analytics dashboard, which
// aggregates failures per key. Adding a key is fine; renaming one silently
// breaks the historical trend for that check.
//
// Note there is no single "matchesOriginalDesign" umbrella field. It was split
// into four (stone count, bead detail, chain pattern, engraving) because one
// vague boolean puts every fidelity failure in a bucket nobody can act on -
// "the design changed" tells you nothing, "bead count changed" tells you where
// to look.
export const AUDIT_CHECKS = [
  ...UNFIXABLE_BY_ESCALATION,
  ...FIXABLE_BY_ESCALATION,
] as const;

export type AuditCheck = (typeof AUDIT_CHECKS)[number];

export type EscalationDecision =
  | { escalate: true; failedFixable: AuditCheck[] }
  | { escalate: false; failedUnfixable: AuditCheck[] };

/**
 * Decides whether a failed audit is worth paying a stronger model for.
 *
 * Any unfixable failure vetoes escalation outright, even when a fixable one
 * failed alongside it: if the piece is cropped AND the background is grey,
 * fixing the background still leaves a cropped photo that has to be retaken.
 */
export function classifyAuditFailure(checklist: Record<AuditCheck, boolean>): EscalationDecision {
  const failedUnfixable = UNFIXABLE_BY_ESCALATION.filter((check) => checklist[check] === false);
  if (failedUnfixable.length > 0) {
    return { escalate: false, failedUnfixable: [...failedUnfixable] };
  }
  const failedFixable = FIXABLE_BY_ESCALATION.filter((check) => checklist[check] === false);
  return { escalate: true, failedFixable: [...failedFixable] };
}

export interface AuditResult {
  /** Recomputed server-side as the AND of every checklist field. Authoritative. */
  overallPass: boolean;
  /** What the model claimed, kept only so disagreement shows up in the logs. */
  modelClaimedPass: boolean | null;
  /** True when the model's own verdict contradicted its own checklist. */
  verdictDisagreed: boolean;
  reason: string;
  checklist: Record<AuditCheck, boolean>;
}

export async function auditOutput(
  ai: GoogleGenAI,
  originalBase64: string,
  originalMime: string,
  enhancedBase64: string,
  enhancedMime: string,
  context: AuditContext,
  model: string = MODEL_AUDIT,
  grounding?: { inventory: DetailInventory; crops: ReferenceImage[] },
  onUsage?: (usage: TokenUsage | null) => void
): Promise<AuditResult> {
  const crops = grounding?.crops ?? [];
  const prompt = buildAuditPrompt(context, grounding ? buildAuditInventoryBlock(grounding.inventory, crops) : '');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIT_TIMEOUT_MS);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          { inlineData: { mimeType: originalMime, data: originalBase64 } },
          { inlineData: { mimeType: enhancedMime, data: enhancedBase64 } },
          ...crops.map((c) => ({ inlineData: { mimeType: c.mimeType, data: c.base64 } })),
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        abortSignal: controller.signal,
      } as never,
    });
    onUsage?.(extractUsage(response));

    const parsed = JSON.parse(response.text?.trim() || '{}') as Record<string, unknown>;
    const checklist = Object.fromEntries(
      AUDIT_CHECKS.map((key) => [key, Boolean(parsed[key])])
    ) as Record<AuditCheck, boolean>;

    // The server ALWAYS recomputes the verdict as the logical AND of every
    // individual field, and ignores whatever the model put in `overallPass`.
    //
    // Spec §5 Stage 2 marks this as not optional: a model returning an
    // internally inconsistent blob - a false sub-check sitting next to
    // `overallPass: true` - has shipped bad photos in production before this
    // rule existed. The model's own field is kept only so that disagreement is
    // visible in the logs.
    const overallPass = Object.values(checklist).every(Boolean);
    const modelClaimedPass = typeof parsed.overallPass === 'boolean' ? parsed.overallPass : null;

    return {
      overallPass,
      modelClaimedPass,
      verdictDisagreed: modelClaimedPass !== null && modelClaimedPass !== overallPass,
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
  /**
   * Things in the photo that are not the jewellery: tags, hands, watermarks.
   * Used by faithful mode to blank them from the cut-out. Absent on results
   * cached before this field existed.
   */
  exclusions?: Exclusion[];
}

const EXCLUSION_KINDS = ['tag', 'hand', 'watermark', 'other'] as const;

function parseExclusions(raw: unknown): Exclusion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e) => Array.isArray(e?.box_2d) && e.box_2d.length === 4 && e.box_2d.every((v: unknown) => typeof v === 'number'))
    .map((e) => ({
      box: e.box_2d as number[],
      kind: (EXCLUSION_KINDS as readonly string[]).includes(e.kind) ? e.kind : 'other',
    }))
    .slice(0, 12);
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
  mimeType: string,
  onUsage?: (usage: TokenUsage | null) => void
): Promise<SegmentationResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEGMENT_TIMEOUT_MS);
  try {
    const prompt = `Give the precise segmentation outline of the single jewelry item in this image, and list everything in the photo that is NOT the jewelry but could be mistaken for part of it.
Output one JSON object:
{
  "box_2d": [ymin, xmin, ymax, xmax],
  "mask": [[y, x], [y, x], ...polygon points tracing the item's actual silhouette in order...],
  "label": "short description of the item",
  "exclusions": [ { "box_2d": [ymin, xmin, ymax, xmax], "kind": "tag" | "hand" | "watermark" | "other" } ]
}
All coordinates normalized 0-1000. Trace the jewelry's real outline closely, including any visible interior opening (e.g. a ring or bangle's finger/wrist hole) as part of the silhouette, not as a filled solid. A pair (two earrings) is one item: outline both.
In "exclusions" give a tight box for each price tag or label together with its string ("tag"), each finger or hand ("hand"), and any text printed on the photo by the camera such as "Shot on ..." ("watermark"). Use "other" for anything else that is not jewelry but touches or overlaps it. Use an empty list if there is nothing.`;

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
    onUsage?.(extractUsage(response));

    const parsed = JSON.parse(response.text?.trim() || '{}');
    // An object is what is asked for; a one-entry list is what the older
    // prompt asked for, and models sometimes still answer that way.
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (
      !first ||
      !Array.isArray(first.box_2d) || first.box_2d.length !== 4 ||
      !Array.isArray(first.mask) || first.mask.length < 3
    ) {
      return null;
    }
    return {
      boxTwoD: first.box_2d,
      polygon: first.mask,
      label: String(first.label || 'jewelry item'),
      exclusions: parseExclusions(first.exclusions),
    };
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
  context: CopyContext,
  onUsage?: (usage: TokenUsage | null) => void
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
    onUsage?.(extractUsage(response));

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

// Builds the context block appended to the enhance prompt. Same layout as v1,
// which the prompt was tuned against, with one change: the category line leads
// with the resolved trade category instead of the raw POS style name. The
// first pilot showed why - "ATTACHED CHAIN POTE" reached the model verbatim,
// the model had no way to know "pote" means black beads, and that category
// had the worst reshoot rate of all, with black beads rendered as gold.
export function buildContextBlock(input: {
  itemType?: string;
  purity?: string;
  gender?: string;
  weight?: string;
}): string {
  const item = describeItemType(input.itemType);
  return `

ADDITIONAL CONTEXT (FROM CATALOG FORM):
- Item Category: ${item.line}
${item.notes ? `- About this category: ${item.notes}\n` : ''}- Purity: ${input.purity || '22kt'} Gold
- Intended For: ${input.gender || "women's"}
${input.weight ? `- Weight: ${input.weight}g` : ''}`;
}

export function buildSegmentationBlock(segmentation: SegmentationResult): string {
  return `

PRECISE JEWELRY OUTLINE (from computer-vision analysis of the original photo, normalized 0-1000 [y, x] coordinates, traced in order around the actual physical silhouette including any interior opening): ${JSON.stringify(segmentation.polygon)}
Bounding box [ymin, xmin, ymax, xmax]: ${JSON.stringify(segmentation.boxTwoD)}
Every point inside this outline is part of the SAME physical piece described above. Use it to make sure you have not missed or misjudged any part of the item's true shape (including its interior opening, if any), and to apply your color correction and finish with perfect uniformity across the whole outlined area - including any motifs, engravings, or recessed details inside it.`;
}
