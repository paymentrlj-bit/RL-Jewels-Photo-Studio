#!/usr/bin/env node
/**
 * Spike B - mask-conditioned editing (PIPELINE_REBUILD_BRIEF.md Section 6
 * "Spike B" / Section 3.2 Stage B1).
 *
 * Runs the EXACT intended Stage B1 mechanism against the real Gemini API:
 * a masked inpaint call using MODEL_ENHANCE_DEFAULT (or --escalated for
 * MODEL_ENHANCE_ESCALATED), via the same @google/genai SDK and the same
 * generateContent + imageConfig call shape server.ts already uses - not a
 * reimplementation, the real call.
 *
 * IMPORTANT FINDING (from reading node_modules/@google/genai's own types
 * before writing this script): generateContent's ImageConfig has NO mask
 * field at all (only aspectRatio/imageSize/personGeneration/etc). The SDK's
 * only real pixel-locked masking API is `editImage` + `MaskReferenceImage`,
 * documented and exemplified exclusively against the Imagen model family
 * (e.g. imagen-3.0-capability-001) - not gemini-3.1-flash-image or
 * nano-banana-pro-preview, the models this app actually uses and that
 * Section 1 says to reuse rather than introduce new unverified ones. So
 * there is no native mask input available for this call at all - the ONLY
 * lever is a text-described region in the prompt. This script measures how
 * well the model actually respects that instruction.
 *
 * Usage:
 *   GEMINI_API_KEY=... node masked_inpaint.js --manifest sample_input/manifest.json --outdir output [--escalated]
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const MODEL_ENHANCE_DEFAULT = 'gemini-3.1-flash-image';
const MODEL_ENHANCE_ESCALATED = 'nano-banana-pro-preview';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { manifest: 'sample_input/manifest.json', outdir: 'output', escalated: false, maskOverlay: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--manifest') out.manifest = args[++i];
    else if (args[i] === '--outdir') out.outdir = args[++i];
    else if (args[i] === '--escalated') out.escalated = true;
    else if (args[i] === '--mask-overlay') out.maskOverlay = true;
  }
  return out;
}

// Same masked-inpaint instruction shape Section 3.2 describes: edit only
// within the given region, remove the foreign object, reconstruct plausible
// continuation of whatever it occludes. Coordinates use this app's existing
// 0-1000 normalized [ymin, xmin, ymax, xmax] convention (segmentJewelry in
// server.ts already uses this same convention for its own bounding box).
function buildPrompt({ itemType, purity, crossingBox }) {
  return `You are editing a studio product photo of a ${purity} gold ${itemType}.

A foreign object (a string, thread, or tag) crosses over the jewelry in this exact region of the image, normalized 0-1000 [ymin, xmin, ymax, xmax]: ${JSON.stringify(crossingBox)}.

Edit ONLY within that described region:
- Remove the foreign object completely.
- Reconstruct a plausible continuation of whatever it was occluding - the jewelry's own material, band, or pattern if the crossing is over the piece itself, or the plain background otherwise.

CRITICAL: do not change anything outside that region. The rest of the image - the jewelry everywhere else, the background, the lighting, the composition - must remain pixel-identical to the input. Do not re-crop, re-pose, resize, or otherwise touch anything beyond the described region.`;
}

// Alternate strategy: since there is no real mask INPUT parameter (see
// header comment), test whether SHOWING a visual mask as a second image
// gets better region compliance than describing the region in text/
// coordinates alone - this is the practical question that decides what
// Stage B1's actual prompt should look like if it ships at all.
function buildMaskOverlayPrompt({ itemType, purity }) {
  return `You are editing a studio product photo of a ${purity} gold ${itemType} (IMAGE 1).

IMAGE 2 is a mask: a magenta rectangle on black, marking the exact region of IMAGE 1 you are allowed to edit. A foreign object (a string, thread, or tag) crosses over the jewelry inside that magenta region.

Edit ONLY the pixels of IMAGE 1 that fall within IMAGE 2's magenta region:
- Remove the foreign object completely.
- Reconstruct a plausible continuation of whatever it was occluding - the jewelry's own material, band, or pattern if the crossing is over the piece itself, or the plain background otherwise.

CRITICAL: every pixel of IMAGE 1 outside the magenta region in IMAGE 2 must remain PIXEL-IDENTICAL to IMAGE 1 - same shading, same edges, same background, same composition, same crop. Do not regenerate, re-render, or stylistically enhance anything outside the magenta region, even if it would look better. Output an image the same size as IMAGE 1.`;
}

async function main() {
  const { manifest: manifestPath, outdir, escalated, maskOverlay } = parseArgs();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set.');
    process.exit(1);
  }

  const manifestDir = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const cases = Array.isArray(manifest) ? manifest : [manifest];

  fs.mkdirSync(outdir, { recursive: true });
  const ai = new GoogleGenAI({ apiKey });
  const model = escalated ? MODEL_ENHANCE_ESCALATED : MODEL_ENHANCE_DEFAULT;

  const results = [];
  for (const c of cases) {
    const imagePath = path.join(manifestDir, c.file);
    const imageBuffer = fs.readFileSync(imagePath);
    const mimeType = imagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';

    const parts = [{ inlineData: { mimeType, data: imageBuffer.toString('base64') } }];
    let prompt;
    if (maskOverlay) {
      const overlayPath = path.join(manifestDir, `${path.parse(c.file).name}_mask_overlay.png`);
      const overlayBuffer = fs.readFileSync(overlayPath);
      parts.push({ inlineData: { mimeType: 'image/png', data: overlayBuffer.toString('base64') } });
      prompt = buildMaskOverlayPrompt({ itemType: c.itemType, purity: c.purity });
    } else {
      prompt = buildPrompt({ itemType: c.itemType, purity: c.purity, crossingBox: c.crossing_box_0_1000 });
    }
    parts.push({ text: prompt });

    console.log(`[${c.file}] calling ${model} (${maskOverlay ? 'visual mask-overlay image' : 'text-described region'}, no native mask input available)...`);
    const startedAt = Date.now();
    let response;
    try {
      response = await ai.models.generateContent({
        model,
        contents: { parts },
        config: {
          // Same imageConfig shape production uses (server.ts enhanceImage) -
          // 1:1 here since the test ring is square; a real Stage B1 call
          // would pass whatever aspect ratio Stage A already resolved.
          imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        },
      });
    } catch (err) {
      console.error(`[${c.file}] API call failed:`, err.message || err);
      results.push({ file: c.file, error: String(err.message || err) });
      continue;
    }
    const latencyMs = Date.now() - startedAt;

    const responseParts = response.candidates?.[0]?.content?.parts || [];
    const imgPart = responseParts.find((p) => p.inlineData?.data);
    if (!imgPart) {
      console.error(`[${c.file}] model returned no image.`);
      results.push({ file: c.file, error: 'no image returned', latencyMs });
      continue;
    }

    const label = path.parse(c.file).name;
    const outPath = path.join(outdir, `${label}_edited.png`);
    fs.writeFileSync(outPath, Buffer.from(imgPart.inlineData.data, 'base64'));
    console.log(`[${c.file}] done in ${latencyMs}ms -> ${outPath}`);

    results.push({
      file: c.file,
      label,
      itemType: c.itemType,
      purity: c.purity,
      crossing_box_0_1000: c.crossing_box_0_1000,
      model,
      latencyMs,
      original_path: imagePath,
      edited_path: outPath,
    });
  }

  fs.writeFileSync(path.join(outdir, 'inpaint_results.json'), JSON.stringify(results, null, 2));
  console.log(`\nWrote ${results.length} result(s) to ${outdir}/inpaint_results.json`);
  console.log('Next: run diff_outside_mask.py against these original/edited pairs to measure the outside-mask guardrail rejection rate.');
}

main();
