// CPC (Counter Product Code) master lookup - lets the app recognize a CPC
// number the moment it's scanned or typed and instantly know its product
// name, size, metal, and purity, instead of relying on OCR-guessing a
// physical tag's printed text.
//
// Source: a one-time export from the store's own POS/inventory system
// (data/cpc-master.csv, 82,891 rows across all metals - GOLD, SILVER,
// DIAMOND, ONE GRAM, BY PCS, STONES). That system builds every CPC number
// the same way: <ProductId><BranchSeparator "L"><LotNo>, e.g. "1265L1051"
// = ProductId 1265, LotNo 1051 - verified against the real export that
// StyleName/GroupName/Purity/PrimaryGroupID are consistent across every
// lot of the same ProductId in all but one case out of 3,247 products (see
// deriveProductIdFromCpc below and the "product-sibling" match type this
// enables), while SizeName can legitimately vary per lot.
//
// Feature scope right now is GOLD only (per current product priority) -
// this module loads and indexes every row regardless of metal so the data
// is ready to use the moment other metals are wanted, but callers (see
// server.ts's /api/cpc-lookup route and ProductForm.tsx) currently only
// act on a match whose groupName is GOLD.

import fs from 'fs';
import path from 'path';

export interface CpcMasterRecord {
  cpcNumber: string;
  productId: string;
  lotNo: string;
  styleName: string;
  sizeName: string;
  designName: string;
  groupName: string;
  purity: string;
  primaryGroupId: string;
  designId: string;
  sizeId: string;
  sellByPiece: string;
}

const CSV_PATH = path.join(process.cwd(), 'data', 'cpc-master.csv');
const CSV_COLUMNS: (keyof CpcMasterRecord)[] = [
  'cpcNumber', 'productId', 'lotNo', 'styleName', 'sizeName', 'designName',
  'groupName', 'purity', 'primaryGroupId', 'designId', 'sizeId', 'sellByPiece',
];

const byCpc = new Map<string, CpcMasterRecord>();
const byProductId = new Map<string, CpcMasterRecord[]>();
let loadedFromDisk = false;
let learnedCount = 0;

function indexRecord(record: CpcMasterRecord) {
  byCpc.set(record.cpcNumber, record);
  const siblings = byProductId.get(record.productId);
  if (siblings) siblings.push(record);
  else byProductId.set(record.productId, [record]);
}

function loadMasterFromDisk() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  let raw: string;
  try {
    raw = fs.readFileSync(CSV_PATH, 'utf8');
  } catch (err: any) {
    console.warn(`CPC master data not loaded (${CSV_PATH}): ${err?.message || err} - CPC auto-fill will be unavailable until this file is present.`);
    return;
  }
  // Plain split is safe here (not a general CSV parser) - verified none of
  // the source columns contain commas, quotes, or newlines before shipping
  // this file, so no quoting/escaping logic is needed.
  const lines = raw.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split(',');
    if (cols.length < CSV_COLUMNS.length) continue;
    const record = {} as CpcMasterRecord;
    CSV_COLUMNS.forEach((key, idx) => { record[key] = cols[idx]; });
    indexRecord(record);
  }
  console.log(`CPC master data loaded: ${byCpc.size} CPC numbers across ${byProductId.size} products.`);
}

// Derives the ProductId portion of a CPC number by splitting on the first
// "L" - the same rule the store's own POS system uses to build a CPC
// number, so this works even for a CPC that isn't in the master file at
// all (a brand-new product, or the master file simply being out of date).
export function deriveProductIdFromCpc(cpcNumberRaw: string): string | null {
  const match = /^(\d+)L\d+$/i.exec(cpcNumberRaw.trim().toUpperCase());
  return match ? match[1] : null;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  let best = values[0] || '';
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

export interface CpcLookupResult {
  // 'exact': this literal CPC number is in the master file.
  // 'product-sibling': this exact CPC isn't known, but its ProductId
  //   prefix matches other lots of a known product - style/metal/purity
  //   are near-certainly right, size is a best guess (the one field that
  //   can genuinely differ per lot) and should be treated as a suggestion.
  // 'none': nothing usable found.
  matchType: 'exact' | 'product-sibling' | 'none';
  record: CpcMasterRecord | null;
  productId: string | null;
}

export function lookupCpc(cpcNumberRaw: string): CpcLookupResult {
  const cpcNumber = cpcNumberRaw.trim().toUpperCase();

  const exact = byCpc.get(cpcNumber);
  if (exact) return { matchType: 'exact', record: exact, productId: exact.productId };

  const productId = deriveProductIdFromCpc(cpcNumber);
  if (productId) {
    const siblings = byProductId.get(productId);
    if (siblings && siblings.length > 0) {
      const base = siblings[0];
      return {
        matchType: 'product-sibling',
        record: { ...base, cpcNumber, lotNo: '', sizeName: mostCommon(siblings.map((s) => s.sizeName)) },
        productId,
      };
    }
  }
  return { matchType: 'none', record: null, productId };
}

// Adds a staff-entered product for a CPC that wasn't found above, so this
// SAME server process recognizes it immediately afterward (e.g. a second
// lot of the same new design scanned later the same shift).
//
// IMPORTANT: in-memory only, does NOT survive a restart/redeploy. This
// hosting setup runs on ephemeral containers (see the ADMIN_PASSWORD
// comment in server.ts for the same constraint) - there's no local file
// this could safely persist to, since a local write would just silently
// vanish on the next deploy. Every learned entry is also logged via
// logEvent('cpc.learned', ...) in server.ts so nothing is actually lost -
// it's recoverable from Axiom and mergeable into data/cpc-master.csv for
// the next deploy. Real durable persistence (most likely a Google
// Drive-backed overlay file, reusing the existing service account) is a
// deliberate follow-up, not built here without confirming the approach.
export function addLearnedCpc(record: CpcMasterRecord) {
  indexRecord({ ...record, cpcNumber: record.cpcNumber.trim().toUpperCase() });
  learnedCount++;
}

export function getCpcMasterStats() {
  return { totalCpcNumbers: byCpc.size, totalProducts: byProductId.size, learnedThisSession: learnedCount };
}

// Loaded once, eagerly, at process startup (like DEFAULT_ENHANCE_PROMPT and
// the other startup-time config in server.ts) rather than on first lookup -
// so a missing/broken data file is discovered and logged immediately on
// boot instead of silently surfacing as a mysterious "not found" on the
// first CPC someone scans.
loadMasterFromDisk();

// ---------------------------------------------------------------------------
// Small helpers for mapping master-data fields onto this app's existing
// form types (GoldPurity / gender) - only meaningful for GOLD right now.
// ---------------------------------------------------------------------------

export function normalizeGoldPurity(purityRaw: string): '18kt' | '22kt' | '24kt' | null {
  const match = /(\d+)\s*ct/i.exec(purityRaw.trim());
  if (!match) return null;
  const n = match[1];
  return n === '18' || n === '22' || n === '24' ? (`${n}kt` as '18kt' | '22kt' | '24kt') : null;
}

// A best-effort guess only - many style names are gender-neutral (chains,
// bangles, etc.), in which case this returns null and the existing default
// ('unisex') stands, same as if no CPC lookup had happened at all.
export function guessGenderFromStyleName(styleName: string): "men's" | "women's" | "kids'" | null {
  const upper = styleName.toUpperCase();
  if (/\bGENTS\b|\bMENS\b/.test(upper)) return "men's";
  if (/\bLADIES\b|\bLADIS\b/.test(upper)) return "women's";
  if (/\bBACCHA\b|\bBABY\b|\bKIDS\b/.test(upper)) return "kids'";
  return null;
}
