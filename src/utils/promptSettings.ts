/**
 * RL Jewels Studio Prompt Configuration & Admin Management
 */

export interface PromptConfig {
  enhancePrompt: string;
  updatedAt?: string;
}

// This prompt is deliberately framed as a strict pixel-preservation task, not a
// creative-generation task. Testing showed that a softer "make this look nice"
// framing leads the model to invent details (engravings, different band profiles)
// that aren't on the real piece - a real compliance risk for a jewelry catalogue.
export const DEFAULT_ENHANCE_PROMPT = `Edit ONLY the background and lighting of this exact photograph of a piece of fine jewelry. This is a strict pixel-preservation and cleanup task, not a creative generation task. Treat the jewelry itself as fixed content to be lifted onto a new background, not repainted or reimagined.

ABSOLUTE RULES (violating any of these is a failure, even if the final image looks appealing):
* Do NOT redraw, re-render, redesign, or reinterpret the jewelry item.
* Do NOT add any engraving, motif, pattern, gemstone, or decorative element anywhere that is not clearly visible in the original photo.
* Do NOT remove or simplify any engraving, motif, pattern, or stone that IS visible in the original photo.
* Do NOT change the item's proportions, band/chain thickness, cross-section, or profile, even if they look informal or imperfect as photographed.
* Do NOT change the stone cut, facet pattern, count, or setting style beyond what is visible in the original.
* Do NOT change the viewing angle or orientation of the piece.
* The output must remain recognizably the exact same physical item a customer could hold in their hand next to this photo.

ALLOWED CHANGES ONLY:
1. Replace the background with pure seamless white (#FFFFFF), studio e-commerce style, extending to all edges.
2. If a SKU/price tag is visible and does not overlap the jewelry, remove it along with the background.
3. Correct white balance and exposure so the metal reads as its true, neutral color under even studio lighting (gold as warm yellow - not orange, not pale; silver/white metal as neutral - not blue-tinted), regardless of the original light source.
4. Remove dust, fingerprints, and handling smudges from the metal surface. Do not soften or blur any hallmark stamp, engraving, or manufacturing texture that is present - it must stay sharp and legible.
5. Balance exposure so metal highlights are not blown out to pure white and shadow areas keep visible detail.
6. Straighten and center the composition and add a soft, subtle, realistic contact shadow directly beneath the piece for grounding. Do not add a reflection or any other prop.

OUTPUT: square (1:1) composition, the jewelry centered and occupying roughly 65-80% of the frame with clean margin so nothing is cropped, pure white background, ready for an e-commerce product catalogue.`;

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
