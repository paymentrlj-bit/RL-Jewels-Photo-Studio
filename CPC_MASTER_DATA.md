# CPC Master Data Lookup

When staff scan or type a CPC (Counter Product Code), the app recognizes it
against the store's own product catalog and auto-fills product name, item
type, size, purity, and a gender guess - instead of relying only on
OCR-guessing a physical tag's printed text.

## How a CPC number is structured

The store's own POS/inventory system builds every CPC number the same way:

```
<ProductId><BranchSeparator "L"><LotNo>
```

Example: `1265L1051` = ProductId `1265`, LotNo `1051`. `cpcMaster.ts`'s
`deriveProductIdFromCpc()` derives the ProductId from any CPC by splitting
on the first `L` - this works even for a CPC that isn't in the master data
at all, since it's just string structure, not a database lookup.

## Where the data comes from, and why it's 3,352 rows, not 82,891

The store's real POS export was 82,891 rows - one row per physical lot,
across every metal (GOLD, SILVER, DIAMOND, ONE GRAM, BY PCS, STONES).
Verified against the full export before shipping anything:

- Every CPC number in that export is unique (no duplicates).
- For 3,246 of 3,247 distinct ProductIds, style name / metal / purity are
  **identical across every lot** of that product - the only field that
  legitimately produces more than one distinct row per product is
  `sizeName` (46 of 3,247 products come in more than one size), and, in
  exactly one exceptional product (ProductId 26, "SARDAR KADA"),
  `designName` too.

Since most of those 82,891 rows were pure duplicates of each other in
every field except the lot-specific CPC number itself, `data/cpc-master.csv`
is **deduplicated**: one row per distinct (`productId`, `styleName`,
`sizeName`, `designName`, `groupName`, `purity`, `sellByPiece`) combination,
not one row per physical lot - 3,352 rows, a 96% reduction. Each row keeps
one real representative `cpcNumber` from that group, plus a `lotCount`
column recording how many original physical lots collapsed into it.

This is why a CPC lookup has two possible positive outcomes:

- **`exact`** - this literal CPC is one of the 3,352 kept rows. Full
  confidence, including size.
- **`product-sibling`** - this exact CPC isn't one of the kept rows, but
  its ProductId prefix matches other rows of a known product.
  Style/metal/purity are near-certainly right; size is a best guess -
  the size with the highest total `lotCount` among that product's rows
  (weighted by real original inventory count, not just "how many
  deduplicated rows exist") - and should be treated as a suggestion, not
  a fact. In practice this is the outcome for most real CPCs now, since
  only one representative CPC per group keeps `exact` status - the
  auto-filled values are identical to what `exact` would have given for
  the 3,201 single-size products (98.6% of the total), and only genuinely
  a best guess for the 46 multi-size ones.

### Cleanup applied before deduplicating

- `StyleName`: trimmed, and trailing period(s) removed (source data had
  inconsistent entries like `"ANGUTHI LADIES."` and `"CHAIN PADAK.."`
  alongside the same name written cleanly elsewhere).
- `StyleName` / `Purity`: the literal string `"NULL"` (used by the source
  system as a placeholder, mostly on DIAMOND/BY PCS/STONES rows) converted
  to an actual empty value.
- Dropped entirely as not useful to this app: `BranchSeparator` (always
  `"L"`, redundant once encoded in `cpcNumber` itself), `LotNo` (same -
  the exact lot a kept row's `cpcNumber` came from isn't meaningful once
  multiple lots are merged into it), and the three internal POS numeric
  foreign keys `PrimaryGroupID`/`DesignId`/`SizeId` (each is just an
  opaque ID pointing at `groupName`/`designName`/`sizeName`, which are
  already stored as the human-readable values).

## Feature scope: GOLD only, for now

The master data covers every metal, but auto-fill only *acts* on a match
whose `groupName` is `GOLD` right now (`ProductForm.tsx` and the
`/api/cpc-lookup` route both gate on this) - per current product priority.
The data and lookup logic are metal-agnostic already, so turning this on
for SILVER/DIAMOND/etc. later is a small, contained change, not a rebuild.

## Durable storage: a Google Sheet

The full 3,352-row dataset, and every CPC staff enter afterward, lives in a
Google Sheet ("RL Jewels CPC Master Data") - directly browsable and
editable by a human, not a JSON blob or database only the app can read.

**How it works** (`cpcSheet.ts` + `cpcMaster.ts`):

1. On startup, `initCpcMaster()` looks for that Sheet in the same shared
   Drive folder already used for photo export (reuses the existing
   `GOOGLE_DRIVE_*` credentials from `DRIVE_SETUP.md` - no new setup
   needed if Drive export is already configured).
2. **First run ever**: the Sheet doesn't exist yet, so it's created and
   seeded with all 3,352 rows from the bundled `data/cpc-master.csv` (in
   chunks, to stay well under any single-request size limit). From then on
   the Sheet - not the CSV - is what every server instance reads.
3. **Every run after that**: the existing Sheet is read in full into
   memory (one request), which is what actually serves lookups - fast,
   no per-scan network round trip. This also means a CPC learned by ANY
   server instance shows up for every other instance the next time it
   restarts, since they all read the same Sheet.
4. **A new CPC staff enters** (`POST /api/cpc-lookup/learn`) is indexed in
   memory immediately (so this same server recognizes it right away if
   scanned again later that shift) and appended to the Sheet as a new row
   in the background - not awaited, so a staff member's submission is
   never held up by the round trip.

**If `GOOGLE_DRIVE_*` isn't configured, or the Sheet is unreachable at
startup for any reason**, this fails open to the bundled
`data/cpc-master.csv` alone - the app still works with the original 3,352
rows, newly-learned CPCs just won't survive a restart until the Sheet
becomes reachable again. A warning is logged either way. Every learned CPC
is also logged via `logEvent('cpc.learned', ...)` regardless, as a
secondary audit trail if a Sheet append is ever lost.

**Known limitation:** appends aren't perfectly atomic across two
*different* server instances writing at the exact same moment (a rare
edge case at this app's scale) - Sheets' own "insert after last row"
append semantics handle this reasonably well in practice, but it isn't a
hard guarantee. Not worth a more complex locking mechanism unless this is
actually observed happening.

## Updating the master data from a fresh POS export

If the store re-exports its product list later (new products added,
existing ones corrected), regenerate `data/cpc-master.csv`:

1. Export to the same 13-column format (`ProductId, BranchSeparator, LotNo,
   CPCNumber, StyleName, SizeName, DesignName, GroupName, Purity,
   PrimaryGroupID, DesignId, SizeId, SellByPiece`).
2. Re-run the same cleanup (trim + trailing-period strip on `StyleName`,
   `"NULL"` string → empty on `StyleName`/`Purity`), then deduplicate: group
   by (`ProductId`, `StyleName`, `SizeName`, `DesignName`, `GroupName`,
   `Purity`, `SellByPiece`), keep one representative `CPCNumber` per group
   plus a `lotCount` of how many original rows collapsed into it.
3. Replace `data/cpc-master.csv`. **This does not automatically update the
   live Google Sheet** - the Sheet, once created, is the source of truth
   and the CSV is only ever read again if the Sheet is unreachable. Either
   update the Sheet directly (it's just rows in a spreadsheet), or delete
   it from Drive so the next deploy re-creates and re-seeds it from the
   new CSV (this would lose any CPCs learned since the Sheet was created,
   unless copied over first).

## Other fields derivable from this data (not yet wired into the UI)

Beyond the core name/size/metal/purity auto-fill:

- **`designName`** (e.g. `"130-5"`) - the store's own design/mold code.
  Two different CPCs sharing a `designName` are the same design, possibly
  at a different size - useful for "products that look like this"
  grouping or catching duplicate photo shoots of the same design.
- **`sellByPiece`** - flags items priced as a fixed unit rather than by
  weight. Relevant if the app ever needs to treat weight-based and
  piece-based pricing differently.
- **`lotCount`** - how many original physical lots a row represents.
  Beyond its current use weighting the `product-sibling` size guess, this
  is a rough proxy for how common/standard a given product+size
  combination is in the store's actual inventory history.
- **Gender guess from `styleName` keywords** (`guessGenderFromStyleName()`
  in `cpcMaster.ts`) - already wired into gold auto-fill as a
  best-effort default, staff can always override it.
