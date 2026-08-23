// CPC (Counter Product Code) master lookup - lets the app recognize a CPC
// number the moment it's scanned or typed and instantly know its product
// name, size, metal, and purity, instead of relying on OCR-guessing a
// physical tag's printed text.
//
// Source: a one-time export from the store's own POS/inventory system
// (82,891 rows across every metal - GOLD, SILVER, DIAMOND, ONE GRAM,
// BY PCS, STONES). That system builds every CPC number the same way:
// <ProductId><BranchSeparator "L"><LotNo>, e.g. "1265L1051" = ProductId
// 1265, LotNo 1051.
//
// ProductId is the ONLY part of a CPC number this module ever uses. The
// LotNo carries no independent information (see the dataset note below:
// for 3,246 of 3,247 products, every lot of the same ProductId shares
// identical style/metal/purity, and even size is the same for the vast
// majority), so the CPC number itself is not stored anywhere - only its
// ProductId is. deriveProductIdFromCpc() extracts it by splitting on the
// first "L", which works even for a CPC that isn't in the master data at
// all (a brand-new product, or the data simply being out of date).
//
// data/cpc-master.csv is NOT the raw 82,891-row export - it's
// deduplicated down to 3,352 rows: one row per distinct (ProductId,
// styleName, sizeName, designName, groupName, purity, sellByPiece)
// combination, not one row per physical lot. Verified against the real
// export that style/metal/purity are consistent across every lot of the
// same ProductId in all but one case out of 3,247 products - the only
// field that legitimately produces more than one row per product is
// sizeName (46 of 3,247 products come in more than one size) and, in that
// one exceptional product, designName. `lotCount` on each row records how
// many original physical lots collapsed into it - used to weight the
// "most likely size" guess (see lookupCpc()) by actual original inventory
// count, not just by how many distinct rows happen to exist.
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
import { ensureCpcSheet, readAllRows, seedSheet, appendRow, findSingleRowIndexByProductId, updateRow } from './cpcSheet';

export interface CpcMasterRecord {
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
  'productId', 'styleName', 'sizeName', 'designName',
  'groupName', 'purity', 'sellByPiece', 'lotCount',
];

const byProductId = new Map<string, CpcMasterRecord[]>();
let loadedFromDisk = false;
let sourceInitialized = false;
let learnedThisSession = 0;
let totalRecordCount = 0;

function indexRecord(record: CpcMasterRecord) {
  const siblings = byProductId.get(record.productId);
  if (siblings) siblings.push(record);
  else byProductId.set(record.productId, [record]);
  totalRecordCount++;
}

function rowToRecord(cols: string[]): CpcMasterRecord | null {
  if (cols.length < CSV_COLUMNS.length) return null;
  const record = {} as CpcMasterRecord;
  CSV_COLUMNS.forEach((key, idx) => { record[key] = cols[idx] ?? ''; });
  if (!record.productId) return null;
  return record;
}

function recordToRow(record: CpcMasterRecord): string[] {
  return CSV_COLUMNS.map((key) => record[key] ?? '');
}

// True if two records describe the same product+variant (everything
// except lotCount, which is a count, not an identifying field). Used to
// avoid adding a duplicate row for a combination we already have.
function sameVariant(a: CpcMasterRecord, b: CpcMasterRecord): boolean {
  return (
    a.productId === b.productId &&
    a.styleName === b.styleName &&
    a.sizeName === b.sizeName &&
    a.designName === b.designName &&
    a.groupName === b.groupName &&
    a.purity === b.purity &&
    a.sellByPiece === b.sellByPiece
  );
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
  console.log(`CPC master data loaded from bundled CSV: ${totalRecordCount} rows across ${byProductId.size} products.`);
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
      console.log(`CPC master Sheet created and seeded: ${totalRecordCount} rows across ${byProductId.size} products.`);
    } else {
      const rows = await readAllRows(spreadsheetId);
      for (let i = 1; i < rows.length; i++) {
        const record = rowToRecord(rows[i]);
        if (record) indexRecord(record);
      }
      console.log(`CPC master data loaded from Sheet: ${totalRecordCount} rows across ${byProductId.size} products.`);
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
  // 'certain': this ProductId only has ONE distinct row in our data - no
  //   ambiguity at all, whatever we return is definitely right (style,
  //   metal, purity, AND size).
  // 'guess': this ProductId has MULTIPLE distinct rows (a genuine
  //   multi-size/multi-design product) - style/metal/purity are still
  //   near-certain (verified consistent across all but 1 of 3,247
  //   products), but sizeName is a best guess weighted by real lot counts
  //   and should be treated as a suggestion, not a fact.
  // 'none': this ProductId isn't in our data at all.
  matchType: 'certain' | 'guess' | 'none';
  cpcNumber: string; // the (normalized) CPC that was looked up - not stored data, just an echo of the input
  productId: string | null;
  record: CpcMasterRecord | null;
}

// Looks up purely by ProductId - the LotNo portion of a CPC number is
// deliberately never used for matching (see the file header comment for
// why). Certainty comes from how many distinct rows exist for that
// ProductId, not from whether this literal CPC string happens to match
// one we've seen before.
export function lookupCpc(cpcNumberRaw: string): CpcLookupResult {
  const cpcNumber = cpcNumberRaw.trim().toUpperCase();
  const productId = deriveProductIdFromCpc(cpcNumber);
  if (!productId) return { matchType: 'none', cpcNumber, productId: null, record: null };

  const rows = byProductId.get(productId);
  if (!rows || rows.length === 0) return { matchType: 'none', cpcNumber, productId, record: null };

  if (rows.length === 1) {
    return { matchType: 'certain', cpcNumber, productId, record: rows[0] };
  }
  return {
    matchType: 'guess',
    cpcNumber,
    productId,
    record: { ...rows[0], sizeName: mostCommonSizeBylotCount(rows), lotCount: '' },
  };
}

// Adds a staff-entered product for a ProductId that wasn't found above (or
// a genuinely new variant of a 'guess' product) - indexes it in memory
// immediately (so this same server recognizes it right away if scanned
// again later the same shift) and appends it as a new row to the Sheet in
// the background (not awaited by callers, so a staff member's submission
// is never held up by the round trip) so it survives a restart/redeploy
// too. A save failure here is logged but not thrown - logEvent
// ('cpc.learned', ...) in server.ts is the audit-trail backstop if an
// append is ever lost. No-ops (does not add a duplicate row) if an
// identical variant already exists for this ProductId.
export function addLearnedCpc(record: CpcMasterRecord) {
  const normalized: CpcMasterRecord = { ...record, lotCount: record.lotCount || '1' };
  const existing = byProductId.get(normalized.productId) || [];
  if (existing.some((r) => sameVariant(r, normalized))) return;

  indexRecord(normalized);
  learnedThisSession++;
  ensureCpcSheet()
    .then(({ spreadsheetId }) => appendRow(spreadsheetId, recordToRow(normalized)))
    .catch((err) => {
      console.warn('CPC append to Sheet failed (this entry may not survive a restart until it can be re-entered):', err?.message || err);
    });
}

// Saves a staff correction to a product that WAS a 'certain' (single-row,
// unambiguous) match - i.e. the correction is a genuine fix to data we
// already had, not a new variant. Updates that one row in place (found by
// a live search, not cached bookkeeping - see cpcSheet.ts's
// findSingleRowIndexByProductId) rather than appending, so the product
// stays unambiguous ('certain') afterward instead of accidentally
// becoming a 'guess' with two near-duplicate rows. If the row can't be
// found unambiguously (e.g. it's no longer single - already handled by a
// concurrent change), falls back to appending instead.
//
// The in-memory fix always applies immediately, even if the Sheet side
// fails or Drive isn't configured at all - same fail-open pattern as
// addLearnedCpc(), so a Drive hiccup never means "the correction didn't
// happen," only "it might not survive a restart yet."
export async function correctSingleRowProduct(record: CpcMasterRecord): Promise<void> {
  const normalized: CpcMasterRecord = { ...record, lotCount: record.lotCount || '1' };

  const existing = byProductId.get(normalized.productId);
  if (existing && existing.length === 1) {
    existing[0] = normalized; // update the in-memory copy immediately
  } else {
    byProductId.set(normalized.productId, [normalized]);
    totalRecordCount++;
  }

  try {
    const { spreadsheetId } = await ensureCpcSheet();
    const rowIndex = await findSingleRowIndexByProductId(spreadsheetId, normalized.productId);
    if (rowIndex) {
      await updateRow(spreadsheetId, rowIndex, recordToRow(normalized));
    } else {
      await appendRow(spreadsheetId, recordToRow(normalized));
    }
  } catch (err: any) {
    console.warn('CPC correction save to Sheet failed (applied in memory for now, may not survive a restart until this is fixed):', err?.message || err);
  }
}

export function getCpcMasterStats() {
  return { totalRows: totalRecordCount, totalProducts: byProductId.size, learnedThisSession };
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
