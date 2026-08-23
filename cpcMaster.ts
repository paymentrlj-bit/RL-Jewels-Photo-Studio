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
import { loadCpcOverlayFromDrive, saveCpcOverlayToDrive } from './driveExport';

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
// Full list of every learned CPC (whether restored from the Drive overlay
// at startup or added during this process's own runtime) - this is what
// gets re-uploaded wholesale on every save, see persistLearnedToDrive().
const learnedRecords: CpcMasterRecord[] = [];
let overlayLoadedFromDrive = false;

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

// Serializes writes to the Drive overlay file so two nearly-simultaneous
// addLearnedCpc() calls don't race and clobber each other - each save
// waits for the previous one to finish (success or failure) before
// re-uploading the now-current full learnedRecords list. Only guards
// against races within this one process; two different server instances
// writing at once is a much rarer edge case for this deployment's scale
// and isn't handled here.
let writeQueue: Promise<void> = Promise.resolve();

function persistLearnedToDrive() {
  writeQueue = writeQueue
    .then(() => saveCpcOverlayToDrive(learnedRecords))
    .catch((err) => {
      console.warn('CPC overlay save to Drive failed (this CPC may not survive a restart until the next successful save):', err?.message || err);
    });
}

// Adds a staff-entered product for a CPC that wasn't found above, so this
// SAME server process recognizes it immediately afterward (e.g. a second
// lot of the same new design scanned later the same shift), and persists
// it to the Drive overlay so it also survives a restart/redeploy. The
// Drive save happens in the background (not awaited by callers) so a
// staff member's submission is never held up by it - see
// persistLearnedToDrive() above for how failures are handled, and
// logEvent('cpc.learned', ...) in server.ts for the audit-trail backstop
// if a save is ever lost.
export function addLearnedCpc(record: CpcMasterRecord) {
  const normalized = { ...record, cpcNumber: record.cpcNumber.trim().toUpperCase() };
  indexRecord(normalized);
  learnedRecords.push(normalized);
  persistLearnedToDrive();
}

function isValidCpcMasterRecord(x: unknown): x is CpcMasterRecord {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.cpcNumber === 'string' && r.cpcNumber.trim().length > 0 && typeof r.groupName === 'string';
}

// Restores CPCs learned in a previous run of this server from the Drive
// overlay file, so a restart/redeploy doesn't lose them. Called once from
// server.ts before it starts accepting requests - awaited (with a
// reasonable ceiling implicit in the Drive client's own timeouts) so the
// very first lookups after a deploy already have this data, rather than a
// race where early requests miss it.
export async function initCpcOverlayFromDrive(): Promise<void> {
  if (overlayLoadedFromDrive) return;
  overlayLoadedFromDrive = true;
  const rawRecords = await loadCpcOverlayFromDrive();
  let restored = 0;
  for (const raw of rawRecords) {
    if (!isValidCpcMasterRecord(raw)) continue;
    const normalized: CpcMasterRecord = {
      cpcNumber: raw.cpcNumber.trim().toUpperCase(),
      productId: raw.productId || '',
      lotNo: raw.lotNo || '',
      styleName: raw.styleName || '',
      sizeName: raw.sizeName || '',
      designName: raw.designName || '',
      groupName: raw.groupName || '',
      purity: raw.purity || '',
      primaryGroupId: raw.primaryGroupId || '',
      designId: raw.designId || '',
      sizeId: raw.sizeId || '',
      sellByPiece: raw.sellByPiece || '0',
    };
    // Never override a static-file entry - the overlay should only ever
    // contain CPCs that were unknown to the static file at the time they
    // were learned, but this keeps a stale/manually-edited overlay from
    // being able to shadow real catalog data either way.
    if (byCpc.has(normalized.cpcNumber)) continue;
    indexRecord(normalized);
    learnedRecords.push(normalized);
    restored++;
  }
  if (restored > 0) {
    console.log(`CPC overlay restored from Drive: ${restored} previously-learned CPC numbers.`);
  }
}

export function getCpcMasterStats() {
  return { totalCpcNumbers: byCpc.size, totalProducts: byProductId.size, learnedThisSession: learnedRecords.length };
}

// Loaded once, eagerly, at process startup (like DEFAULT_ENHANCE_PROMPT and
// the other startup-time config in server.ts) rather than on first lookup -
// so a missing/broken data file is discovered and logged immediately on
// boot instead of silently surfacing as a mysterious "not found" on the
// first CPC someone scans. The Drive overlay (initCpcOverlayFromDrive) is
// NOT called here - it's async and network-dependent, so server.ts awaits
// it explicitly before listening instead of racing it against startup.
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
