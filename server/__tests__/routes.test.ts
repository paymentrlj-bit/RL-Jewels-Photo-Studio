// Route-level integration tests, through real HTTP against the real Express
// app - as opposed to the rest of the suite, which tests logic in isolation.
//
// The gap this closes: every other test file proves a function returns the
// right answer, but nothing proved a request actually reaches that function
// with the right auth guard in front of it. A regression that accidentally
// dropped `.use(requireAuth)` from a router, or flipped requireAdmin to
// requireAuth on an admin-only route, would pass every existing test and
// still be a real vulnerability. These tests exist to catch exactly that
// class of mistake.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser } from '../auth/users';

let app: express.Express;
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-routes-test-'));
  initDatabase(path.join(dir, 'test.db'));
  app = createApp();
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Each test gets a clean slate so login-lockout counters and user rows from
// one test can't bleed into the next.
beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM fix_requests; DELETE FROM jobs; DELETE FROM photos; DELETE FROM products; DELETE FROM batches; DELETE FROM users; DELETE FROM login_attempts; DELETE FROM events;');
});

async function loginAs(username: string, password: string) {
  const res = await request(app).post('/api/login').send({ username, password });
  const cookie = res.headers['set-cookie']?.[0];
  return { res, cookie };
}

describe('GET /api/health', () => {
  it('is reachable with no session at all', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    // Open tabs compare this against the build they loaded to pick up deploys.
    expect(typeof res.body.build).toBe('string');
  });
});

describe('POST /api/login', () => {
  it('gives an existing user with the wrong password the same answer as a username that does not exist', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const wrongPassword = await loginAs('staffer', 'wrong-password');
    const noSuchUser = await loginAs('nobody-by-this-name', 'wrong-password');
    expect(wrongPassword.res.status).toBe(401);
    expect(noSuchUser.res.status).toBe(401);
    expect(wrongPassword.res.body.error).toBe(noSuchUser.res.body.error);
  });

  it('accepts the right password and sets a session cookie', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const { res, cookie } = await loginAs('staffer', 'a-real-password-1');
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('staffer');
    expect(cookie).toMatch(/^rlj_session=/);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it('locks out after repeated failures, same as the rate-limit tests assume in isolation', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    let last;
    for (let i = 0; i < 10; i++) {
      last = await request(app).post('/api/login').send({ username: 'staffer', password: 'wrong' });
    }
    expect(last!.status).toBe(429);
  });
});

describe('GET /api/session', () => {
  it('is 401 with no cookie', async () => {
    const res = await request(app).get('/api/session');
    expect(res.status).toBe(401);
  });

  it('returns the signed-in user with a valid cookie', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const { cookie } = await loginAs('staffer', 'a-real-password-1');
    const res = await request(app).get('/api/session').set('Cookie', cookie!);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('staffer');
  });
});

// Every router other than auth's own is expected to call requireAuth before
// anything else. This loops over each one's base path so a router that loses
// that guard fails loudly here instead of shipping unnoticed.
describe('routers other than /api/login and /api/health require a session', () => {
  const protectedGets = ['/api/products', '/api/batches', '/api/cpc-stats', '/api/admin/users'];

  for (const routePath of protectedGets) {
    it(`GET ${routePath} is 401 with no cookie`, async () => {
      const res = await request(app).get(routePath);
      expect(res.status).toBe(401);
    });
  }
});

describe('admin routes require an admin account, not just any session', () => {
  it('a signed-in non-admin gets 403 from /api/admin/users', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const { cookie } = await loginAs('staffer', 'a-real-password-1');
    const res = await request(app).get('/api/admin/users').set('Cookie', cookie!);
    expect(res.status).toBe(403);
  });

  it('an admin can list users', async () => {
    await createUser({ username: 'boss', password: 'a-real-password-1', isAdmin: true });
    const { cookie } = await loginAs('boss', 'a-real-password-1');
    const res = await request(app).get('/api/admin/users').set('Cookie', cookie!);
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
  });
});

describe('admin password reset', () => {
  it('lets an admin reset another account\'s password, and the new one works immediately', async () => {
    await createUser({ username: 'boss', password: 'a-real-password-1', isAdmin: true });
    const target = await createUser({ username: 'staffer', password: 'old-password-1', isAdmin: false });
    const { cookie } = await loginAs('boss', 'a-real-password-1');

    const reset = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Cookie', cookie!)
      .send({ password: 'brand-new-password-1' });
    expect(reset.status).toBe(200);

    const oldLogin = await loginAs('staffer', 'old-password-1');
    expect(oldLogin.res.status).toBe(401);

    const newLogin = await loginAs('staffer', 'brand-new-password-1');
    expect(newLogin.res.status).toBe(200);
  });

  it('rejects a reset password under the 10-character policy floor', async () => {
    await createUser({ username: 'boss', password: 'a-real-password-1', isAdmin: true });
    const target = await createUser({ username: 'staffer', password: 'old-password-1', isAdmin: false });
    const { cookie } = await loginAs('boss', 'a-real-password-1');

    const res = await request(app)
      .patch(`/api/admin/users/${target.id}`)
      .set('Cookie', cookie!)
      .send({ password: 'short' });
    expect(res.status).toBe(400);
  });

  it('refuses to deactivate the last admin, so nobody can lock the store out of Admin entirely', async () => {
    const onlyAdmin = await createUser({ username: 'boss', password: 'a-real-password-1', isAdmin: true });
    const { cookie } = await loginAs('boss', 'a-real-password-1');

    const res = await request(app)
      .patch(`/api/admin/users/${onlyAdmin.id}`)
      .set('Cookie', cookie!)
      .send({ isActive: false });
    expect(res.status).toBe(409);
  });
});

describe('extra angle photos', () => {
  const tinyJpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

  async function productWithOriginal(cookie: string) {
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Jhumka' });
    const id = created.body.product.id as string;
    return id;
  }

  it('refuses an angle before there is a main photo to go with it', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const { cookie } = await loginAs('staffer', 'a-real-password-1');
    const id = await productWithOriginal(cookie!);
    const res = await request(app).post(`/api/products/${id}/angle`).set('Cookie', cookie!).send({ imageBase64: tinyJpeg });
    expect(res.status).toBe(400);
  });

  it('stores the angle alongside the original and requeues the piece', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const { cookie } = await loginAs('staffer', 'a-real-password-1');
    const id = await productWithOriginal(cookie!);
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie!).send({ imageBase64: tinyJpeg });

    const res = await request(app).post(`/api/products/${id}/angle`).set('Cookie', cookie!).send({ imageBase64: tinyJpeg });
    expect(res.status).toBe(202);
    expect(res.body.product.status).toBe('queued');
    expect(res.body.product.anglePhotoIds).toHaveLength(1);
    // The original is untouched - the angle is added, not a replacement.
    expect(res.body.product.originalPhotoId).toBeTruthy();
  });

  it('"Process anyway" queues a job told not to ask for an angle again', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const { cookie } = await loginAs('staffer', 'a-real-password-1');
    const id = await productWithOriginal(cookie!);
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie!).send({ imageBase64: tinyJpeg });

    const res = await request(app).post(`/api/products/${id}/requeue`).set('Cookie', cookie!).send({ proceedWithoutAngle: true });
    expect(res.status).toBe(202);
    const job = getDb().prepare("SELECT payload FROM jobs WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(id) as { payload: string };
    expect(JSON.parse(job.payload)).toEqual({ skipAngleRequest: true });
  });
});

describe('net weight is worked out, never typed', () => {
  async function staff() {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    return (await loginAs('staffer', 'a-real-password-1')).cookie!;
  }

  it('saves gross minus other, ignoring any net sent with it', async () => {
    const cookie = await staff();
    const res = await request(app).post('/api/products').set('Cookie', cookie)
      .send({ itemType: 'Ring', grossWeightGrams: '12.345', otherWeightGrams: '0.345', netWeightGrams: '99' });
    expect(res.status).toBe(201);
    expect(res.body.product.netWeightGrams).toBe('12.000');
  });

  it('uses the gross as the net when there is no other weight', async () => {
    const cookie = await staff();
    const res = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Ring', grossWeightGrams: '5.5' });
    expect(res.body.product.netWeightGrams).toBe('5.500');
  });

  it('recomputes the net when either weight is edited later', async () => {
    const cookie = await staff();
    const created = await request(app).post('/api/products').set('Cookie', cookie)
      .send({ itemType: 'Ring', grossWeightGrams: '10', otherWeightGrams: '1' });
    const id = created.body.product.id;
    const res = await request(app).patch(`/api/products/${id}`).set('Cookie', cookie).send({ grossWeightGrams: '11' });
    expect(res.body.product.netWeightGrams).toBe('10.000');
    const hand = await request(app).patch(`/api/products/${id}`).set('Cookie', cookie).send({ netWeightGrams: '1' });
    expect(hand.body.product.netWeightGrams).toBe('10.000');
  });

  it('refuses an other weight above the gross', async () => {
    const cookie = await staff();
    const res = await request(app).post('/api/products').set('Cookie', cookie)
      .send({ itemType: 'Ring', grossWeightGrams: '1', otherWeightGrams: '2' });
    expect(res.status).toBe(400);
  });
});

describe('one-tap fix', () => {
  const tinyJpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

  async function pieceInReview() {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const cookie = (await loginAs('staffer', 'a-real-password-1')).cookie!;
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'ATTACHED CHAIN POTE' });
    const id = created.body.product.id as string;
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: tinyJpeg });
    getDb().prepare("UPDATE products SET status = 'awaiting_review' WHERE id = ?").run(id);
    return { cookie, id };
  }

  const latestJobPayload = (id: string) =>
    JSON.parse((getDb().prepare('SELECT payload FROM jobs WHERE product_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(id) as { payload: string }).payload);

  it('requeues the piece with exactly the fixes asked for, and remembers them for the style', async () => {
    const { cookie, id } = await pieceInReview();
    const res = await request(app).post(`/api/products/${id}/fix`).set('Cookie', cookie)
      .send({ issues: ['black_beads', 'made-up-code'], note: ' 7 drops,\n not 5 ' });
    expect(res.status).toBe(202);
    expect(res.body.product.status).toBe('queued');
    expect(latestJobPayload(id)).toEqual({ fix: { issues: ['black_beads'], note: '7 drops, not 5' }, skipAngleRequest: true });
    const memory = getDb().prepare('SELECT style_key, category, issues, source FROM fix_requests WHERE product_id = ?').get(id);
    expect(memory).toEqual({ style_key: 'attached chain pote', category: 'Mangalsutra', issues: '["black_beads"]', source: 'staff' });
  });

  it('"use my real photo" queues a cut-out instead of an AI render', async () => {
    const { cookie, id } = await pieceInReview();
    const res = await request(app).post(`/api/products/${id}/fix`).set('Cookie', cookie).send({ issues: ['real_photo'] });
    expect(res.status).toBe(202);
    expect(latestJobPayload(id)).toEqual({ mode: 'faithful' });
  });

  it('needs to be told what is wrong', async () => {
    const { cookie, id } = await pieceInReview();
    const res = await request(app).post(`/api/products/${id}/fix`).set('Cookie', cookie).send({ issues: [] });
    expect(res.status).toBe(400);
  });

  it('does not stack a fix on a piece that is already processing', async () => {
    const { cookie, id } = await pieceInReview();
    getDb().prepare("UPDATE products SET status = 'processing' WHERE id = ?").run(id);
    const res = await request(app).post(`/api/products/${id}/fix`).set('Cookie', cookie).send({ issues: ['motif'] });
    expect(res.status).toBe(409);
  });

  it('remembers the reason given when a piece is sent for reshoot', async () => {
    const { cookie, id } = await pieceInReview();
    await request(app).post(`/api/products/${id}/reject`).set('Cookie', cookie).send({ note: 'hook is missing' });
    const row = getDb().prepare('SELECT note, source FROM fix_requests WHERE product_id = ?').get(id);
    expect(row).toEqual({ note: 'hook is missing', source: 'reject' });
  });
});

describe('client event logging', () => {
  it('keeps the fields the browser sends', async () => {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    const cookie = (await loginAs('staffer', 'a-real-password-1')).cookie!;
    await request(app).post('/api/log-event').set('Cookie', cookie)
      .send({ events: [{ type: 'js_error', data: { message: 'boom', line: 12 } }] });
    const row = getDb().prepare("SELECT payload FROM events WHERE type = 'client.js_error'").get() as { payload: string };
    expect(JSON.parse(row.payload)).toMatchObject({ message: 'boom', line: 12 });
  });
});
