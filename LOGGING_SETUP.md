# External Log Sink Setup (Axiom)

Every event the app logs (pipeline runs, AI call outcomes, tag scans, staff actions, admin changes, HTTP requests, crashes) is written to the local SQLite database (same volume as products and photos), which is **always** the durable, authoritative store - the Studio Insights dashboard reads from it exclusively, restart or redeploy or not, whether or not Axiom is configured.

Setting `AXIOM_TOKEN` turns on a second, optional copy: every event is *also* forwarded to [Axiom](https://axiom.co), a free-tier log/analytics service. This exists for ad-hoc querying beyond what the built-in dashboard offers - not as a dependency the app needs to function. If `AXIOM_TOKEN` is never set, nothing changes: the dashboard works exactly the same, reading local disk.

## Confirmed working (checked 2026-09-23)

This server's `AXIOM_TOKEN`/`AXIOM_DATASET` are live and correctly configured - real events from this store's own use are landing in the `rl-jewels-events` dataset, including `auth.login_success`/`auth.login_failure` from this week's password-reset work and `server.started`/`server.stopped` from the reboot. If you ever want to check this yourself: Axiom console → `rl-jewels-events` → run `| summarize count() by type`.

## Why Axiom (over Better Stack or Sentry)

All three offer a free tier, but they're built for different jobs:
- **Sentry** is an error/crash tracker - not a great fit for business events like "which audit check failed" or "which weight field got corrected."
- **Better Stack** is strong for log tailing and incident alerting.
- **Axiom** is built specifically for ingesting structured JSON events and querying them back programmatically (via its API and query language, APL) - useful for slicing this app's event stream in ways the built-in dashboard doesn't offer.

## What gets logged

Every `logEvent()` call in the server writes to local disk and, if configured, queues the same event for Axiom (sent in small batches, never one request per event, so this never slows down a staff-facing request). As of this week, that stream covers:

- **Business events**: batches, products, photo captures, approvals/rejections, exports (CSV/ZIP/Drive), CPC lookups and corrections, OCR tag scans.
- **The AI pipeline**: every stage's API call, latency and cost, each audit verdict's full checklist, every escalation decision and why.
- **Admin actions**: every staff account created, password reset, activated/deactivated, promoted/demoted; every enhance-prompt change.
- **Auth**: every login success/failure/lockout.
- **Every HTTP request** (`http.request`): method, path, status, latency, who - added this week specifically so "which endpoint is slow" or "who hit this" is answerable after the fact instead of guessed at.
- **Every unhandled error** (`http.unhandled_error`) and **process crash** (`server.crashed`, `uncaughtException`/`unhandledRejection`) - added this week. Previously a crash nobody anticipated went to `console.error` only, which on a server nobody is tailing might as well not have happened.
- **A liveness heartbeat** (`system.heartbeat`) every 5 minutes: uptime, memory (RSS + heap), queue depth. This is the direct response to the 2026-09-22 incident, where the server hung at the OS level (CPU spiked, Oracle's own monitoring agent went silent, SSH stopped responding) with nothing anywhere recording that it happened. A heartbeat stream stopping - together with the GitHub Actions uptime check in `.github/workflows/uptime.yml` - is now a second, independent signal instead of relying on someone noticing by chance.
- **Every client-side event** (`client.*`): capture method, framing-guide usage, OCR autofill corrections, generated-copy edits, and - via a global `window.addEventListener('error'/'unhandledrejection', ...)` catch-all in `src/utils/analytics.ts` - every JS error or unhandled promise rejection in the browser, with `isMobile`/viewport/network-quality tagged on automatically.

Between local disk and this list, there is no longer a meaningful category of "thing that happened but nothing recorded" left in the server - see `server/logging.ts` and `server/index.ts` for the exact call sites.

## Setup steps

1. Create a free account at [axiom.co](https://axiom.co).
2. Create a **dataset** - name it `rl-jewels-events` (or pick your own name and set `AXIOM_DATASET` to match).
3. Create an **API token** with ingest permission for that dataset (Settings → API Tokens in the Axiom console). Query permission is optional - the app only ever ingests, it never reads Axiom back.
4. Set these environment variables on your hosting provider (same place you set `GEMINI_API_KEY`):
   - `AXIOM_TOKEN` - the API token from step 3.
   - `AXIOM_DATASET` - optional, defaults to `rl-jewels-events` if you used that name in step 2.
5. Restart the server. Admin → Insights shows "Axiom mirror on" once it's picked up the token; it shows "local log only" until then - either way, the numbers on that page are identical, since they always come from local disk.

## Honest caveat

The ingest side (sending events to Axiom) is a simple, fire-and-forget POST request: if it fails (bad token, network issue), the only consequence is a `console.warn` and the event staying local-only - it can never break or slow down the app itself. There is currently no read path from Axiom back into the app at all, which is deliberately simple: query the Axiom console directly for anything beyond what Admin → Insights already shows from local disk.

## Free tier note

Axiom's free tier limits can change - check [axiom.co/pricing](https://axiom.co/pricing) for current numbers. For a single-store internal tool logging a few hundred events per product processed, plus one heartbeat every 5 minutes, usage should sit comfortably within any reasonable free tier.
