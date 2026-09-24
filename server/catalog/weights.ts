// Net weight is never typed: it is always Gross - Other, and equals Gross when
// there is no other weight. Shared by the Shoot form (to show it as staff type)
// and the API (so a stale or hand-edited value can never be saved).

export type NetWeightResult =
  | { ok: true; net: string }
  | { ok: false; error: string };

// Staff type on phone keypads, some of which only offer a comma.
export function parseGrams(raw: string | undefined | null): number | null {
  const text = String(raw ?? '').trim().replace(',', '.');
  if (!text) return null;
  if (!/^\d*\.?\d+$|^\d+\.$/.test(text)) return NaN;
  return Number(text);
}

export function computeNetWeight(gross: string | undefined | null, other: string | undefined | null): NetWeightResult {
  const g = parseGrams(gross);
  const o = parseGrams(other);
  if (g === null) return { ok: true, net: '' };
  if (Number.isNaN(g)) return { ok: false, error: 'Gross weight must be a number, e.g. 12.345' };
  if (o !== null && Number.isNaN(o)) return { ok: false, error: 'Other weight must be a number, e.g. 0.250' };
  const otherGrams = o ?? 0;
  if (otherGrams > g) return { ok: false, error: 'Other weight cannot be more than the gross weight.' };
  // Rounded to the milligram, like the tags. Working in integer milligrams
  // avoids float noise such as 12.345 - 0.1 = 12.244999999.
  const netMg = Math.round(g * 1000) - Math.round(otherGrams * 1000);
  return { ok: true, net: (netMg / 1000).toFixed(3) };
}
