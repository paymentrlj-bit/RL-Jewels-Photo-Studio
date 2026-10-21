// "Retry all failed" puts technically failed pieces back in the queue, and
// leaves alone anything that needs a new photo or has used up its AI tries.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser } from '../auth/users';
import { getProduct, MAX_AI_TRIES } from '../db/products';

let app: express.Express;
let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-retry-test-'));
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

async function as(role: 'photographer' | 'manager', name: string) {
  await createUser({ username: name, password: 'a-real-password-1', isAdmin: false, role });
  return (await request(app).post('/api/login').send({ username: name, password: 'a-real-password-1' })).headers['set-cookie']![0];
}

async function piece(cookie: string, status: string, aiRuns = 0) {
  const id = (await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Bracelet' })).body.product.id as string;
  await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg });
  getDb().prepare(`UPDATE jobs SET status = 'failed', attempts = max_attempts WHERE product_id = ?`).run(id);
  getDb().prepare('UPDATE products SET ai_runs = ?, status = ? WHERE id = ?').run(aiRuns, status, id);
  return id;
}

describe('retry all failed', () => {
  it('requeues failed pieces only, skipping reshoots and pieces out of tries', async () => {
    const manager = await as('manager', 'boss');
    const failed = await piece(manager, 'failed');
    const reshoot = await piece(manager, 'needs_reshoot');
    const spent = await piece(manager, 'failed', MAX_AI_TRIES);

    const res = await request(app).post('/api/products/requeue-failed').set('Cookie', manager).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ queued: 1, skipped: 1 });
    expect(getProduct(failed)!.status).toBe('queued');
    expect(getProduct(reshoot)!.status).toBe('needs_reshoot');
    expect(getProduct(spent)!.status).toBe('failed');
    const job = getDb().prepare('SELECT status FROM jobs WHERE product_id = ?').get(failed) as { status: string };
    expect(job.status).toBe('queued');
  });

  it('is for managers, not photographers', async () => {
    const photog = await as('photographer', 'photog');
    const res = await request(app).post('/api/products/requeue-failed').set('Cookie', photog).send({});
    expect(res.status).toBe(403);
  });
});
