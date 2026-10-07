// Gemini client, model tiers, timeouts and the transient-retry helper.
//
// PORTED FROM v1 server.ts with the reasoning comments intact. The timeout
// constants in particular are not guesses - they came out of reading real
// failure data, and the comment explaining why is the only thing stopping
// someone from "fixing" them back to the wrong value.

import { GoogleGenAI, ThinkingLevel } from '@google/genai';
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

// ---------------------------------------------------------------------------
// Budget for the Pro model. Gemini 3.1 Pro allows only ~250 requests a day on
// this account's tier (the others allow thousands), and a photo makes several
// Pro calls. The calls that decide whether a photo is right (the audit, the
// detail count) always get Pro; the ones that can live with Flash Lite (the
// identity check, the copy) switch to it once the day's Pro budget is mostly
// spent, so the accuracy checks never run dry. A per-day counter is kept in
// memory; if a restart loses it, the 429 fallbacks below still catch the limit.
// ---------------------------------------------------------------------------
/** Pieces whose form-only risk score is at least this get the Pro grader on the first audit; simpler ones the cheap grader. */
export const AUDIT_PRO_MIN_RISK = Number(process.env.AUDIT_PRO_MIN_RISK) || 30;

export const PRO_DAILY_BUDGET = Number(process.env.PRO_DAILY_BUDGET) || 200;

/** The quota day runs on Pacific time (it resets at midnight there). */
function pacificDay(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}
let proCounter = { day: '', n: 0 };

export function countModelCall(model: string): void {
  if (model !== MODEL_AUDIT_STRONG) return;
  const day = pacificDay();
  proCounter = proCounter.day === day ? { day, n: proCounter.n + 1 } : { day, n: 1 };
}

export function proCallsToday(): number {
  return proCounter.day === pacificDay() ? proCounter.n : 0;
}

/**
 * Which model to use for a role. 'essential' roles always ask for Pro; the
 * rest drop to Flash Lite once the day's budget is mostly used.
 */
export function modelForRole(role: 'essential' | 'flexible'): string {
  if (role === 'essential') return MODEL_AUDIT_STRONG;
  return proCallsToday() >= PRO_DAILY_BUDGET ? MODEL_AUDIT : MODEL_AUDIT_STRONG;
}
// UNVERIFIED - could not check this against a live /v1beta/models list (no
// API key in this environment), against the file's own rule above. 1.6-preview
// was returning a hard 404 "not found... or is not supported for
// generateContent" on every single call in production as of 2026-09-25 -
// Google's own docs page for it still exists, but the model is evidently not
// reachable through this account's standard generateContent call the way it
// used to be. 2-preview is the newer release in the same robotics-ER line,
// per Google's public announcement (30 Jul 2026) of it being "made publicly
// available to developers via the Gemini API." Low-risk to try: this call
// already fails open, so a wrong guess here costs nothing beyond today's
// already-broken state. Confirm against real production logs after this
// ships, and revert to a fresh /v1beta/models check if it also 404s.
export const MODEL_SEGMENT = 'gemini-robotics-er-2-preview';
// Counts and describes the piece's fine detail once, before enhancement. Both
// the enhance call and the audit treat its output as ground truth, so a wrong
// count here poisons both - which is why it gets the strong tier rather than
// flash-lite, even though it runs on every photo. Deduped per image by
// groundingCache, so a regenerate never pays for it twice.
export const MODEL_INVENTORY = 'gemini-3.1-pro-preview';

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

// Output resolution of the enhanced photo. 1K is plenty for web/catalogue use
// and about a third cheaper; set ENHANCE_IMAGE_SIZE=2K to go to 2K without a
// code change if pinch-zoom detail or print ever matters.
export const ENHANCE_IMAGE_SIZE: '1K' | '2K' = process.env.ENHANCE_IMAGE_SIZE?.trim().toUpperCase() === '2K' ? '2K' : '1K';

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
// 20s aborted about 4 in 10 Pro audits (they were still thinking), and an
// aborted call is still billed and then retried - so it is better to wait.
export const AUDIT_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS) || 45_000;
export const SEGMENT_TIMEOUT_MS = 15_000;
// The inventory call sends the full photo plus up to three close-ups to a
// model that reasons before answering, so it is legitimately slower than the
// audit. Same principle as ENHANCE_TIMEOUT_MS above: generous enough for a
// real answer, short enough that a hung connection is abandoned and retried.
export const INVENTORY_TIMEOUT_MS = 40_000;

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
export function debugDetail(err: unknown, max = 300): string {
  const message = String((err as { message?: string })?.message || err || 'unknown error');
  return message.slice(0, max);
}

export function isBillingError(err: unknown): boolean {
  const message = String((err as { message?: string })?.message || err || '');
  return /prepayment credits are depleted|spending cap|exceeded its monthly/i.test(message);
}

/**
 * A 429 that will not clear by waiting a minute: the day's (or project's)
 * allowance is used up. Google names the metric in the message, e.g.
 * "...RequestsPerDayPerProjectPerModel...". Per-minute limits clear on their own.
 */
export function isDailyQuotaError(err: unknown): boolean {
  const e = err as { message?: string; status?: number; code?: number };
  const message = String(e?.message || err || '');
  const is429 = (e?.status || e?.code) === 429 || /RESOURCE_EXHAUSTED|"code":\s*429|exceeded your current quota/i.test(message);
  return is429 && /PerDay|per day|daily|free_tier_requests|FreeTier/i.test(message);
}

/** How long Google asks to wait before trying again, from its error text, or null. */
export function parseRetryDelayMs(err: unknown): number | null {
  const message = String((err as { message?: string })?.message || err || '');
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(message) ?? /retry in (\d+(?:\.\d+)?)\s*s/i.exec(message);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
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
  // The day's allowance is gone: waiting a minute will not bring it back.
  if (isDailyQuotaError(err)) return false;
  if (/"code":\s*429/.test(message)) return true;
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

// Real token counts straight from Gemini's own response, not a guess. Costing
// today (COST_PER_CALL_USD above) is a flat placeholder per call because
// nobody had confirmed per-token rates against the real Cloud Billing
// console yet. Logging the actual counts per call means that whenever those
// rates ARE confirmed, exact cost is one multiplication away in Axiom -
// no code change and no more guessing needed.
export interface TokenUsage {
  promptTokens: number;
  candidatesTokens: number;
  /** Hidden "thinking" tokens. Billed as output, and on the Pro model usually the biggest part of a call's cost. */
  thoughtsTokens: number;
  totalTokens: number;
}

export function extractUsage(response: {
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
}): TokenUsage | null {
  const u = response?.usageMetadata;
  if (!u) return null;
  const promptTokens = u.promptTokenCount ?? 0;
  const candidatesTokens = u.candidatesTokenCount ?? 0;
  const thoughtsTokens = u.thoughtsTokenCount ?? 0;
  return {
    promptTokens,
    candidatesTokens,
    thoughtsTokens,
    totalTokens: u.totalTokenCount ?? promptTokens + candidatesTokens + thoughtsTokens,
  };
}

// ---------------------------------------------------------------------------
// What a call actually costs, from the token counts Google reports.
//
// USD per million tokens, from Google's published list prices as best known -
// an ESTIMATE, to be checked against the Cloud Billing page and overridden with
// GEMINI_PRICES_JSON ({"model": {"in": 2, "out": 12}}) if Google changes them.
// Thinking tokens are billed at the output rate. Image models' output is mostly
// image tokens, billed at a much higher rate than text.
// ---------------------------------------------------------------------------
const PRICES_PER_M: Record<string, { in: number; out: number }> = {
  'gemini-3.1-pro-preview': { in: 2, out: 12 },
  'gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
  'gemini-3.1-flash-image': { in: 0.5, out: 60 },
  'nano-banana-pro-preview': { in: 2, out: 120 },
  'gemini-robotics-er-2-preview': { in: 0.3, out: 2.5 },
};
try {
  if (process.env.GEMINI_PRICES_JSON) Object.assign(PRICES_PER_M, JSON.parse(process.env.GEMINI_PRICES_JSON));
} catch {
  console.warn('[ai] GEMINI_PRICES_JSON is not valid JSON - using the built-in prices.');
}

/** Estimated USD for one call, or null for a model with no known price. */
export function estimateCostUsd(model: string, usage: TokenUsage): number | null {
  const p = PRICES_PER_M[model];
  if (!p) return null;
  return (usage.promptTokens * p.in + (usage.candidatesTokens + usage.thoughtsTokens) * p.out) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Thinking. The Pro model "thinks" before answering and bills those hidden
// tokens as output; for checks like counting beads or naming the product type
// a little thinking is plenty. Defaults to LOW for the Pro model; THINKING_LEVEL
// = low | medium | high | default overrides it. If the API ever refuses the
// setting, the call is retried without it and the setting is dropped for the
// rest of the process, so the pipeline never breaks over it.
// ---------------------------------------------------------------------------
const THINKING_ENV = (process.env.THINKING_LEVEL || 'low').trim().toLowerCase();
let thinkingRefused = false;

function thinkingConfigFor(model: string): Record<string, unknown> {
  if (thinkingRefused || THINKING_ENV === 'default' || model !== MODEL_AUDIT_STRONG) return {};
  const level = { minimal: ThinkingLevel.MINIMAL, low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH }[THINKING_ENV];
  return level ? { thinkingConfig: { thinkingLevel: level } } : {};
}

/** generateContent with the thinking limit applied, and retried plain if the API objects to it. */
export async function generateWithThinkingLimit(
  ai: GoogleGenAI,
  params: { model: string; contents: unknown; config?: Record<string, unknown> }
): Promise<Awaited<ReturnType<GoogleGenAI['models']['generateContent']>>> {
  const thinking = thinkingConfigFor(params.model);
  try {
    return await ai.models.generateContent({ ...params, config: { ...params.config, ...thinking } } as never);
  } catch (err) {
    const msg = String((err as { message?: string })?.message || err);
    if (Object.keys(thinking).length > 0 && /thinking|INVALID_ARGUMENT|"code":\s*400/i.test(msg) && !/quota|429/i.test(msg)) {
      thinkingRefused = true;
      console.warn('[ai] the API refused the thinking setting; continuing without it:', msg.slice(0, 200));
      return ai.models.generateContent(params as never);
    }
    throw err;
  }
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
// Every Gemini call in this process shares one pause: when any call is told
// to slow down, the others wait too instead of piling more requests onto a
// limit that is already hit (a photo makes several calls, and two photos run
// at once).
let pausedUntil = 0;
const MAX_RATE_LIMIT_WAIT_MS = 60_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isRateLimitError(err: unknown): boolean {
  const e = err as { status?: number; code?: number; message?: string };
  return (e?.status || e?.code) === 429 || /RESOURCE_EXHAUSTED|exceeded your current quota|"code":\s*429/i.test(String(e?.message || ''));
}

export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  deadline?: number,
  onAttempt?: (info: RetryAttemptInfo) => void
): Promise<T> {
  let lastErr: unknown;
  // A rate limit is worth more patience than a hiccup: a minute's wait usually clears it.
  let limit = maxAttempts;
  for (let attempt = 1; attempt <= limit; attempt++) {
    const paused = pausedUntil - Date.now();
    if (paused > 0 && (!deadline || Date.now() + paused < deadline)) await sleep(Math.min(paused, MAX_RATE_LIMIT_WAIT_MS));
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
      // A call that timed out was probably still billed. Try once more, not twice.
      if ((err as Error)?.name === 'AbortError') limit = Math.min(limit, 2);
      if (isRateLimitError(err) && isTransientError(err)) {
        limit = Math.max(limit, maxAttempts + 2);
        const wait = Math.min(parseRetryDelayMs(err) ?? 15_000 * attempt, MAX_RATE_LIMIT_WAIT_MS) + 500;
        pausedUntil = Math.max(pausedUntil, Date.now() + wait);
        if (attempt < limit && (!deadline || Date.now() + wait < deadline)) continue; // the pause above does the waiting
      }
      if (attempt < limit && isTransientError(err) && !isRateLimitError(err) && (!deadline || Date.now() < deadline)) {
        await sleep(1000 * attempt);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
