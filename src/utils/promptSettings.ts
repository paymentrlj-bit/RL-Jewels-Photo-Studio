/**
 * RL Jewels Studio Prompt Configuration & Admin Management
 */

export interface PromptConfig {
  enhancePrompt: string;
  auditPrompt?: string;
  tryonPrompt?: string;
  updatedAt?: string;
}

export const DEFAULT_ENHANCE_PROMPT = `Create a premium e-commerce product photograph of the jewellery item shown in the reference image.

CRITICAL PRIORITY — PRESERVE THE PRODUCT:

* Reproduce the jewellery piece exactly as shown in the reference image.
* Do NOT redesign, simplify, embellish, remove, add, or reinterpret any part of the jewellery.
* Preserve the exact shape, proportions, dimensions, motifs, engraving, textures, stones, setting, edges, patterns, construction and overall design.
* Preserve the correct orientation and viewing angle of the original product.
* The final image must clearly depict the same physical jewellery item, not an AI-invented variation.
* Do not add gemstones, diamonds, pearls, chains, clasps, decorative elements or patterns that are not present in the reference.
* Do not change the jewellery into a different type of ornament.

PRODUCT PHOTOGRAPHY:

* Professional high-end jewellery e-commerce photography.
* Product isolated on a pure seamless white background (#FFFFFF).
* Product positioned centrally with generous clean whitespace around it.
* Camera positioned at the most natural straight-on product/catalogue angle appropriate for the jewellery.
* Product should occupy approximately 65–80% of the image frame, depending on its shape.
* Extremely sharp focus across the entire jewellery piece.
* High-resolution commercial photography.
* Realistic macro-level detail and physically accurate geometry.
* Clean edges with precise background separation.
* No hands, fingers, people, mannequin, jewellery box, props, fabric, table, flowers or decorative background elements.

LIGHTING:

* Use a professional multi-light jewellery studio setup.
* Large soft diffused key light with carefully controlled fill lighting.
* Add subtle directional highlights to reveal the jewellery’s contours and craftsmanship.
* Preserve realistic metallic reflections without creating distracting hotspots.
* Ensure intricate engraving, filigree, textures and recessed areas remain clearly visible.
* Balanced exposure with excellent highlight and shadow detail.
* No blown-out reflections.
* No harsh artificial glow.

MATERIAL & COLOUR ACCURACY:

* Accurately reproduce the jewellery’s actual metal colour and finish from the reference.
* For gold: rich, realistic 22K/24K-style warm yellow-gold appearance without excessive orange saturation.
* For silver/platinum/white gold: realistic neutral metallic appearance.
* Preserve the exact finish visible in the reference: polished, matte, brushed, textured, oxidised, etc.
* Metal must look physically realistic, dense and premium — not plastic, CGI or overly glossy.
* Preserve the natural micro-reflections expected from real precious metal.

SHADOW & REFLECTION:

* Add a very subtle, soft natural contact shadow directly beneath the product where physically appropriate.
* Optional extremely subtle studio reflection beneath the product.
* The shadow/reflection must remain understated and must never distract from the jewellery.
* Avoid floating-product appearance.

IMAGE QUALITY:

* Luxury jewellery catalogue aesthetic.
* Photorealistic.
* Clean, minimal, premium and sophisticated.
* Accurate fine details.
* No artificial sharpening halos.
* No blur.
* No noise.
* No watermark.
* No text.
* No logo.
* No price tag.
* No packaging.

COMPOSITION:

* Square 1:1 composition suitable for an e-commerce product catalogue.
* Product perfectly centered.
* Consistent scale and framing.
* White background extending seamlessly to all edges.
* Leave enough margin so no part of the jewellery is cropped.

FINAL RESULT:
The result should look like a photograph produced by a top-tier professional jewellery e-commerce studio, suitable for the main product image on a premium jewellery website such as a luxury Indian jewellery retailer.

MOST IMPORTANT: The reference jewellery itself is the source of truth. The photography style, lighting and background may be improved, but the jewellery’s actual design must remain unchanged.`;

export const STORAGE_KEY_PROMPTS = 'rl_jewels_prompt_config_v1';

export function getStoredPromptConfig(): PromptConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PROMPTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.enhancePrompt === 'string' && parsed.enhancePrompt.trim()) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading stored prompt config:', e);
  }
  return {
    enhancePrompt: DEFAULT_ENHANCE_PROMPT,
  };
}

export function saveStoredPromptConfig(config: PromptConfig): void {
  try {
    const updated = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(updated));
  } catch (e) {
    console.error('Error saving prompt config to localStorage:', e);
  }
}

export function resetStoredPromptConfig(): PromptConfig {
  const defaults: PromptConfig = {
    enhancePrompt: DEFAULT_ENHANCE_PROMPT,
    updatedAt: new Date().toISOString(),
  };
  saveStoredPromptConfig(defaults);
  return defaults;
}
