# RL Jewels Photo Studio

Turns a quick counter photo of a gold piece into a studio-quality catalogue
image, writes the product copy, and exports both in whatever shape the store's
ERP wants — at the pace a 3,000-SKU catalogue run actually needs.

Built for one store in Jalgaon: phone photos taken at the sales counter by
staff who are not photographers, and a POS catalogue of 3,247 products that all
need shooting.

---

## What it does

1. **Shoot.** Scan the tag, and the CPC auto-fills item type, size, purity and
   gender from the store's own POS catalogue. Photograph the piece. Free
   on-device checks catch a blurred or flash-blown photo *before* it costs an
   API call. Submit — and immediately shoot the next one. Nobody waits.
2. **Process.** Background workers trace the piece's real outline, enhance it
   to a clean white-background studio shot at the right aspect ratio for its
   category, and run a twelve-point quality audit. Failures are **classified**:
   a blurred or cropped photo, or one where the AI altered the design, goes
   straight back for a reshoot — a stronger model cannot fix either. Only
   genuine rendering failures earn one escalated retry, re-graded by a stronger
   auditor.
3. **Review.** Everything that passed the AI's own QA sits on one screen,
   original next to studio version, to approve or send back for a reshoot.
4. **Export.** A whole shoot exports as one CSV and one ZIP, or uploads
   straight to Google Drive.

---

## Quick start

```bash
npm install
cp .env.example .env
#  Set SESSION_SECRET and BOOTSTRAP_ADMIN_PASSWORD. Add GEMINI_API_KEY to
#  actually process photos; without it, capture still works and the app says so.
npm run dev
```

Open http://localhost:3000 and sign in with `admin` and the
`BOOTSTRAP_ADMIN_PASSWORD` you set. First thing to do: create a real account
for each staff member under **Admin → Staff accounts**.

### With Docker

```bash
cp .env.example .env    # set SESSION_SECRET and BOOTSTRAP_ADMIN_PASSWORD
docker compose up -d
```

---

## Deployment

Everything persistent — the SQLite database and every photo — lives in one
directory, set by `DATA_DIR`. That is the whole storage story, which is what
makes the three options below equivalent.

| Target | Notes |
|---|---|
| **Oracle Cloud Always Free** (Mumbai) ← *recommended* | **[ORACLE_CLOUD_SETUP.md](ORACLE_CLOUD_SETUP.md)** — ₹0/month forever, real HTTPS via Caddy, so the barcode scanner works. Deployment is three commands. |
| **The shop Lenovo** | **[RUNNING_ON_THE_LENOVO.md](RUNNING_ON_THE_LENOVO.md)** — plain Node, no Docker. Good for the pilot. No HTTPS means no barcode scanning; photography still works. |
| **Any other VPS** | Same as Oracle: `deploy/setup.sh`, then `docker compose up -d` in `deploy/`. |
| **Cloud Run** | Build the image, mount a volume at `/data`. **Without a mounted volume you lose every product and photo on each container recycle.** |

> ⚠️ **Do not deploy this to Google AI Studio.** It hosts on Cloud Run with
> ephemeral container storage and no volume mount. v1 survived that by storing
> nothing; v2 keeps the database and every photo in `DATA_DIR`, so it would be
> wiped on the next redeploy or idle timeout.

**Back up `DATA_DIR`.** It is the shoot. `deploy/backup.sh --install` schedules
a nightly archive; copying while the app runs is safe enough here (SQLite is in
WAL mode). Pull a copy off the server weekly — an on-server backup does not
survive losing the server.

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). The two that
are genuinely required in production:

- `SESSION_SECRET` — signs the session cookie; must stay fixed.
- `BOOTSTRAP_ADMIN_PASSWORD` — creates the first admin, once.

With `NODE_ENV=production` the server **refuses to start** without them rather
than falling back to a default. Everything else is optional and each feature
reports its own availability to the UI.

### Optional integrations

| Feature | Variables | Setup guide |
|---|---|---|
| AI processing | `GEMINI_API_KEY` | — |
| Google Drive export | `GOOGLE_DRIVE_*` | [DRIVE_SETUP.md](DRIVE_SETUP.md) |
| Tag text OCR | `OCR_SPACE_API_KEY` | free tier at ocr.space |
| Axiom log mirror | `AXIOM_TOKEN` | [LOGGING_SETUP.md](LOGGING_SETUP.md) |

---

## ERP export

Export column layouts are **data, not code**. Several ship with the app:

- `generic` — every field, plain headers. The current default.
- `jewelsoft` — **the store's actual ERP.** The right fields, but the column
  headers are placeholders until JewelSoft sends their sample import file.
- `meta-catalog` — Meta/WhatsApp Business catalogue feed. The likely first
  online surface, ahead of any real store.
- `shopify` — Shopify's product import headers, for later.
- `odoo` — kept only because the store uses Odoo for **free website hosting**.
  It is *not* the ERP.

> **Before the first real export:** switch `ERP_MAPPING` to `jewelsoft` only
> after replacing the placeholder headers in
> `server/export/mappings/jewelsoft.json` with JewelSoft's real ones.

To add your own, drop a JSON file into `<DATA_DIR>/mappings/` and set
`ERP_MAPPING` to its `id`. No rebuild, no redeploy:

```json
{
  "id": "tally",
  "label": "Tally Prime item import",
  "columns": [
    { "header": "Item Name", "field": "name" },
    { "header": "Item Code", "field": "cpc" },
    { "header": "Unit",      "const": "Nos" }
  ]
}
```

Each column takes either a `field` (pulled from the product) or a `const` (the
same literal in every row). The available field names are listed in
[`server/export/fields.ts`](server/export/fields.ts); an unknown one is
rejected at boot with a message naming it, rather than silently exporting a
column of blanks.

---

## Architecture

```
server/
  config.ts          env, validated at boot - fails fast in production
  db/                SQLite connection, migrations, product & batch repository
  auth/              scrypt passwords, signed-cookie sessions, login lockout
  ai/                prompts, Gemini client, the four model calls
  queue/             job table + background workers (the batch engine)
  storage/           images on disk, referenced by id
  export/            ERP mappings, CSV, JSON-LD
  catalog/           the one item-category taxonomy (ratio + gender defaults)
  integrations/      CPC master, Drive
  routes/            the HTTP surface
src/                 React frontend
```

**Why SQLite.** One store, two capture stations, a few thousand products. It
handles that without effort, needs no second container, and runs identically on
Cloud Run, a VPS and the Lenovo — which is what keeps the on-premise option
open for a store whose internet is not guaranteed.

**Why a job queue.** It is the difference between a tool that can do a
catalogue run and one that cannot. Capture returns in milliseconds; processing
happens behind the staff member. Jobs left running by a crash or a redeploy are
recovered at next boot.

### The enhance prompt

`server/ai/prompts.ts` holds the prompt that does the actual work. Every clause
in it is the residue of a specific failure seen in real output — invented
engravings, kinked jhumka chains, patchy colour across motifs. It is editable
by an admin in the UI, and it is stored server-side so a change reaches every
device at once.

**Edit it to lock in RL Jewels' house style. Do not edit it to make it
shorter.**

---

## Development

```bash
npm run dev      # tsx watch + vite middleware, one process on :3000
npm run lint     # tsc --noEmit, strict, covers server and frontend
npm test         # vitest
npm run build    # vite build + esbuild server bundle
npm start        # production
```

Tests cover the logic where a silent wrong answer is expensive: CPC parsing,
category resolution and aspect-ratio branching, escalation classification,
prompt invariants, export mapping validation, password hashing, and the queue's
claim and recovery semantics.

---

## Known gaps

Honest list of what is not done, so nobody discovers these the hard way:

- **JewelSoft's real import columns are still unknown.** The `jewelsoft`
  mapping has the right fields with placeholder headers. Swap them when the
  sample import file arrives — it is a one-file edit, no rebuild.
- **The house visual standard is not locked in yet.** The enhance prompt
  produces a generic clean-studio look. Reference photos would pin it to RL
  Jewels' actual background, shadow and crop.
- **Cost figures are placeholders.** `COST_*_USD` default to estimates, not
  real Gemini rates. The Insights dashboard labels them as such until set.
  Calibrate after the first 50 products.
- **Two preview models sit on the critical path.** `nano-banana-pro-preview`
  (escalation) and `gemini-robotics-er-1.6-preview` (segmentation). Preview
  models get withdrawn. Segmentation fails open, so it degrades safely;
  escalation is detected and reported distinctly from a bad photo, but there
  is no automatic fallback model yet.
- **Barcode scanning needs HTTPS.** Over plain HTTP on the shop LAN the app
  hides the scanner and staff type the CPC. Photography is unaffected. See
  [RUNNING_ON_THE_LENOVO.md](RUNNING_ON_THE_LENOVO.md) for the certificate
  route if typing gets tiresome.
- **Tag weight OCR has no UI.** `/api/ocr-space` and `/api/scan-tag` work, but
  nothing calls them — weights are typed. Reading the back of the tag
  automatically is the obvious next efficiency win.
- **No scan auto-advance yet.** The spec's front-scan → back-scan hand-off and
  the "skip the front scan when the CPC is already certain" shortcut are not
  built.
- **Staff correction confirmation is not built.** Corrections to a `certain`
  CPC match are learned, but without the "please double-check these details"
  prompt the spec asks for.
- **Single photo per product.** Multi-angle would be a real change, not a
  toggle.
- **Shared staff login for now.** The app supports per-person accounts today
  (Admin → Staff accounts); the store plans to switch to them once the process
  is settled.
- **No automated frontend tests.**
