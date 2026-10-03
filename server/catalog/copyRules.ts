// Per-category rules for the product name, and a safety net over whatever the
// model writes. The owner's rules: names should read well on the website,
// WhatsApp, the catalogue, the app, Pinterest and Instagram alike; use the
// Marathi/Hindi trade word where customers use it; never put the weight or the
// city in the name; and put purity, length or weight in the name only where it
// decides what the product IS (a gold coin is its purity).
import { resolveCategory, parseLengthInches } from './taxonomy';

export interface NameRules {
  purityInName: boolean;
  weightInName: boolean;
  lengthInName: boolean;
  /** Local / trade words customers search for that fit this category. */
  tradeTerms: string[];
}

const DEFAULT_RULES: NameRules = { purityInName: false, weightInName: false, lengthInName: false, tradeTerms: [] };

const BY_CATEGORY: Record<string, Partial<NameRules>> = {
  // A coin or bar IS its purity and its weight.
  Coin: { purityInName: true, weightInName: true },
  // Sold by length.
  Chain: { lengthInName: true, tradeTerms: ['chain', 'zanzeer'] },
  Mangalsutra: { lengthInName: true, tradeTerms: ['mangalsutra', 'pote', 'tanmani', 'vati'] },
  Mala: { lengthInName: true, tradeTerms: ['mala'] },
  'Waist Chain': { lengthInName: true, tradeTerms: ['kamarbandh'] },
  Haar: { tradeTerms: ['haar', 'rani haar'] },
  Jhumka: { tradeTerms: ['jhumka'] },
  Chandbali: { tradeTerms: ['chandbali'] },
  Bali: { tradeTerms: ['bali'] },
  Kada: { tradeTerms: ['kada'] },
  Bangle: { tradeTerms: ['bangle', 'bangdi', 'patli'] },
  'Nose Pin': { tradeTerms: ['nath', 'nose pin'] },
  Kansakhali: { tradeTerms: ['kansakhali', 'ear chain'] },
  'Vati Set': { tradeTerms: ['vati'] },
  Bajuband: { tradeTerms: ['bajuband', 'armlet'] },
  Anklet: { tradeTerms: ['payal', 'anklet'] },
};

export function nameRulesFor(itemType: string | undefined): NameRules {
  const category = resolveCategory(itemType ?? '');
  return { ...DEFAULT_RULES, ...(category ? BY_CATEGORY[category.type] : {}) };
}

/** What the name may and must not carry, as plain instructions for the model. */
export function describeNameRules(itemType: string | undefined, input: { purity?: string; weight?: string; size?: string }): string {
  const rules = nameRulesFor(itemType);
  const lines: string[] = [];
  const inches = parseLengthInches(input.size);
  lines.push(`Purity (${input.purity || '22kt'}): ${rules.purityInName ? 'MUST be in the name - it is what defines this product.' : 'leave it out of the name (it goes in the description and SEO fields).'}`);
  lines.push(`Weight${input.weight ? ` (${input.weight} g)` : ''}: ${rules.weightInName && input.weight ? 'include it in the name, e.g. "10 Gram" - it defines this product.' : 'never in the name.'}`);
  lines.push(`Length${inches ? ` (${inches} inch)` : ''}: ${rules.lengthInName && inches ? `include "${inches} Inch" in the name - customers choose by length.` : 'leave it out of the name.'}`);
  if (rules.tradeTerms.length) lines.push(`Trade words customers use for this: ${rules.tradeTerms.join(', ')} - use the one that fits as the item word.`);
  return lines.map((l) => `- ${l}`).join('\n');
}

const WEIGHT_RE = /\b\d+(?:\.\d+)?\s*(?:g|gm|gms|gram|grams|grm)\b\.?/gi;
const CITY_RE = /\bjalgaon\b/gi;
const BRAND_RE = /\brl\s*jewels\b/gi;

function tidy(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\s+([,.;:|-])/g, '$1').replace(/^[\s,.;:|-]+|[\s,.;:|-]+$/g, '').trim();
}

export interface CopyFields {
  name: string;
  description: string;
  metaTitle: string;
  metaDescription: string;
  imageAltText: string;
  searchKeywords: string;
  urlSlug: string;
}

/**
 * Enforces the hard rules on whatever the model returned. The prompt asks for
 * them, this makes sure: no city anywhere, no weight or store name in the name.
 */
export function sanitizeCopy(copy: CopyFields, itemType: string | undefined): CopyFields {
  const rules = nameRulesFor(itemType);
  let name = copy.name.replace(CITY_RE, '').replace(BRAND_RE, '');
  if (!rules.weightInName) name = name.replace(WEIGHT_RE, '');
  name = tidy(name);
  const noCity = (s: string) => tidy(s.replace(CITY_RE, ''));
  const slug = copy.urlSlug.replace(/jalgaon-?/gi, '').replace(/^-+|-+$/g, '');
  return {
    ...copy,
    name,
    description: noCity(copy.description),
    metaTitle: noCity(copy.metaTitle),
    metaDescription: noCity(copy.metaDescription),
    imageAltText: noCity(copy.imageAltText),
    searchKeywords: noCity(copy.searchKeywords),
    urlSlug: slug,
  };
}
