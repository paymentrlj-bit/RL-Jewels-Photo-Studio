// A piece gets a few AI pictures (the first and two re-runs). After that a Fix, an
// extra photo or a reshoot would only keep paying for the same problem - but what was
// asked is still written down, and the real photo (free) is always allowed.
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
import { listPhotos } from '../storage/images';

let app: express.Express;
let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-tries-test-'));
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

async function as(role: 'photographer' | 'manager' | 'admin', name: string) {
  await createUser({ username: name, password: 'a-real-password-1', isAdmin: role === 'admin', role: role === 'admin' ? undefined : role });
  return (await request(app).post('/api/login').send({ username: name, password: 'a-real-password-1' })).headers['set-cookie']![0];
}

async function pieceWithTries(cookie: string, aiRuns: number, status = 'awaiting_review') {
  const id = (await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Bracelet' })).body.product.id as string;
  await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg });
  getDb().prepare(`UPDATE jobs SET status = 'succeeded' WHERE product_id = ?`).run(id);
  getDb().prepare('UPDATE products SET ai_runs = ?, status = ? WHERE id = ?').run(aiRuns, status, id);
  return id;
}

describe('the limit on AI pictures per piece', () => {
  it('lets a piece with tries left be fixed, and tells the app how many it has used', async () => {
    const cookie = await as('photographer', 'photog');
    const id = await pieceWithTries(cookie, MAX_AI_TRIES - 1);
    const res = await request(app).post(`/api/products/${id}/fix`).set('Cookie', cookie).send({ issues: ['hook'] });
    expect(res.status).toBe(202);
    expect(res.body.product.tries).toEqual({ used: MAX_AI_TRIES - 1, max: MAX_AI_TRIES, left: 1 });
  });

  it('refuses a fix, an extra photo, a reshoot photo and a retry once the tries are used - and remembers what was asked', async () => {
    const cookie = await as('photographer', 'photog');
    const id = await pieceWithTries(cookie, MAX_AI_TRIES);

    const fix = await request(app).post(`/api/products/${id}/fix`).set('Cookie', cookie).send({ issues: ['hook'], note: 'S hook missing' });
    expect(fix.status).toBe(409);
    expect(fix.body.triesExhausted).toBe(true);
    expect(fix.body.error).toMatch(/real photo/i);

    const before = listPhotos(id).length;
    expect((await request(app).post(`/api/products/${id}/angle`).set('Cookie', cookie).send({ imageBase64: jpeg })).status).toBe(409);
    expect((await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg })).status).toBe(409);
    expect((await request(app).post(`/api/products/${id}/requeue`).set('Cookie', cookie).send({})).status).toBe(409);
    expect(listPhotos(id).length).toBe(before);

    // What was asked is not lost: it is design memory and it is logged.
    const memory = getDb().prepare('SELECT issues, note FROM fix_requests WHERE product_id = ?').get(id);
    expect(memory).toEqual({ issues: '["hook"]', note: 'S hook missing' });
    const events = getDb().prepare("SELECT payload FROM events WHERE type = 'product.rerun_blocked'").all() as { payload: string }[];
    expect(events.length).toBe(4);
  });

  it('always allows the real photo, which is free', async () => {
    const cookie = await as('photographer', 'photog');
    const id = await pieceWithTries(cookie, MAX_AI_TRIES);
    const res = await request(app).post(`/api/products/${id}/fix`).set('Cookie', cookie).send({ issues: ['real_photo'] });
    expect(res.status).toBe(202);
  });

  it('lets only an admin allow more tries, two at a time', async () => {
    const photog = await as('photographer', 'photog');
    const mgr = await as('manager', 'mgr');
    const admin = await as('admin', 'boss');
    const id = await pieceWithTries(photog, MAX_AI_TRIES);

    expect((await request(app).post(`/api/products/${id}/allow-tries`).set('Cookie', photog)).status).toBe(403);
    expect((await request(app).post(`/api/products/${id}/allow-tries`).set('Cookie', mgr)).status).toBe(403);
    const res = await request(app).post(`/api/products/${id}/allow-tries`).set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.product.tries).toEqual({ used: MAX_AI_TRIES, max: MAX_AI_TRIES + 2, left: 2 });
    expect(getProduct(id)!.extraTries).toBe(2);
    expect((await request(app).post(`/api/products/${id}/fix`).set('Cookie', photog).send({ issues: ['hook'] })).status).toBe(202);
  });
});

describe('catalogue copy after approval', () => {
  const copyJobs = (id: string) => (getDb().prepare(`SELECT COUNT(*) AS n FROM jobs WHERE product_id = ? AND type = 'copy'`).get(id) as { n: number }).n;

  it('is queued when a piece is approved, once, and not for a piece that already has a description', async () => {
    const mgr = await as('manager', 'mgr');
    const fresh = await pieceWithTries(mgr, 1);
    const written = await pieceWithTries(mgr, 1);
    getDb().prepare("UPDATE products SET description = 'Already written.' WHERE id = ?").run(written);

    expect(copyJobs(fresh)).toBe(0);
    expect((await request(app).post(`/api/products/${fresh}/approve`).set('Cookie', mgr).send({})).status).toBe(200);
    expect((await request(app).post(`/api/products/${written}/approve`).set('Cookie', mgr).send({})).status).toBe(200);
    expect(copyJobs(fresh)).toBe(1);
    expect(copyJobs(written)).toBe(0);
  });
});
