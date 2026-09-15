// Admin-editable settings, stored server-side.
//
// v1 kept the enhance prompt in each browser's localStorage. That meant every
// staff device had its own copy: an admin tuning the prompt on the office
// laptop changed nothing for the tablet at the counter, and there was no way
// to tell which device was running which version of the prompt. For the one
// setting that most directly controls output quality, that is the wrong place
// for it to live.

import { getDb, nowIso } from './db';
import { DEFAULT_ENHANCE_PROMPT } from './ai/prompts';

const KEY_ENHANCE_PROMPT = 'enhance_prompt';

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string, updatedBy?: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
    )
    .run(key, value, nowIso(), updatedBy ?? null);
}

export interface EnhancePromptState {
  prompt: string;
  isCustom: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export function getEnhancePrompt(): string {
  return getSetting(KEY_ENHANCE_PROMPT) || DEFAULT_ENHANCE_PROMPT;
}

export function getEnhancePromptState(): EnhancePromptState {
  const row = getDb()
    .prepare('SELECT value, updated_at, updated_by FROM settings WHERE key = ?')
    .get(KEY_ENHANCE_PROMPT) as { value: string; updated_at: string; updated_by: string | null } | undefined;

  if (!row) {
    return { prompt: DEFAULT_ENHANCE_PROMPT, isCustom: false, updatedAt: null, updatedBy: null };
  }
  return {
    prompt: row.value,
    isCustom: row.value !== DEFAULT_ENHANCE_PROMPT,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

export function setEnhancePrompt(prompt: string, updatedBy: string): void {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error('The enhance prompt cannot be empty.');
  // A prompt this short cannot possibly carry the identity-lock rules, and
  // saving one would silently degrade every photo shot afterward.
  if (trimmed.length < 200) {
    throw new Error('That prompt is suspiciously short. The default is several thousand characters - check before saving.');
  }
  setSetting(KEY_ENHANCE_PROMPT, trimmed, updatedBy);
}

export function resetEnhancePrompt(updatedBy: string): void {
  setSetting(KEY_ENHANCE_PROMPT, DEFAULT_ENHANCE_PROMPT, updatedBy);
}
