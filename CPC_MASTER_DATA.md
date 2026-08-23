# CPC Master Data Lookup

When staff scan or type a CPC (Counter Product Code), the app now recognizes
it against the store's own product catalog and auto-fills product name,
item type, size, purity, and a gender guess - instead of relying only on
OCR-guessing a physical tag's printed text.

## How a CPC number is structured

The store's own POS/inventory system builds every CPC number the same way:

```
<ProductId><BranchSeparator "L"><LotNo>
```

Example: `1265L1051` = ProductId `1265`, LotNo `1051`. `cpcMaster.ts`'s
`deriveProductIdFromCpc()` derives the ProductId from any CPC by splitting
on the first `L` - this works even for a CPC that isn't in the master file
at all, since it's just string structure, not a database lookup.

## Where the data comes from

`data/cpc-master.csv` is a one-time export from the store's real POS system
(82,891 rows, every metal - GOLD, SILVER, DIAMOND, ONE GRAM, BY PCS,
STONES). Verified against the full export before shipping:

- Every CPC number is unique (no duplicates).
- For 3,246 of 3,247 distinct ProductIds, style name / metal / purity are
  **identical across every lot** of that product - only size legitimately
  varies per lot (a ring style sold in multiple sizes, for example). The
  one exception (ProductId 26, "SARDAR KADA") genuinely has two different
  designs under the same ProductId across its lots.
- This is why a CPC lookup has two possible positive outcomes:
  - **`exact`** - this literal CPC is in the master file. Full confidence,
    including size.
  - **`product-sibling`** - this exact CPC isn't known, but its ProductId
    prefix matches other lots of a known product. Style/metal/purity are
    near-certainly right; size is a best guess (the most common size among
    that product's other lots) and should be treated as a suggestion, not
    a fact.

### Cleanup applied before shipping this file

- `StyleName`: trimmed, and trailing period(s) removed (source data had
  inconsistent entries like `"ANGUTHI LADIES."` and `"CHAIN PADAK.."`
  alongside the same name written cleanly elsewhere).
- `StyleName` / `Purity`: the literal string `"NULL"` (used by the source
  system as a placeholder, mostly on DIAMOND/BY PCS/STONES rows) converted
  to an actual empty value.
- `CPCNumber` is kept exactly as the source system printed it, even for the
  one row (ProductId 458, LotNo 506) where it doesn't cleanly reconstruct
  as `ProductId + L + LotNo` (its `CPCNumber` field literally reads
  `458L6`) - that's what would actually be scanned/typed, so it's what the
  lookup needs to match, not a "corrected" value with no ground truth to
  correct it against.

## Feature scope: GOLD only, for now

The master file covers every metal, but auto-fill only *acts* on a match
whose `groupName` is `GOLD` right now (`ProductForm.tsx` and the
`/api/cpc-lookup` route both gate on this) - per current product priority.
The data and lookup logic are metal-agnostic already, so turning this on
for SILVER/DIAMOND/etc. later is a small, contained change, not a rebuild.

## New CPCs staff enter that aren't in the file

When a CPC comes back `none` and staff finish filling the product in by
hand, `ProductForm.tsx` calls `POST /api/cpc-lookup/learn`, which adds it
to the in-memory lookup (`cpcMaster.ts`'s `addLearnedCpc()`) - so the SAME
running server recognizes it immediately if scanned again later that
shift.

**This does not currently survive a restart or redeploy.** This app runs
on ephemeral hosting (see the `ADMIN_PASSWORD` comment in `server.ts` for
the same constraint elsewhere) - there's no local file a learned CPC could
safely persist to, since a write there would just vanish on the next
deploy. Every learned CPC is also logged via `logEvent('cpc.learned', ...)`
so nothing is actually lost even when the in-memory copy resets - it's
recoverable from Axiom and mergeable into `data/cpc-master.csv` for the
next deploy, but that's a manual step today, not automatic.

**A real fix needs a decision on where the durable copy lives** - the
strongest candidate is reusing the Google Drive service account already
set up for photo export (`driveExport.ts`, see `DRIVE_SETUP.md`) to keep a
small overlay file of newly-learned CPCs, merged with the static file at
lookup time. That wasn't built without confirming this is the right
tradeoff first (it adds a Drive API call to the learn path, and needs the
existing service account granted write access to wherever this file
would live).

## Updating the master file from a fresh POS export

If the store re-exports its product list later (new products added,
existing ones corrected):

1. Export to the same 13-column format (`ProductId, BranchSeparator, LotNo,
   CPCNumber, StyleName, SizeName, DesignName, GroupName, Purity,
   PrimaryGroupID, DesignId, SizeId, SellByPiece`).
2. Re-run the same cleanup (trim + trailing-period strip on `StyleName`,
   `"NULL"` string → empty on `StyleName`/`Purity`) and re-derive the 12
   `data/cpc-master.csv` columns (`BranchSeparator` is dropped - always
   `"L"` in the current export, redundant once it's encoded in
   `cpcNumber` itself).
3. Replace `data/cpc-master.csv` and redeploy. Any CPCs learned in-memory
   since the last deploy and not yet merged in will need re-entering once
   (see the persistence note above).

## Other fields derivable from this data (not yet wired into the UI)

Beyond the core name/size/metal/purity auto-fill, the same CSV has enough
structure to support later:

- **`designName`** (e.g. `"130-5"`) and **`designId`** - the store's own
  design/mold code. Two different CPCs sharing a `designId` are visually
  the same design possibly at a different size or lot - useful for
  "products that look like this" grouping or catching duplicate photo
  shoots of the same design.
- **`sellByPiece`** - flags items priced as a fixed unit rather than by
  weight (2,534 of 82,891 rows). Relevant if the app ever needs to treat
  weight-based and piece-based pricing differently.
- **Gender guess from `styleName` keywords** (`guessGenderFromStyleName()`
  in `cpcMaster.ts`) - already wired into gold auto-fill as a
  best-effort default, staff can always override it.
