// Detail inventory: a verified count and description of the piece's fine
// detail, taken BEFORE enhancement and treated as ground truth by both the
// enhance call and the audit.
//
// Why this exists. In the first pilot (35 photos, September 2026) every single
// failed audit was a fine-detail fidelity failure - bead count, engraving,
// chain pattern, drop structure, stone count - and not one was lighting,
// background, white balance or framing. The image model is excellent at the
// studio look and weak at small countable structure, for two reasons this
// module attacks directly:
//
//   1. It sees the whole photo through a limited per-image token budget, so a
//      fringe of seven 40-pixel beads becomes a blur it has to guess at.
//      Cropping those areas at full resolution and sending them alongside the
//      photo gives it the actual pixels.
//   2. Nobody ever told it the numbers. The enhance model was asked to "keep
//      the count" without anyone having counted, and the audit model was asked
//      to compare two downscaled images by eye. Here a stronger reasoning model
//      counts once, from the close-ups, and both downstream calls get the
//      numbers as facts.
//
// Pipeline: detect the intricate regions (cheap spatial model) -> crop them
// locally with sharp (free) -> count and describe from photo + crops (strong
// model). The crops are extra INPUT images, which are billed as input tokens
// and cost a small fraction of the output image - the generated photo is
// still exactly one image, never stitched together from pieces.
//
// Fails open everywhere, like segmentation grounding: any failure here and the
// pipeline behaves exactly as it did before this module existed.

import sharp from 'sharp';
import type { GoogleGenAI } from '@google/genai';
import {
  MODEL_SEGMENT,
  MODEL_INVENTORY,
  SEGMENT_TIMEOUT_MS,
  INVENTORY_TIMEOUT_MS,
  withTransientRetry,
  type RetryAttemptInfo,
} from './client';

// libvips keeps a decoded-image cache and a thread per core by default. On a
// 1 GB server running two pipeline workers, neither is worth the memory.
sharp.cache(false);
sharp.concurrency(1);

// Three is deliberate: enough for the typical intricate areas of one piece
// (a bead fringe, a motif, a chain section) while staying well inside what the
// image models accept as reference inputs alongside the main photo.
export const MAX_DETAIL_REGIONS = 3;
// Long edge of each close-up. A crop smaller than this is sent at its native
// size - upscaling adds no information the model can use.
const CROP_MAX_EDGE = 1024;
// A box covering more than this share of the frame is "the whole piece", which
// defeats the point of a close-up.
const MAX_REGION_AREA = 0.6;

export interface DetailRegion {
  /** [ymin, xmin, ymax, xmax], normalized 0-1000, as Gemini returns boxes. */
  box: [number, number, number, number];
  label: string;
}

export interface ReferenceImage {
  base64: string;
  mimeType: string;
  label: string;
  /**
   * closeup: cropped from the main photo. angle: a separate photo of the same
   * piece from another viewpoint, added by staff when part of it was hidden.
   * The models are told which is which - an angle photo is new information,
   * a close-up is the same pixels made bigger.
   */
  kind: 'closeup' | 'angle';
}

// Extra angle photos per piece. Two is enough to see round the usual
// obstructions (a tag, the other earring, the stand) without turning one
// product into a photo shoot.
export const MAX_ANGLE_PHOTOS = 2;

export interface InventoryElement {
  feature: string;
  count: number | null;
  countConfidence: 'high' | 'medium' | 'low';
  shape: string;
  colorMaterial: string;
  arrangement: string;
}

export interface DetailInventory {
  elements: InventoryElement[];
  chainStrands: number | null;
  chainLinkStyle: string | null;
  surfaceFinish: string | null;
  naturalOrientation: string | null;
  proportions: string | null;
  referenceScale: { present: boolean; measurements: string | null };
}

/** What is cached per image: small JSON only, never image data. */
export interface InventoryAnalysis {
  /** Only the regions that were actually cropped and shown to the counter. */
  regions: DetailRegion[];
  inventory: DetailInventory;
}

export interface InventoryItemContext {
  /** From describeItemType(): resolved trade category plus the tag name. */
  itemLine: string;
  itemNotes: string | null;
  purity: string;
}

// ---------------------------------------------------------------------------
// Parsing - pure, so the defensive handling of model output is testable.
// ---------------------------------------------------------------------------

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 400) : null;
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function parseDetailRegions(raw: unknown): DetailRegion[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { regions?: unknown })?.regions)
      ? (raw as { regions: unknown[] }).regions
      : [];

  const regions: DetailRegion[] = [];
  for (const entry of list) {
    const box = (entry as { box_2d?: unknown })?.box_2d;
    if (!Array.isArray(box) || box.length !== 4 || !box.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
    const [ymin, xmin, ymax, xmax] = (box as number[]).map((v) => clamp(v, 0, 1000));
    if (ymax <= ymin || xmax <= xmin) continue;
    if (((ymax - ymin) * (xmax - xmin)) / 1_000_000 > MAX_REGION_AREA) continue;
    regions.push({ box: [ymin, xmin, ymax, xmax], label: str((entry as { label?: unknown }).label) || 'detail area' });
    if (regions.length === MAX_DETAIL_REGIONS) break;
  }
  return regions;
}

export function parseInventory(raw: unknown): DetailInventory | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const elements: InventoryElement[] = [];
  for (const e of Array.isArray(r.elements) ? r.elements : []) {
    const feature = str((e as Record<string, unknown>)?.feature);
    if (!feature) continue;
    const el = e as Record<string, unknown>;
    const confidence = el.countConfidence;
    elements.push({
      feature,
      count: num(el.count),
      countConfidence: confidence === 'high' || confidence === 'low' ? confidence : 'medium',
      shape: str(el.shape) || '',
      colorMaterial: str(el.colorMaterial) || '',
      arrangement: str(el.arrangement) || '',
    });
    if (elements.length === 12) break;
  }

  const scale = (r.referenceScale || {}) as Record<string, unknown>;
  return {
    elements,
    chainStrands: num(r.chainStrands),
    chainLinkStyle: str(r.chainLinkStyle),
    surfaceFinish: str(r.surfaceFinish),
    naturalOrientation: str(r.naturalOrientation),
    proportions: str(r.proportions),
    referenceScale: { present: scale.present === true, measurements: str(scale.measurements) },
  };
}

/** Pixel rectangle for a normalized box, padded so the detail has context. */
export function paddedPixelBox(
  box: DetailRegion['box'],
  width: number,
  height: number
): { left: number; top: number; width: number; height: number } {
  const [ymin, xmin, ymax, xmax] = box;
  // 15% of the box on each side, but never less than 2% of the frame - a
  // bead fringe cropped flush to its edge loses the metal it hangs from,
  // which is exactly the context needed to count it correctly.
  const padX = Math.max((xmax - xmin) * 0.15, 20);
  const padY = Math.max((ymax - ymin) * 0.15, 20);
  const left = Math.floor((clamp(xmin - padX, 0, 1000) / 1000) * width);
  const top = Math.floor((clamp(ymin - padY, 0, 1000) / 1000) * height);
  const right = Math.min(Math.ceil((clamp(xmax + padX, 0, 1000) / 1000) * width), width);
  const bottom = Math.min(Math.ceil((clamp(ymax + padY, 0, 1000) / 1000) * height), height);
  return { left, top, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
}

// ---------------------------------------------------------------------------
// Cropping
// ---------------------------------------------------------------------------

export async function cropDetailRegions(
  image: Buffer,
  regions: DetailRegion[]
): Promise<{ region: DetailRegion; crop: ReferenceImage }[]> {
  if (regions.length === 0) return [];

  // Orientation is baked in once so the crop boxes land on the same pixels the
  // model's box coordinates referred to.
  const oriented = await sharp(image).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = oriented.info;

  const out: { region: DetailRegion; crop: ReferenceImage }[] = [];
  for (const region of regions) {
    const rect = paddedPixelBox(region.box, width, height);
    if (rect.width < 16 || rect.height < 16) continue;
    const data = await sharp(oriented.data)
      .extract(rect)
      .resize({ width: CROP_MAX_EDGE, height: CROP_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    out.push({ region, crop: { base64: data.toString('base64'), mimeType: 'image/jpeg', label: region.label, kind: 'closeup' } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The two model calls. Both throw on API errors (so withTransientRetry can
// retry, and so a failure is never cached) and fail soft on odd output.
// ---------------------------------------------------------------------------

async function callJson(
  ai: GoogleGenAI,
  model: string,
  parts: object[],
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await ai.models.generateContent({
      model,
      contents: { parts } as never,
      config: { responseMimeType: 'application/json', abortSignal: controller.signal } as never,
    });
    return JSON.parse(response.text?.trim() || 'null');
  } finally {
    clearTimeout(timeout);
  }
}

export async function detectDetailRegions(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  item: InventoryItemContext
): Promise<DetailRegion[]> {
  const prompt = `This photo shows one jewelry piece: ${item.itemLine}.
Find up to ${MAX_DETAIL_REGIONS} areas of the piece where the design detail is small and intricate enough to be easily miscounted or simplified when the piece is redrawn: clusters, rows or fringes of small beads, balls or tassels; granulation; rows or halos of small stones; black-bead sections; sections of chain or mesh whose link pattern is hard to see at full-photo size; engravings, carved or filigree motifs, enamel work.
Prefer areas with small countable elements. Keep each box tight around that detail - never the whole piece, never plain smooth metal, never a price tag, hand, stand or background. If the piece is a matching pair (e.g. two earrings), choose the area on only one of them unless the two genuinely differ.
Output a JSON list, most intricate first: [{"box_2d": [ymin, xmin, ymax, xmax], "label": "short description, e.g. 'bead fringe along the base of the left jhumka'"}]. Coordinates normalized 0-1000. Output [] if the piece has no such detail.`;

  let parsed: unknown;
  try {
    parsed = await callJson(ai, MODEL_SEGMENT, [{ inlineData: { mimeType, data: imageBase64 } }, { text: prompt }], SEGMENT_TIMEOUT_MS);
  } catch (err) {
    // Unparseable output is not worth a retry - carry on with no close-ups,
    // the count still runs on the full photo. API errors still propagate.
    if (err instanceof SyntaxError) return [];
    throw err;
  }
  return parseDetailRegions(parsed);
}

export async function countDetails(
  ai: GoogleGenAI,
  imageBase64: string,
  mimeType: string,
  refs: ReferenceImage[],
  item: InventoryItemContext
): Promise<DetailInventory> {
  const closeUps = describeRefs(refs, 2, 'IMAGE');

  const prompt = `You are a jewelry inspector writing a precise inventory of ONE physical piece, so that an image editor can reproduce it exactly and a quality inspector can check the result against it.
Item: ${item.purity} gold ${item.itemLine}.${item.itemNotes ? `\nAbout this category: ${item.itemNotes}` : ''}
IMAGE 1 is the full counter photo.${closeUps}

Rules:
- Wherever a close-up covers an area, count from the close-up - it shows far more detail than IMAGE 1.
- Photos from another angle show the SAME single piece. Use them to count anything hidden or unclear in IMAGE 1, but never add the views together: an element seen in two photos is one element.
- Count literally, one element at a time. Do not estimate, round, or assume symmetry: if two sides of a pair differ, record both.
- If part of a group is hidden (behind a finger, a tag, the other earring, or out of frame), set countConfidence to "low" and say what is hidden in "arrangement", rather than guessing the hidden part.
- Record colour and material exactly as seen: black beads are black beads, enamel is enamel (name its colours), white stones are white stones - never describe any of them as plain gold.
- Record shape exactly: a flat disc with a carved centre is not a ball; an open filigree bail is not a solid carved bail.
- Ignore price tags, display stands, hands, the background and hallmark stamps (e.g. 916) - do not list any of them. A ruler or measuring scale, if present, is a measuring aid: record what it measures under referenceScale, never as part of the piece.

Respond ONLY as JSON:
{
  "elements": [{"feature": string, "count": number | null, "countConfidence": "high" | "medium" | "low", "shape": string, "colorMaterial": string, "arrangement": string}],
  "chainStrands": number | null,
  "chainLinkStyle": string | null,
  "surfaceFinish": string,
  "naturalOrientation": string,
  "proportions": string,
  "referenceScale": {"present": boolean, "measurements": string | null}
}
Field guide:
- elements: every countable or design-defining feature - bead fringes, stones, motifs, drops, tassels, panels, cages, black-bead sections. Example: {"feature": "bead fringe along the base of each jhumka bell", "count": 7, "countConfidence": "high", "shape": "round balls", "colorMaterial": "plain polished gold", "arrangement": "single evenly spaced row, 7 on each earring"}. Use count null only for things that are genuinely not countable, like a continuous texture.
- chainLinkStyle: e.g. "flat hand-made links", "round ball chain", "box chain", "rope chain". null if there is no chain.
- surfaceFinish: each finish and where it is, e.g. "mirror-polished domes on a matte sandblasted background, diamond-cut edges".
- naturalOrientation: e.g. "vertical - hangs from the bail at the top".
- proportions: relative sizes that must be preserved, e.g. "each chain drop is about 2x the height of the pendant body".`;

  const parts: object[] = [
    { inlineData: { mimeType, data: imageBase64 } },
    ...refs.map((c) => ({ inlineData: { mimeType: c.mimeType, data: c.base64 } })),
    { text: prompt },
  ];

  const inventory = parseInventory(await callJson(ai, MODEL_INVENTORY, parts, INVENTORY_TIMEOUT_MS));
  if (!inventory) throw new Error('The inventory model returned no usable inventory.');
  return inventory;
}

/**
 * Detect -> crop -> count. Returns the cacheable analysis plus the crops it
 * made, so the caller can reuse them instead of cropping twice.
 */
export async function analyzeDetail(
  ai: GoogleGenAI,
  image: { buffer: Buffer; base64: string; mimeType: string },
  item: InventoryItemContext,
  hooks: { deadline: number; onAttempt: (stage: string, model: string) => (info: RetryAttemptInfo) => void },
  angles: ReferenceImage[] = []
): Promise<{ analysis: InventoryAnalysis; crops: ReferenceImage[] }> {
  const regions = await withTransientRetry(
    () => detectDetailRegions(ai, image.base64, image.mimeType, item),
    2,
    hooks.deadline,
    hooks.onAttempt('inventory-detect', MODEL_SEGMENT)
  );

  let cropped: { region: DetailRegion; crop: ReferenceImage }[] = [];
  try {
    cropped = await cropDetailRegions(image.buffer, regions);
  } catch (err) {
    // An image sharp cannot decode still gets a full-photo count.
    console.warn('[inventory] cropping failed, counting from the full photo only:', (err as Error).message);
  }
  const crops = cropped.map((c) => c.crop);

  const inventory = await withTransientRetry(
    () => countDetails(ai, image.base64, image.mimeType, [...crops, ...angles], item),
    2,
    hooks.deadline,
    hooks.onAttempt('inventory-count', MODEL_INVENTORY)
  );

  return { analysis: { regions: cropped.map((c) => c.region), inventory }, crops };
}

// ---------------------------------------------------------------------------
// Prompt blocks
// ---------------------------------------------------------------------------

function inventoryLines(inv: DetailInventory): string[] {
  const lines: string[] = [];
  for (const e of inv.elements) {
    const count = e.count === null ? 'not a countable element' : `exactly ${e.count}`;
    const hidden = e.countConfidence === 'low' ? ' (partly hidden in the photo - reproduce only what is visible, never add to it)' : '';
    const detail = [e.shape, e.colorMaterial, e.arrangement].filter(Boolean).join('; ');
    lines.push(`- ${e.feature}: ${count}${hidden}${detail ? `; ${detail}` : ''}`);
  }
  if (inv.chainStrands !== null || inv.chainLinkStyle) {
    lines.push(`- Chain: ${inv.chainStrands !== null ? `${inv.chainStrands} strand(s)` : 'strand count not determined'}${inv.chainLinkStyle ? `, ${inv.chainLinkStyle}` : ''}`);
  }
  if (inv.surfaceFinish) lines.push(`- Surface finish: ${inv.surfaceFinish}`);
  if (inv.naturalOrientation) lines.push(`- Natural orientation: ${inv.naturalOrientation}`);
  if (inv.proportions) lines.push(`- Proportions: ${inv.proportions}`);
  if (inv.referenceScale.present && inv.referenceScale.measurements) {
    lines.push(`- Measured against the reference scale in the photo: ${inv.referenceScale.measurements}`);
  }
  return lines;
}

export function buildInventoryBlock(inv: DetailInventory): string {
  const lines = inventoryLines(inv);
  if (lines.length === 0) return '';
  return `

VERIFIED DETAIL INVENTORY (a separate inspection of this exact photo, counted from full-resolution close-ups - every line is a fact about the physical piece, not a suggestion):
${lines.join('\n')}
Your output must match every count, shape, colour/material, chain style, finish and proportion above. Keep each area's surface finish distinct as described - do not give the whole piece one uniform shine.`;
}

// Names each reference image by its position in the request, so the model
// knows which inputs are close-ups of the main photo and which are genuinely
// different photos of the piece.
function describeRefs(refs: ReferenceImage[], firstNumber: number, word: string): string {
  if (refs.length === 0) return '';
  const parts = refs.map((r, i) => {
    const n = `${word} ${firstNumber + i}`;
    return r.kind === 'angle'
      ? `${n} is the same piece photographed from another angle`
      : `${n} is a full-resolution close-up cropped from ${word} 1: "${r.label}"`;
  });
  return ` ${parts.join('; ')}.`;
}

export function buildReferenceImagesBlock(refs: ReferenceImage[]): string {
  if (refs.length === 0) return '';
  return `

REFERENCE IMAGES: the first image is the photo to transform. The ${refs.length} image(s) after it show the SAME single piece:${describeRefs(refs, 2, 'image')} Use them only to see detail accurately and to understand parts the first photo hides. They are not separate products and not views to combine side by side: your output must show the single piece from the first image, exactly once.`;
}

export function buildAuditInventoryBlock(inv: DetailInventory, refs: ReferenceImage[]): string {
  const lines = inventoryLines(inv);
  if (lines.length === 0) return '';
  // In the audit, IMAGE 2 is the enhanced result, so references start at 3.
  const closeUps = refs.length ? ` IMAGES 3 onward are references of the original piece:${describeRefs(refs, 3, 'IMAGE')}` : '';
  return `

VERIFIED DETAIL INVENTORY OF IMAGE 1 (counted by a separate inspection from full-resolution close-ups and any other-angle photos).${closeUps}
These numbers are more reliable than anything you can count from the full view of IMAGE 1: copy them into originalCounts, then check IMAGE 2 against every line - count, shape, colour/material, chain style and proportions, not just count. For example: black beads must still be black, flat carved discs must not have become round balls, enamel colours must still be present, a flat hand-made chain must not have become a ball or rope chain, a solid carved bail must not have become an open one.
${lines.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Asking for another angle
// ---------------------------------------------------------------------------

/**
 * Countable elements the inspector could only partly see. These are the
 * likeliest to come back miscounted, so a piece with any of them is worth one
 * more photo before paying for the enhancement - while the piece is still at
 * the counter, not after a failed audit.
 */
export function hiddenElements(inv: DetailInventory): InventoryElement[] {
  return inv.elements.filter((e) => e.countConfidence === 'low' && e.count !== null);
}

export function buildAngleRequestReason(hidden: InventoryElement[]): string {
  const what = hidden
    .slice(0, 3)
    .map((e) => (e.arrangement ? `${e.feature} (${e.arrangement})` : e.feature))
    .join('; ');
  return `Part of this piece is hidden in the photo: ${what}. Add one more photo from an angle where it is fully visible, or choose "Process anyway".`;
}
