# RL Jewels Photo Studio

Turns a quick counter photo of a gold piece into a studio-quality catalogue
image, writes the product copy, and exports both in whatever shape the store's
ERP wants — at the pace a 3,000-SKU catalogue run actually needs.

Built for one store in Jalgaon: a tethered Canon at a fixed lightbox station,
counter staff who are not photographers, and a POS catalogue of 3,247 products
that all need shooting.

---

## What it does

1. **Shoot.** Scan the tag, and the CPC auto-fills item type, size, purity and
   gender from the store's own POS catalogue. Photograph the piece with the
   tethered studio camera or a phone. Submit — and immediately shoot the next
   one. Nobody waits for the AI.
2. **Process.** Background workers segment the piece, enhance it to a clean
   white-background studio shot, and run a nine-point quality audit on the
   result. A failure escalates once to a stronger model with the specific
   failure reason fed back in. Catalogue copy and SEO fields are written
   separately.
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
| **Cloud Run** | Build the image, mount a volume at `/data`. **Without a mounted volume you lose every product and photo on each container recycle.** |
| **VPS** | `docker compose up -d`. Put a reverse proxy in front for TLS. |
| **The Lenovo at the lightbox** | Same image. Worth serious consideration: it removes the Cloudflare Tunnel entirely, and the studio keeps working when the store's internet does not. |

**Back up `DATA_DIR`.** It is the shoot. Copying the directory while the app is
running is safe enough for this workload (SQLite is in WAL mode), but a nightly
copy with the service briefly stopped is cleaner.

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
| Tethered studio camera | `DSLR_BRIDGE_URL`, `DSLR_BRIDGE_SECRET` | [DSLR_CAPTURE_SETUP.md](DSLR_CAPTURE_SETUP.md) |
| Tag text OCR | `OCR_SPACE_API_KEY` | free tier at ocr.space |
| Axiom log mirror | `AXIOM_TOKEN` | [LOGGING_SETUP.md](LOGGING_SETUP.md) |

---

## ERP export

Export column layouts are **data, not code**. Three ship with the app:

- `generic` — every field, plain headers. The default.
- `odoo` — Odoo `website_sale` field names.
- `shopify` — Shopify's product import headers.

> **Read this before the first real export.** The `odoo` layout exists because
> v1 hardcoded Odoo's field names. Nobody ever confirmed the store runs Odoo.
> If it does not, every export needs manual re-entry. Confirm the real system,
> then either pick the matching preset or write one.

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
  integrations/      CPC master, Drive, DSLR bridge
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
export mapping validation, password hashing, and the queue's claim and recovery
semantics.

---

## Known gaps

Honest list of what is not done, so nobody discovers these the hard way:

- **The ERP target is unconfirmed.** See the warning above. This is the single
  biggest open question and it blocks a clean go-live.
- **Cost figures are placeholders.** `COST_*_USD` default to estimates, not
  real Gemini rates. The Insights dashboard labels them as such until set.
  Calibrate after a pilot run.
- **Two preview models are on the critical path.** `nano-banana-pro-preview`
  (escalation) and `gemini-robotics-er-1.6-preview` (segmentation). Preview
  models get withdrawn. Segmentation fails open, so it degrades safely;
  escalation is detected and reported distinctly from a bad photo, but there is
  no automatic fallback model yet.
- **The DSLR focus commands are unverified.** `DoAutoFocus` and
  `LiveView_Focus` were never tested against the store's specific
  digiCamControl install. See the troubleshooting notes in
  [DSLR_CAPTURE_SETUP.md](DSLR_CAPTURE_SETUP.md).
- **OCR tag scanning has no UI.** The `/api/ocr-space` and `/api/scan-tag`
  endpoints work, but the new capture screen uses barcode/QR scanning plus CPC
  lookup instead, which is more reliable. The endpoints are kept for when
  someone wants text OCR back.
- **Single photo per product.** Multi-angle would be a real change, not a
  toggle.
- **No automated frontend tests.**
