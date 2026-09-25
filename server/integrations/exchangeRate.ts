// Live USD -> INR rate for the admin cost dashboard, refreshed periodically
// so the ₹ estimate moves with the market instead of sitting on a hand-set
// number that goes stale within days.
//
// IMPORTANT CAVEAT: this is a market mid-rate, not necessarily the exact
// figure Google applies to this account's invoice. Google Cloud Billing
// converts USD charges to the billing account's local currency using its own
// rate, set by the payment profile/settlement bank, which is not exposed by
// any public, credential-free API - getting that exact number requires
// reading it off the real invoice (GCP Console > Billing > Reports, or the
// monthly invoice PDF). A live market rate is the closest available proxy
// without wiring up Billing API credentials, and unlike a static number it
// tracks the market the way any real conversion does.

import { config } from '../config';

interface RateCache {
  rate: number;
  fetchedAt: number;
}

let cached: RateCache | null = null;
// Forex for an estimate doesn't need to be fresher than this - refreshing
// every request would just be extra latency and an extra external dependency
// on every dashboard load for no real accuracy gain.
const REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

async function fetchLiveRate(): Promise<number | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    // No API key required; daily-updated USD base rates.
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { signal: controller.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    const rate = data?.rates?.INR;
    return typeof rate === 'number' && rate > 0 ? rate : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Returns the rate to use right now, plus whether it came from the live
 * source or the static config fallback (config.usdToInrRate) - shown in the
 * dashboard so a fallback is never silently mistaken for a live rate.
 */
export async function getUsdToInrRate(): Promise<{ rate: number; live: boolean }> {
  if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) {
    return { rate: cached.rate, live: true };
  }
  const live = await fetchLiveRate();
  if (live) {
    cached = { rate: live, fetchedAt: Date.now() };
    return { rate: live, live: true };
  }
  // A failed fetch is not cached as a failure - the next request tries the
  // live source again immediately rather than being stuck on the static
  // fallback for a full refresh window.
  return { rate: config.usdToInrRate, live: false };
}
