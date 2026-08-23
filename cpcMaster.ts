// CPC (Counter Product Code) master lookup - lets the app recognize a CPC
// number the moment it's scanned or typed and instantly know its product
// name, size, metal, and purity, instead of relying on OCR-guessing a
// physical tag's printed text.
//
// Source: a one-time export from the store's own POS/inventory system
// (82,891 rows across every metal - GOLD, SILVER, DIAMOND, ONE GRAM,
// BY PCS, STONES). That system builds every CPC number the same way:
// <ProductId><BranchSeparator "L"><LotNo>, e.g. "1265L1051" = ProductId
// 1265, LotNo 1051 (see deriveProductIdFromCpc below).
//
// data/cpc-master.csv is NOT that raw 82,891-row export - it's
// deduplicated down to 3,352 rows: one row per distinct (ProductId,
// styleName, sizeName, designName, groupName, purity, sellByPiece)
// combination, not one row per physical lot. Verified against the real
// export that style/metal/purity are consistent across every lot of the
// same ProductId in all but one case out of 3,247 products - the only
// field that legitimately produces more than one row per product is
// sizeName (46 of 3,247 products come in more than one size) and, in that
// one exceptional product, designName. `lotCount` on each row records how
// many original physical lots collapsed into it - used to weight the
// "most common size" guess in the product-sibling match type below by
// actual original inventory count, not just by how many distinct rows
// happen to exist.
//
// Feature scope right now is GOLD only (per current product priority) -
// this module loads and indexes every row regardless of metal so the data
// is ready to use the moment other metals are wanted, but callers (see
// server.ts's /api/cpc-lookup route and ProductForm.tsx) currently only
// act on a match whose groupName is GOLD.
//
// Durable storage: a Google Sheet ("RL Jewels CPC Master Data", see
// cpcSheet.ts) is the source of truth once it exists - both the original
// 3,352-row dataset AND every CPC staff enter afterward for a product
// that wasn't already in it live there, so it's directly browsable/
// editable by a human and survives restarts/redeploys without any of this
// app's own storage. data/cpc-master.csv is the bundled seed data (used to
// populate the Sheet the very first time it's created) and doubles as an
// offline fallback if the Sheet is ever unreachable at startup.

import fs from 'fs';
import path from 'path';
import { ensureCpcSheet, readAllRows, seedSheet, appendRow } from './cpcSheet';

export interface CpcMasterRecord {
  cpcNumber: string;
  productId: string;
  styleName: string;
  sizeName: string;
  designName: string;
  groupName: string;
  purity: string;
  sellByPiece: string;
  lotCount: string;
}

const CSV_PATH = path.join(process.cwd(), 'data', 'cpc-master.csv');
const CSV_COLUMNS: (keyof CpcMasterRecord)[] = [
  'cpcNumber', 'productId', 'styleName', 'sizeName', 'designName',
  'groupName', 'purity', 'sellByPiece', 'lotCount',
];

const byCpc = new Map<string, CpcMasterRecord>();
const byProductId = new Map<string, CpcMasterRecord[]>();
let loadedFromDisk = false;
let sourceInitialized = false;
let learnedThisSession = 0;

function indexRecord(record: CpcMasterRecord) {
  byCpc.set(record.cpcNumber, record);
  const siblings = byProductId.get(record.productId);
  if (siblings) siblings.push(record);
  else byProductId.set(record.productId, [record]);
}

function rowToRecord(cols: string[]): CpcMasterRecord | null {
  if (cols.length < CSV_COLUMNS.length) return null;
  const record = {} as CpcMasterRecord;
  CSV_COLUMNS.forEach((key, idx) => { record[key] = cols[idx] ?? ''; });
  if (!record.cpcNumber) return null;
  return record;
}

function recordToRow(record: CpcMasterRecord): string[] {
  return CSV_COLUMNS.map((key) => record[key] ?? '');
}

function readCsvRows(): { header: string[]; records: CpcMasterRecord[] } {
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  // Plain split is safe here (not a general CSV parser) - verified none of
  // the source columns contain commas, quotes, or newlines before shipping
  // this file, so no quoting/escaping logic is needed. Splits on \r?\n
  // (not just \n) since Python's csv module - used to generate this file -
  // writes \r\n line endings by default; splitting on \n alone would leave
  // a stray \r stuck to the last column (lotCount) of every row.
  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0]?.split(',') || [];
  const records: CpcMasterRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const record = rowToRecord(lines[i].split(','));
    if (record) records.push(record);
  }
  return { header, records };
}

// Fallback path only: loads the bundled CSV directly into memory. Used
// when the Sheet can't be reached at all (Drive not configured, or a
// network/auth failure) - see initCpcMaster() below for the primary path.
function loadMasterFromDisk() {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  let records: CpcMasterRecord[];
  try {
    records = readCsvRows().records;
  } catch (err: any) {
    console.warn(`CPC master data not loaded (${CSV_PATH}): ${err?.message || err} - CPC auto-fill will be unavailable until this file is present.`);
    return;
  }
  for (const record of records) indexRecord(record);
  console.log(`CPC master data loaded from bundled CSV: ${byCpc.size} CPC numbers across ${byProductId.size} products.`);
}

// Primary path: ensures the Google Sheet exists (creating + seeding it
// from the bundled CSV on the very first run), then loads every row from
// it into memory. Falls back to the bundled CSV alone if the Sheet can't
// be reached for any reason (Drive not configured, network error, etc.) -
// called once from server.ts before it starts accepting requests.
export async function initCpcMaster(): Promise<void> {
  if (sourceInitialized) return;
  sourceInitialized = true;
  try {
    const { spreadsheetId, isNew } = await ensureCpcSheet();
    if (isNew) {
      const { header, records } = readCsvRows();
      await seedSheet(spreadsheetId, header, records.map(recordToRow));
      for (const record of records) indexRecord(record);
      console.log(`CPC master Sheet created and seeded: ${byCpc.size} CPC numbers across ${byProductId.size} products.`);
    } else {
      const rows = await readAllRows(spreadsheetId);
      for (let i = 1; i < rows.length; i++) {
        const record = rowToRecord(rows[i]);
        if (record) indexRecord(record);
      }
      console.log(`CPC master data loaded from Sheet: ${byCpc.size} CPC numbers across ${byProductId.size} products.`);
    }
  } catch (err: any) {
    console.warn('CPC master Sheet unavailable (falling back to bundled CSV only, learned CPCs will not persist across restarts until this is fixed):', err?.message || err);
    loadMasterFromDisk();
  }
}

// Derives the ProductId portion of a CPC number by splitting on the first
// "L" - the same rule the store's own POS system uses to build a CPC
// number, so this works even for a CPC that isn't in the master data at
// all (a brand-new product, or the data simply being out of date).
export function deriveProductIdFromCpc(cpcNumberRaw: string): string | null {
  const match = /^(\d+)L\d+$/i.exec(cpcNumberRaw.trim().toUpperCase());
  return match ? match[1] : null;
}

// Weighted by lotCount (how many original physical lots each row
// represents), not by number of distinct rows - a size that covered 40
// original lots should win over one that covered 2, even though after
// deduplication each is just "one row."
function mostCommonSizeBylotCount(records: CpcMasterRecord[]): string {
  const counts = new Map<string, number>();
  for (const r of records) {
    const weight = Number(r.lotCount) || 1;
    counts.set(r.sizeName, (counts.get(r.sizeName) || 0) + weight);
  }
  let best = records[0]?.sizeName || '';
  let bestCount = 0;
  for (const [size, c] of counts) {
    if (c > bestCount) { best = size; bestCount = c; }
  }
  return best;
}

export interface CpcLookupResult {
  // 'exact': this literal CPC number is in the master data.
  // 'product-sibling': this exact CPC isn't known, but its ProductId
  //   prefix matches other rows of a known product - style/metal/purity
  //   are near-certainly right, size is a best guess (the one field that
  //   can genuinely differ per product) weighted by real lot counts, and
  //   should be treated as a suggestion.
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
        record: { ...base, cpcNumber, sizeName: mostCommonSizeBylotCount(siblings), lotCount: '' },
        productId,
      };
    }
  }
  return { matchType: 'none', record: null, productId };
}

// Adds a staff-entered product for a CPC that wasn't found above - indexes
// it in memory immediately (so this same server recognizes it right away
// if scanned again later the same shift) and appends it as a new row to
// the Sheet in the background (not awaited by callers, so a staff
// member's submission is never held up by the round trip) so it survives
// a restart/redeploy too. A save failure here is logged but not thrown -
// logEvent('cpc.learned', ...) in server.ts is the audit-trail backstop if
// an append is ever lost.
export function addLearnedCpc(record: CpcMasterRecord) {
  const normalized: CpcMasterRecord = { ...record, cpcNumber: record.cpcNumber.trim().toUpperCase(), lotCount: record.lotCount || '1' };
  indexRecord(normalized);
  learnedThisSession++;
  ensureCpcSheet()
    .then(({ spreadsheetId }) => appendRow(spreadsheetId, recordToRow(normalized)))
    .catch((err) => {
      console.warn('CPC append to Sheet failed (this CPC may not survive a restart until it can be re-learned):', err?.message || err);
    });
}

export function getCpcMasterStats() {
  return { totalCpcNumbers: byCpc.size, totalProducts: byProductId.size, learnedThisSession };
}

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
