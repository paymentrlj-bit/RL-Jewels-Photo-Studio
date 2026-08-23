# CPC Master Data Lookup

When staff scan or type a CPC (Counter Product Code), the app recognizes it
against the store's own product catalog and auto-fills product name, item
type, size, purity, and a gender guess - instead of relying on OCR to read
any of that off the physical tag.

## How a CPC number is structured, and what actually gets used

The store's own POS/inventory system builds every CPC number the same way:

```
<ProductId><BranchSeparator "L"><LotNo>
```

Example: `1265L1051` = ProductId `1265`, LotNo `1051`.

**Only the ProductId is ever used - the CPC number itself isn't stored
anywhere.** `cpcMaster.ts`'s `deriveProductIdFromCpc()` extracts it by
splitting on the first `L`, which works even for a CPC that isn't in the
master data at all. The LotNo is discarded immediately: every lot of the
same ProductId shares identical style/metal/purity in all but one case out
of 3,247 products (see below), so it carries no information a lookup needs.
This is also why `data/cpc-master.csv` and the Google Sheet have no
`cpcNumber` column at all - `productId` is the whole key.

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

`data/cpc-master.csv` is **deduplicated**: one row per distinct
(`productId`, `styleName`, `sizeName`, `designName`, `groupName`, `purity`,
`sellByPiece`) combination, not one row per physical lot - 3,352 rows, a
96% reduction. Each row carries a `lotCount` column recording how many
original physical lots collapsed into it.

A lookup has three possible outcomes, and which one you get depends on how
many distinct rows exist for that ProductId:

- **`certain`** - this ProductId has exactly ONE distinct row in our data
  (true for 3,201 of 3,247 products, 98.6%). No ambiguity at all - style,
  metal, purity, AND size are all definitely right, regardless of which
  specific lot number was scanned.
- **`guess`** - this ProductId has MORE THAN ONE distinct row (a genuine
  multi-size or, in one case, multi-design product - 46 of 3,247).
  Style/metal/purity are still near-certain; size is a best guess - the
  size with the highest total `lotCount` among that product's rows
  (weighted by real original inventory count, not just "how many
  deduplicated rows exist") - and should be treated as a suggestion, not
  a fact.
- **`none`** - this ProductId isn't in our data at all.

### Cleanup applied before deduplicating

- `StyleName`: trimmed, and trailing period(s) removed (source data had
  inconsistent entries like `"ANGUTHI LADIES."` and `"CHAIN PADAK.."`
  alongside the same name written cleanly elsewhere).
- `StyleName` / `Purity`: the literal string `"NULL"` (used by the source
  system as a placeholder, mostly on DIAMOND/BY PCS/STONES rows) converted
  to an actual empty value.
- Dropped entirely as not useful to this app: `CPCNumber`/`BranchSeparator`/
  `LotNo` (see above - only ProductId matters, so none of these need
  storing), and the three internal POS numeric foreign keys
  `PrimaryGroupID`/`DesignId`/`SizeId` (each is just an opaque ID pointing
  at `groupName`/`designName`/`sizeName`, which are already stored as the
  human-readable values).

## Feature scope: GOLD only, for now

The master data covers every metal, but auto-fill only *acts* on a match
whose `groupName` is `GOLD` right now (`ProductForm.tsx` and the
`/api/cpc-lookup` route both gate on this) - per current product priority.
The data and lookup logic are metal-agnostic already, so turning this on
for SILVER/DIAMOND/etc. later is a small, contained change, not a rebuild.

## Durable storage: a Google Sheet

The full 3,352-row dataset, and every CPC-driven change staff make
afterward, lives in a Google Sheet ("RL Jewels CPC Master Data") - directly
browsable and editable by a human, not a JSON blob or database only the app
can read.

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
   no per-scan network round trip.
4. **A brand-new ProductId, or a genuinely new variant (size) of an
   existing multi-size product** (`POST /api/cpc-lookup/learn`) is indexed
   in memory immediately and appended to the Sheet as a new row in the
   background - not awaited, so a staff member's submission is never held
   up by the round trip. A no-op if an identical variant is already known
   (avoids duplicate rows).
5. **A correction to a `certain` (single-row) product's data**
   (`POST /api/cpc-lookup/correct`) updates that one row in place instead
   of appending - found by a live search of the Sheet's ProductId column,
   not cached bookkeeping, so it's correct even if the Sheet was edited
   directly by a human in between. Keeps the product `certain` afterward
   instead of accidentally turning it into a `guess` with two
   near-duplicate rows.

**If `GOOGLE_DRIVE_*` isn't configured, or the Sheet is unreachable**, both
paths fail open: the in-memory fix/addition still applies immediately (so
the app is fully usable for the rest of that server's uptime), it just
won't survive a restart until the Sheet becomes reachable again. A warning
is logged either way, and both `cpc.learned` and `cpc.corrected` events are
logged via `logEvent(...)` regardless, as a secondary audit trail if a
Sheet write is ever lost.

**Known limitation:** writes aren't perfectly atomic across two *different*
server instances writing at the exact same moment (a rare edge case at this
app's scale) - not worth a more complex locking mechanism unless this is
actually observed happening.

## The staff-facing correction flow

When a CPC comes back `certain` or `guess` and auto-fills name/purity/size,
but staff then change one of those values before submitting,
`ProductForm.tsx` shows a simple "Please Double-Check" popup listing the
final name/purity/size and asking staff to confirm before continuing - no
mention of rows, Sheets, or databases, just "make sure this is right."

- **Confirming a change to a `certain` match** → `/api/cpc-lookup/correct`
  (fixes the existing row for good).
- **Confirming a change to a `guess` match** → `/api/cpc-lookup/learn`
  (adds it as a new, genuinely distinct size/variant, since a multi-size
  product having another size isn't a "correction").
- **No change at all** → no popup, nothing to save, submission proceeds
  immediately.

## Getting the CPC without OCR

`BarcodeScannerModal.tsx`'s Side 1 (front label) now ONLY does on-device
QR/barcode detection (`jsQR` / the browser's native `BarcodeDetector`) -
it never calls the OCR endpoint. Once it has a CPC, everything else
(name/purity/size) comes from the lookup above, so there's nothing left
for OCR to usefully extract on that side. If no QR/barcode can be found on
Side 1, staff are told to try again or type the CPC in manually - there's
no OCR fallback. Side 2 (the back label) is unchanged and still runs real
OCR, since gross/other weight can only come from reading the printed
numbers.

## Updating the master data from a fresh POS export

If the store re-exports its product list later (new products added,
existing ones corrected), regenerate `data/cpc-master.csv`:

1. Export to the store's standard 13-column format (`ProductId,
   BranchSeparator, LotNo, CPCNumber, StyleName, SizeName, DesignName,
   GroupName, Purity, PrimaryGroupID, DesignId, SizeId, SellByPiece`).
2. Re-run the same cleanup (trim + trailing-period strip on `StyleName`,
   `"NULL"` string → empty on `StyleName`/`Purity`), then deduplicate: group
   by (`ProductId`, `StyleName`, `SizeName`, `DesignName`, `GroupName`,
   `Purity`, `SellByPiece`), keep one row per group with a `lotCount` of
   how many original rows collapsed into it. Drop `CPCNumber`,
   `BranchSeparator`, `LotNo`, `PrimaryGroupID`, `DesignId`, `SizeId`
   entirely - not stored.
3. Replace `data/cpc-master.csv`. **This does not automatically update the
   live Google Sheet** - the Sheet, once created, is the source of truth
   and the CSV is only ever read again if the Sheet is unreachable. Either
   update the Sheet directly (it's just rows in a spreadsheet), or delete
   it from Drive so the next deploy re-creates and re-seeds it from the
   new CSV (this would lose any variants/corrections made since the Sheet
   was created, unless copied over first).

## Two further efficiencies built on top of the lookup

Both of these only exist *because* the CPC master lookup already tells the
app, with certainty, what a product is - neither would make sense without
it, which is why they can look similar at a glance despite doing different
things:

- **Auto-advance on QR detection** applies to *every* scan, at the Side 1
  step itself. Previously, once Side 1's QR was read, staff still had to
  tap "Flip Tag to Scan Side 2" before the camera moved on. Now
  `BarcodeScannerModal.tsx` auto-advances to Side 2 about 700ms after a
  successful Side 1 read (just long enough to see the green "Captured"
  flash) - one fewer tap per product, always. A pending auto-advance is
  cancelled if staff rescans or manually flips before it fires.
- **Skip Side 1 entirely for known single-size (`certain`) products**
  applies only when the CPC was *already* resolved before the scanner was
  even opened - typed manually into the CPC field (which triggers a lookup
  on blur) or left over from an earlier scan this session. If that lookup
  came back `certain`, there is nothing left for a Side 1 QR scan to tell
  the app, so `ProductForm.tsx` hands the scanner a `knownSide1Data` prop
  and the modal opens straight on Side 2 (weights) - staff never point the
  camera at the front label at all for that product. A `guess` match still
  opens on Side 1 as normal, since scanning the actual tag is how a
  multi-size product's specific size gets confirmed.

In short: auto-advance shaves a tap off the QR step every time; skip-Side-1
removes the entire QR step, but only when the product's specs are already
known beyond doubt.

## Other fields derivable from this data (not yet wired into the UI)

Beyond the core name/size/metal/purity auto-fill:

- **`designName`** (e.g. `"130-5"`) - the store's own design/mold code.
  Two different products sharing a `designName` are the same design,
  possibly at a different size - useful for "products that look like
  this" grouping or catching duplicate photo shoots of the same design.
- **`sellByPiece`** - flags items priced as a fixed unit rather than by
  weight. Relevant if the app ever needs to treat weight-based and
  piece-based pricing differently.
- **`lotCount`** - how many original physical lots a row represents.
  Beyond its current use weighting the `guess` size, this is a rough
  proxy for how common/standard a given product+size combination is in
  the store's actual inventory history.
- **Gender guess from `styleName` keywords** (`guessGenderFromStyleName()`
  in `cpcMaster.ts`) - already wired into gold auto-fill as a
  best-effort default, staff can always override it.
