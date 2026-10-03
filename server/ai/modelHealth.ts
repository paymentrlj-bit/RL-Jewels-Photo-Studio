// Asks Gemini whether every model the pipeline depends on still exists. Most are
// *-preview models that Google can withdraw without notice; today that shows up
// as a pile of failed photos. This turns it into one `system.model_health`
// event per model per day, which an Axiom monitor can alert on.
//
// It calls models.get, which is metadata only: no generation, no cost.
import { isGeminiConfigured } from '../config';
import {
  getGeminiClient,
  isModelNotFoundError,
  debugDetail,
  MODEL_ENHANCE_DEFAULT,
  MODEL_ENHANCE_ESCALATED,
  MODEL_AUDIT,
  MODEL_AUDIT_STRONG,
  MODEL_COPY,
  MODEL_SEGMENT,
  MODEL_INVENTORY,
} from './client';
import { logEvent } from '../logging';

export const PIPELINE_MODELS: { role: string; model: string }[] = [
  { role: 'enhance', model: MODEL_ENHANCE_DEFAULT },
  { role: 'enhance-escalated', model: MODEL_ENHANCE_ESCALATED },
  { role: 'audit', model: MODEL_AUDIT },
  { role: 'audit-strong', model: MODEL_AUDIT_STRONG },
  { role: 'copy', model: MODEL_COPY },
  { role: 'segment', model: MODEL_SEGMENT },
  { role: 'inventory', model: MODEL_INVENTORY },
];

export interface ModelHealth {
  role: string;
  model: string;
  ok: boolean;
  /** 'missing' = the model no longer exists; 'error' = could not check (network, quota). */
  problem?: 'missing' | 'error';
  detail?: string;
}

export async function checkModelHealth(): Promise<ModelHealth[]> {
  if (!isGeminiConfigured()) return [];
  const ai = getGeminiClient();
  // One model per distinct name; several roles can share one.
  const results: ModelHealth[] = [];
  for (const { role, model } of PIPELINE_MODELS) {
    try {
      await ai.models.get({ model });
      results.push({ role, model, ok: true });
    } catch (err) {
      const missing = isModelNotFoundError(err);
      results.push({ role, model, ok: false, problem: missing ? 'missing' : 'error', detail: debugDetail(err).slice(0, 300) });
    }
  }
  for (const r of results) {
    logEvent('system.model_health', { role: r.role, model: r.model, ok: r.ok, problem: r.problem ?? null, detail: r.detail ?? null });
  }
  return results;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Checks shortly after boot, then daily. Never throws and never keeps the process alive. */
export function startModelHealthChecks(): void {
  const run = () => void checkModelHealth().catch((err) => console.warn('[model-health] check failed:', (err as Error).message));
  setTimeout(run, 60_000).unref();
  setInterval(run, DAY_MS).unref();
}
