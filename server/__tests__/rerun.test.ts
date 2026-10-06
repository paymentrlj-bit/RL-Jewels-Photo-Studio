// Re-runs cost a picture each, so: a burst of extra photos is one run, and a count
// that comes back empty says why.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser } from '../auth/users';
import { claimNextJob, enqueueOrCoalesceEnhance } from '../queue/jobs';
import { callJson, parseInventory, unwrapObject, type JsonCallMeta } from '../ai/inventory';

let app: express.Express;
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-rerun-test-'));
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

const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
const enhanceJobs = (id: string) =>
  getDb().prepare(`SELECT id, status, available_at FROM jobs WHERE product_id = ? AND type = 'enhance' ORDER BY created_at`).all(id) as { id: string; status: string; available_at: string | null }[];

describe('extra photos of one piece', () => {
  it('become one run, however many arrive in a burst', async () => {
    await createUser({ username: 'photog', password: 'a-real-password-1', isAdmin: false, role: 'photographer' });
    const cookie = (await request(app).post('/api/login').send({ username: 'photog', password: 'a-real-password-1' })).headers['set-cookie']![0];
    const id = (await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Haar' })).body.product.id as string;
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg });
    // The first run finishes and the piece goes to Review...
    getDb().prepare(`UPDATE jobs SET status = 'succeeded' WHERE product_id = ?`).run(id);

    // ...then three angles are added in quick succession.
    for (let i = 0; i < 3; i++) await request(app).post(`/api/products/${id}/angle`).set('Cookie', cookie).send({ imageBase64: jpeg });

    const waiting = enhanceJobs(id).filter((j) => j.status === 'queued');
    expect(waiting).toHaveLength(1);
    // It waits a few seconds for the next photo instead of starting at once.
    expect(new Date(waiting[0].available_at!).getTime()).toBeGreaterThan(Date.now());
    expect(claimNextJob('w1')).toBeNull();

    // Once the wait is over, it is picked up - once.
    getDb().prepare(`UPDATE jobs SET available_at = ? WHERE id = ?`).run(new Date(Date.now() - 1000).toISOString(), waiting[0].id);
    expect(claimNextJob('w1')?.id).toBe(waiting[0].id);
    expect(claimNextJob('w1')).toBeNull();
  });

  it('start a fresh run if the last one is already under way', async () => {
    await createUser({ username: 'photog', password: 'a-real-password-1', isAdmin: false, role: 'photographer' });
    const cookie = (await request(app).post('/api/login').send({ username: 'photog', password: 'a-real-password-1' })).headers['set-cookie']![0];
    const id = (await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Haar' })).body.product.id as string;
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg });
    getDb().prepare(`UPDATE jobs SET status = 'running' WHERE product_id = ?`).run(id);
    const job = enqueueOrCoalesceEnhance({ productId: id, holdMs: 5000 });
    expect(enhanceJobs(id)).toHaveLength(2);
    expect(job.status).toBe('queued');
  });
});

describe('an unusable count', () => {
  const fakeAi = (response: object) => ({ models: { generateContent: async () => response } }) as never;

  it('says why: how it stopped, how long it was, how it began', async () => {
    const meta: JsonCallMeta = {};
    const out = await callJson(fakeAi({ text: '', candidates: [{ finishReason: 'MAX_TOKENS' }] }), 'gemini-3.1-pro-preview', [], 5000, undefined, meta);
    expect(out).toBeNull();
    expect(meta).toMatchObject({ finishReason: 'MAX_TOKENS', textLength: 0 });
    const cut = await callJson(fakeAi({ text: '{"elements": [{"feature": "bea', candidates: [{ finishReason: 'STOP' }] }), 'gemini-3.1-pro-preview', [], 5000, undefined, meta);
    expect(cut).toBeNull();
    expect(meta.sample).toContain('"elements"');
  });

  it('reads an answer the model wrapped in a list', () => {
    const wrapped = [{ elements: [{ feature: 'bead fringe', count: 7, countConfidence: 'high' }], chainStrands: 2 }];
    expect(parseInventory(wrapped)).toBeNull();
    const inv = parseInventory(unwrapObject(wrapped));
    expect(inv?.elements[0]).toMatchObject({ feature: 'bead fringe', count: 7 });
    expect(inv?.chainStrands).toBe(2);
    expect(unwrapObject([])).toBeNull();
  });
});
