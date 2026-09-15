// Gemini client, model tiers, timeouts and the transient-retry helper.
//
// PORTED FROM v1 server.ts with the reasoning comments intact. The timeout
// constants in particular are not guesses - they came out of reading real
// failure data, and the comment explaining why is the only thing stopping
// someone from "fixing" them back to the wrong value.

import { GoogleGenAI } from '@google/genai';
import { config } from '../config';

let genAIClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!genAIClient) {
    if (!config.geminiApiKey) {
      console.warn('[ai] GEMINI_API_KEY is not set - AI features will report as unavailable.');
    }
    genAIClient = new GoogleGenAI({ apiKey: config.geminiApiKey || '' });
  }
  return genAIClient;
}

// Tiered models: cheap/fast tier for the normal case, escalate to the higher-quality
// tier only for the one auto-retry after a self-QA failure. Verified live against the
// account's actual model list on 2026-08-15 - do not "helpfully" guess new names here
// without testing against /v1beta/models first, the previous version of this file
// shipped several model IDs that were stale or never existed.
export const MODEL_ENHANCE_DEFAULT = 'gemini-3.1-flash-image';
export const MODEL_ENHANCE_ESCALATED = 'nano-banana-pro-preview';
export const MODEL_AUDIT = 'gemini-3.1-flash-lite';
// The grader used for the re-audit AFTER an escalated retry. That audit is the
// last gate before a photo ships, so it is worth a better grader than the
// first-pass tier - a cheap model waving through a still-broken escalation is
// the most expensive possible mistake, having already paid for both passes.
export const MODEL_AUDIT_STRONG = 'gemini-3.1-pro-preview';
// Product copy (name + description) only runs once per staff-approved photo,
// not on every pipeline attempt, so it can afford a stronger model than the
// audit's flash-lite tier - bland, generic copy was traced to that model
// being too weak for genuinely specific, sellable writing, not just a prompt
// problem. Verified against this account's real /v1beta/models list.
export const MODEL_COPY = 'gemini-3.1-pro-preview';
export const MODEL_SEGMENT = 'gemini-robotics-er-1.6-preview';

// Segmentation grounding: a small vision call that traces the real jewelry's
// exact silhouette in the ORIGINAL photo, so the enhance call gets real
// computer-vision facts instead of guessing where the piece's edges are. One
// extra small/fast call, not another image generation. Fails open.
export const ENABLE_SEGMENTATION_GROUNDING = true;

// NOTE FOR GO-LIVE: MODEL_ENHANCE_ESCALATED and MODEL_SEGMENT are both
// *-preview models. Preview models get withdrawn with little notice, and
// these two sit on the escalation path (the retry that rescues a photo that
// failed QA) and the grounding path. Segmentation already fails open, so it
// degrades safely. Escalation does not: if that model disappears, every
// audit failure becomes a reshoot. isEnhanceModelMissing() below detects that
// specific case so the queue can fall back rather than mass-failing a batch.
export function isModelNotFoundError(err: unknown): boolean {
  const message = String((err as { message?: string })?.message || err || '');
  return /not found|NOT_FOUND|is not supported|does not exist|unknown model/i.test(message);
}

export const COST_PER_CALL_USD: Record<string, number> = {
  [MODEL_ENHANCE_DEFAULT]: Number(process.env.COST_ENHANCE_DEFAULT_USD) || 0.04,
  [MODEL_ENHANCE_ESCALATED]: Number(process.env.COST_ENHANCE_ESCALATED_USD) || 0.13,
  [MODEL_AUDIT]: Number(process.env.COST_AUDIT_USD) || 0.001,
  [MODEL_SEGMENT]: Number(process.env.COST_SEGMENT_USD) || 0.001,
  // MODEL_AUDIT_STRONG and MODEL_COPY are currently the same model id, so this
  // one entry prices both. If they ever diverge, add a second entry - the map
  // is keyed by model id, not by the role the model is playing.
  [MODEL_COPY]: Number(process.env.COST_COPY_USD) || 0.01,
};

// These are PLACEHOLDER rates, not verified Gemini billing. The analytics
// dashboard labels them as such. Calibrate against the real Cloud Billing
// console after the first 50-product pilot, via the COST_*_USD env vars.
export const COSTS_ARE_CALIBRATED = Boolean(process.env.COST_ENHANCE_DEFAULT_USD);

// ENHANCE_TIMEOUT_MS went 50s -> 90s in an earlier fix, but Axiom data from a
// real failure batch (2026-08-16 ~20:00-21:42 UTC, well after the 90s fix
// was live) showed that was solving the wrong problem: every single timeout
// across all three models (enhance, audit, and the escalated tier) landed
// within a few MILLISECONDS of the exact configured ceiling - 50001-50002ms
// when the limit was 50s, 90000-90003ms once it was 90s. Genuine successful
// enhance calls in the very same window averaged ~15-20s. That combination
// (near-zero variance exactly at the ceiling, real successes nowhere close
// to it) is the signature of a call that hangs and never returns - a stalled
// connection, not a model that occasionally needs more time. A bigger
// timeout doesn't fix a hang, it just makes staff wait longer for the same
// eventual failure. Lowered back to 45s and paired with one more retry
// attempt (2 -> 3) so a hung connection gets abandoned and retried with a
// fresh one sooner, within a similar or lower worst-case total wait.
export const ENHANCE_TIMEOUT_MS = 45_000;
export const AUDIT_TIMEOUT_MS = 20_000;
export const SEGMENT_TIMEOUT_MS = 15_000;

// Hard ceiling on the ENTIRE pipeline's wall-clock time, independent of how
// individual per-call timeouts and retries stack.
//
// Changed from v1: v1 ran this pipeline inside an HTTP request, so this
// budget also had to keep a proxy from killing the connection. Work now runs
// in a background worker with no client waiting on it, so the budget exists
// purely to stop one pathological item from monopolising a worker slot while
// the rest of the batch waits.
export const PIPELINE_BUDGET_MS = 300_000;

// A short, sanitized version of the real error - the Gemini SDK's messages
// are human-readable API errors, not secrets, and having this visible in the
// UI beats being blind on a deployment we can't tail server logs on.
export function debugDetail(err: unknown): string {
  const message = String((err as { message?: string })?.message || err || 'unknown error');
  return message.slice(0, 300);
}

export function isBillingError(err: unknown): boolean {
  const message = String((err as { message?: string })?.message || err || '');
  return /prepayment credits are depleted|spending cap|exceeded its monthly/i.test(message);
}

export function isTransientError(err: unknown): boolean {
  const e = err as { message?: string; status?: number; code?: number; name?: string };
  const message = String(e?.message || err || '');
  const code = e?.status || e?.code;

  // Billing/quota-cap errors come back as 429 too, but retrying never helps -
  // check these first so they don't fall into the generic 429-is-transient case.
  if (/prepayment credits are depleted|spending cap|exceeded its monthly/i.test(message)) {
    return false;
  }
  if (code === 429 || code === 500 || code === 503 || code === 504) return true;
  // AbortController timeouts throw a DOMException/AbortError whose message is
  // just "The operation was aborted" - that's exactly the kind of thing worth
  // retrying (the next attempt may simply be faster), not giving up on.
  if (e?.name === 'AbortError' || message.toLowerCase().includes('aborted')) {
    return true;
  }
  if (/RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message)) {
    return true;
  }
  return false;
}

export interface RetryAttemptInfo {
  attempt: number;
  latencyMs: number;
  success: boolean;
  error?: unknown;
}

// deadline (epoch ms) bounds the WHOLE pipeline, not just this one call - once
// past it, stop retrying immediately rather than stacking another attempt on
// top of an already-overrun request. onAttempt (optional) fires after every
// single attempt, success or failure - this is what gives the analytics log
// per-attempt latency/outcome data instead of only the final outcome, which
// is what actually shows retry/timeout patterns over time.
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  deadline?: number,
  onAttempt?: (info: RetryAttemptInfo) => void
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (deadline && Date.now() > deadline) {
      throw lastErr || new Error('Pipeline time budget exceeded before this step could run.');
    }
    const startedAt = Date.now();
    try {
      const result = await fn();
      onAttempt?.({ attempt, latencyMs: Date.now() - startedAt, success: true });
      return result;
    } catch (err) {
      lastErr = err;
      onAttempt?.({ attempt, latencyMs: Date.now() - startedAt, success: false, error: err });
      if (attempt < maxAttempts && isTransientError(err) && (!deadline || Date.now() < deadline)) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
