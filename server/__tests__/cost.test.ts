import { describe, it, expect, vi } from 'vitest';
import {
  extractUsage,
  estimateCostUsd,
  generateWithThinkingLimit,
  MODEL_AUDIT,
  MODEL_AUDIT_STRONG,
  MODEL_ENHANCE_DEFAULT,
} from '../ai/client';

describe('what a call costs', () => {
  it('reads thinking tokens, which are billed but are not part of the visible answer', () => {
    const u = extractUsage({ usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 50, thoughtsTokenCount: 4000 } });
    expect(u).toEqual({ promptTokens: 1000, candidatesTokens: 50, thoughtsTokens: 4000, totalTokens: 5050 });
    expect(extractUsage({})).toBeNull();
  });

  it('bills thinking at the output rate, so a Pro call with a short answer is not nearly free', () => {
    const usage = { promptTokens: 1000, candidatesTokens: 50, thoughtsTokens: 4000, totalTokens: 5050 };
    const withThinking = estimateCostUsd(MODEL_AUDIT_STRONG, usage)!;
    const withoutThinking = estimateCostUsd(MODEL_AUDIT_STRONG, { ...usage, thoughtsTokens: 0 })!;
    expect(withThinking).toBeGreaterThan(withoutThinking * 10);
  });

  it('prices the cheap audit model far below Pro for the same call', () => {
    const usage = { promptTokens: 2000, candidatesTokens: 100, thoughtsTokens: 500, totalTokens: 2600 };
    expect(estimateCostUsd(MODEL_AUDIT, usage)!).toBeLessThan(estimateCostUsd(MODEL_AUDIT_STRONG, usage)! / 4);
  });

  it('prices image output heavily, and says nothing for a model it does not know', () => {
    const img = { promptTokens: 500, candidatesTokens: 1290, thoughtsTokens: 0, totalTokens: 1790 };
    expect(estimateCostUsd(MODEL_ENHANCE_DEFAULT, img)!).toBeGreaterThan(0.05);
    expect(estimateCostUsd('some-other-model', img)).toBeNull();
  });
});

describe('limiting the Pro model\'s thinking', () => {
  const fakeAi = (impl: (params: any) => Promise<unknown>) => {
    const generateContent = vi.fn(impl);
    return { ai: { models: { generateContent } } as never, generateContent };
  };

  it('asks Pro for a low thinking level and leaves other models alone', async () => {
    const { ai, generateContent } = fakeAi(async () => ({ ok: true }));
    await generateWithThinkingLimit(ai, { model: MODEL_AUDIT_STRONG, contents: 'x', config: { temperature: 0 } });
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toBeDefined();
    expect(generateContent.mock.calls[0][0].config.temperature).toBe(0);
    await generateWithThinkingLimit(ai, { model: MODEL_AUDIT, contents: 'x' });
    expect(generateContent.mock.calls[1][0].config.thinkingConfig).toBeUndefined();
  });

  it('does not retry a quota error as if the thinking setting were the problem', async () => {
    const { ai, generateContent } = fakeAi(async () => {
      throw new Error('{"error":{"code":429,"message":"You exceeded your current quota","status":"RESOURCE_EXHAUSTED"}}');
    });
    await expect(generateWithThinkingLimit(ai, { model: MODEL_AUDIT_STRONG, contents: 'x' })).rejects.toThrow(/429/);
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('retries once without the setting if the API refuses it, then stops sending it', async () => {
    const { ai, generateContent } = fakeAi(async (p) => {
      if (p.config?.thinkingConfig) throw new Error('{"error":{"code":400,"message":"thinking level is not supported","status":"INVALID_ARGUMENT"}}');
      return { ok: true };
    });
    await expect(generateWithThinkingLimit(ai, { model: MODEL_AUDIT_STRONG, contents: 'x' })).resolves.toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(2);
    await generateWithThinkingLimit(ai, { model: MODEL_AUDIT_STRONG, contents: 'y' });
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(generateContent.mock.calls[2][0].config?.thinkingConfig).toBeUndefined();
  });
});
