# External Log Sink Setup (Axiom)

By default, every event the app logs (pipeline runs, AI call outcomes, tag scans, staff actions, errors) is written to local disk (`logs/` on the server). That's fast and needs zero setup, but if this server runs on a host with **ephemeral container storage** - recycled on every redeploy or after an idle period - local history disappears with it, and so would the Studio Insights dashboard's numbers.

Setting `AXIOM_TOKEN` turns on a second, durable copy: every event is also forwarded to [Axiom](https://axiom.co), a free-tier log/analytics service built for exactly this kind of structured event data. Nothing else changes - local logging still happens the same way, and everything still works exactly as before if you never set this up.

## Why Axiom (over Better Stack or Sentry)

All three offer a free tier, but they're built for different jobs:
- **Sentry** is an error/crash tracker - not a great fit for business events like "which audit check failed" or "which weight field got corrected."
- **Better Stack** is strong for log tailing and incident alerting.
- **Axiom** is built specifically for ingesting structured JSON events and querying them back programmatically (via its API and query language, APL) - which is exactly what the Studio Insights dashboard needs to pull real numbers back out, not just view logs in someone else's UI.

## How it works here

- Every `logEvent()` call writes to local disk **and** queues the same event for Axiom, sent in small batches (not one request per event). Local disk stays a fast write-side buffer even once Axiom is on.
- `/api/analytics/summary` reads **exclusively from Axiom once it's configured** - not a merge with local disk. This is deliberate: the dashboard should reflect one single source of truth, not a mix of a durable store and a possibly-stale local buffer.
- If Axiom is configured but the query itself fails (bad token, wrong dataset, network issue, unexpected response format), that failure is now surfaced directly in the dashboard as a real error message (with detail) instead of being silently hidden - so a misconfiguration is something you can see and fix, not something that just quietly shows incomplete numbers.
- If `AXIOM_TOKEN` is never set at all, the dashboard reads local disk as before - nothing about that path changes.

## Setup steps

1. Create a free account at [axiom.co](https://axiom.co).
2. Create a **dataset** - name it `rl-jewels-events` (or pick your own name and set `AXIOM_DATASET` to match).
3. Create an **API token** with ingest and query permissions for that dataset (Settings → API Tokens in the Axiom console).
4. Set these environment variables on your hosting provider (same place you set `GEMINI_API_KEY`):
   - `AXIOM_TOKEN` - the API token from step 3.
   - `AXIOM_DATASET` - optional, defaults to `rl-jewels-events` if you used that name in step 2.
5. Restart the server. The Studio Insights dashboard will show a green "Durable: reading exclusively from Axiom" badge; it shows an amber "Local disk only" badge until `AXIOM_TOKEN` is set.

## What you get

- **Durability**: history survives restarts/redeploys, no matter how your host manages disk.
- **A second place to look**: you can also browse the raw event stream directly in the Axiom console (dataset: whatever you set `AXIOM_DATASET` to) for ad-hoc digging beyond what the built-in dashboard shows - useful if you ever want to slice the data in a way the dashboard doesn't offer yet.

## Honest caveat

The ingest side (sending events to Axiom) is a simple, stable POST request and is the lower-risk half of this integration. The query side (reading events back out to power the dashboard) depends on the exact shape of Axiom's API response - it now handles the two response shapes Axiom's APL query API is documented to use, and reports a specific, readable error (shown right in the dashboard, e.g. "Axiom query failed with HTTP 401" or "Unrecognized Axiom query response shape") if something doesn't match, rather than failing silently or generically. If you see an error in Studio Insights after setup:
- **HTTP 401/403** - the token is wrong or lacks query permission on the dataset. Re-check the token in the Axiom console.
- **HTTP 404** - the dataset name doesn't match `AXIOM_DATASET` (or the default `rl-jewels-events`). Check the exact dataset name in the Axiom console.
- **"Unrecognized Axiom query response shape"** - Axiom's API returned something the parser doesn't recognize yet. Please report this (with the error text shown) so the parser can be updated.
- **Timeout** - a network issue between your host and Axiom; try again, and check your host's outbound network policy if it persists.

## Free tier note

Axiom's free tier limits can change - check [axiom.co/pricing](https://axiom.co/pricing) for current numbers. For a single-store internal tool logging a few hundred events per product processed, usage should sit comfortably within any reasonable free tier.
