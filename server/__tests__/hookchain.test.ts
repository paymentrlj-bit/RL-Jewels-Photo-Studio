// The two things reviewers sent pieces back for most - a changed hook and a chain
// cut short - are now named in the picture prompt, checked by the audit, and counted
// when a piece is sent back.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser } from '../auth/users';
import { auditOutput, classifyAuditFailure, AUDIT_CHECKS, FIDELITY_RETRYABLE, type AuditCheck } from '../ai/operations';
import { DEFAULT_ENHANCE_PROMPT, buildAuditPrompt } from '../ai/prompts';
import { buildFixBlock, fixOption, AUDIT_CHECK_TO_FIX } from '../catalog/fixes';
import { describeItemType } from '../catalog/taxonomy';

const allTrue = () => Object.fromEntries(AUDIT_CHECKS.map((c) => [c, true])) as Record<AuditCheck, boolean>;
const fakeAi = (json: object) => ({ models: { generateContent: async () => ({ text: JSON.stringify(json), candidates: [{ finishReason: 'STOP' }] }) } }) as never;
const audit = (json: object) => auditOutput(fakeAi(json), 'a', 'image/jpeg', 'b', 'image/jpeg', { itemType: 'Bracelet', purity: '22kt' });

describe('the picture prompt', () => {
  it('keeps the exact hook (usually an S hook), shows the whole chain, and removes leftovers', () => {
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/S hook/);
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/lobster/i);
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/BOTH ends/);
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/thread, string or tie/i);
    expect(DEFAULT_ENHANCE_PROMPT).toMatch(/stand/);
  });

  it('tells the model that bracelets and chains close with an S hook', () => {
    expect(describeItemType('Bracelet').notes).toMatch(/S hook/);
    expect(describeItemType('Chain').notes).toMatch(/S hook/);
  });

  it('turns the new fix problems into exact instructions', () => {
    expect(fixOption('hook')?.instruction).toMatch(/S hook/);
    expect(fixOption('chain_cut')?.instruction).toMatch(/WHOLE chain/);
    expect(buildFixBlock(['hook', 'chain_cut'], '')).toContain('hook');
    expect(AUDIT_CHECK_TO_FIX.hookClaspMatches).toBe('hook');
    expect(AUDIT_CHECK_TO_FIX.chainComplete).toBe('chain_cut');
  });
});

describe('the audit', () => {
  it('asks for the hook and the full-chain checks', () => {
    const prompt = buildAuditPrompt({ itemType: 'Bracelet', purity: '22kt' });
    expect(prompt).toContain('"hookClaspMatches"');
    expect(prompt).toContain('"chainComplete"');
    expect(prompt).toMatch(/S hook/);
  });

  it('fails a piece whose hook changed or whose chain is cut off, and allows one corrective retry for it', async () => {
    for (const check of ['hookClaspMatches', 'chainComplete'] as const) {
      const result = await audit({ ...allTrue(), [check]: false, reason: 'x' });
      expect(result.overallPass, check).toBe(false);
      expect(result.checklist[check]).toBe(false);
      expect(FIDELITY_RETRYABLE).toContain(check);
      const decision = classifyAuditFailure(result.checklist);
      expect(decision.escalate).toBe(false);
    }
  });

  it('does not fail everything when a model leaves the two new checks out', async () => {
    const withoutNew: Record<string, unknown> = { ...allTrue() };
    delete withoutNew.hookClaspMatches;
    delete withoutNew.chainComplete;
    const result = await audit(withoutNew);
    expect(result.overallPass).toBe(true);
    // ...while a check it was always asked for, left out, still fails.
    const withoutOld = { ...withoutNew } as Record<string, unknown>;
    delete withoutOld.stoneCountMatches;
    expect((await audit(withoutOld)).overallPass).toBe(false);
  });
});

describe('sending a piece back', () => {
  let app: express.Express;
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-hook-test-'));
    initDatabase(path.join(dir, 'test.db'));
    app = createApp();
  });
  afterAll(() => {
    closeDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    getDb().exec('DELETE FROM product_vectors; DELETE FROM fix_requests; DELETE FROM jobs; DELETE FROM photos; DELETE FROM products; DELETE FROM batches; DELETE FROM users; DELETE FROM login_attempts; DELETE FROM events;');
  });

  it('records the tapped reasons - counted per style - and says them in the note', async () => {
    await createUser({ username: 'mgr', password: 'a-real-password-1', isAdmin: false, role: 'manager' });
    const cookie = (await request(app).post('/api/login').send({ username: 'mgr', password: 'a-real-password-1' })).headers['set-cookie']![0];
    const id = (await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Bracelet' })).body.product.id as string;
    getDb().prepare("UPDATE products SET status = 'awaiting_review' WHERE id = ?").run(id);

    const res = await request(app).post(`/api/products/${id}/reject`).set('Cookie', cookie).send({ reasons: ['hook', 'photo_bad', 'made-up'], note: '' });
    expect(res.status).toBe(200);
    expect(res.body.product.status).toBe('needs_reshoot');
    expect(res.body.product.reviewNote).toBe('Hook or clasp wrong, My own photo was bad (blurry, cropped, dark)');
    const memory = getDb().prepare("SELECT issues, source FROM fix_requests WHERE product_id = ?").get(id);
    expect(memory).toEqual({ issues: '["hook"]', source: 'reject' });
    const event = getDb().prepare("SELECT payload FROM events WHERE type = 'product.rejected'").get() as { payload: string } | undefined;
    if (event) expect(JSON.parse(event.payload).reasons).toEqual(['hook', 'photo_bad']);
  });
});
