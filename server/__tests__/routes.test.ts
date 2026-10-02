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
import { getProduct } from '../db/products';
import { config } from '../config';

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

describe('duplicate CPC prevention', () => {
  async function staff() {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    return (await loginAs('staffer', 'a-real-password-1')).cookie!;
  }

  it('refuses a second product for a CPC already in progress', async () => {
    const cookie = await staff();
    const first = await request(app).post('/api/products').set('Cookie', cookie).send({ cpc: '1516L350', itemType: 'Pendant' });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/products').set('Cookie', cookie).send({ cpc: '1516l350', itemType: 'Pendant' });
    expect(second.status).toBe(409);
    expect(second.body.existingProductId).toBe(first.body.product.id);
  });

  it('allows a fresh shoot once the earlier one is approved or exported', async () => {
    const cookie = await staff();
    const first = await request(app).post('/api/products').set('Cookie', cookie).send({ cpc: '1516L351', itemType: 'Pendant' });
    getDb().prepare("UPDATE products SET status = 'approved' WHERE id = ?").run(first.body.product.id);

    const second = await request(app).post('/api/products').set('Cookie', cookie).send({ cpc: '1516L351', itemType: 'Pendant' });
    expect(second.status).toBe(201);
  });

  it('the CPC lookup surfaces the same duplicate before anyone submits', async () => {
    const cookie = await staff();
    await request(app).post('/api/products').set('Cookie', cookie).send({ cpc: '1516L352', itemType: 'Ring' });
    const res = await request(app).get('/api/cpc-lookup?cpc=1516L352').set('Cookie', cookie);
    expect(res.body.activeDuplicate?.itemType).toBe('Ring');
  });
});

describe('bulk delete', () => {
  async function staff() {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    return (await loginAs('staffer', 'a-real-password-1')).cookie!;
  }

  it('deletes pending items and skips approved/exported ones, even if asked to delete them', async () => {
    const cookie = await staff();
    const pending = await request(app).post('/api/products').set('Cookie', cookie).send({ cpc: '9001L1', itemType: 'Ring' });
    const approved = await request(app).post('/api/products').set('Cookie', cookie).send({ cpc: '9001L2', itemType: 'Ring' });
    getDb().prepare("UPDATE products SET status = 'approved' WHERE id = ?").run(approved.body.product.id);

    const res = await request(app).post('/api/products/bulk-delete').set('Cookie', cookie)
      .send({ ids: [pending.body.product.id, approved.body.product.id, 'not-a-real-id'] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(res.body.skipped).toEqual([approved.body.product.id]);
    expect(getProduct(pending.body.product.id)).toBeNull();
    expect(getProduct(approved.body.product.id)).not.toBeNull();
  });

  it('needs at least one id', async () => {
    const cookie = await staff();
    const res = await request(app).post('/api/products/bulk-delete').set('Cookie', cookie).send({ ids: [] });
    expect(res.status).toBe(400);
  });
});

describe('Drive export queues jobs instead of uploading inline', () => {
  async function staff() {
    await createUser({ username: 'staffer', password: 'a-real-password-1', isAdmin: false });
    return (await loginAs('staffer', 'a-real-password-1')).cookie!;
  }

  async function currentBatchId(cookie: string): Promise<string> {
    const res = await request(app).get('/api/batches/current').set('Cookie', cookie);
    return res.body.batch.id as string;
  }

  async function approvedProduct(cookie: string, cpc: string, batchId: string) {
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ cpc, itemType: 'Ring', batchId });
    getDb().prepare("UPDATE products SET status = 'approved' WHERE id = ?").run(created.body.product.id);
    return created.body.product.id as string;
  }

  function driveExportJobs(productId: string) {
    return getDb().prepare("SELECT status FROM jobs WHERE product_id = ? AND type = 'drive_export'").all(productId) as { status: string }[];
  }

  it('is unavailable when Drive is not configured', async () => {
    const cookie = await staff();
    const batchId = await currentBatchId(cookie);
    await approvedProduct(cookie, '9101L1', batchId);
    const res = await request(app).post(`/api/export/batch/${batchId}/drive`).set('Cookie', cookie).send({});
    expect(res.status).toBe(503);
  });

  describe('with Drive configured', () => {
    beforeAll(() => {
      // Mutating the already-loaded config object directly - isDriveConfigured()
      // reads config.drive at call time, and no real network call ever happens
      // in this suite (createApp() never starts a worker, so a queued
      // drive_export job just sits there, exactly what these tests check).
      config.drive.clientId = 'test-client-id';
      config.drive.clientSecret = 'test-client-secret';
      config.drive.refreshToken = 'test-refresh-token';
      config.drive.rootFolderId = 'test-root-folder';
    });
    afterAll(() => {
      config.drive.clientId = undefined;
      config.drive.clientSecret = undefined;
      config.drive.refreshToken = undefined;
      config.drive.rootFolderId = undefined;
    });

    it('queues a job per approved product, and reports already-exported ones separately', async () => {
      const cookie = await staff();
      const batchId = await currentBatchId(cookie);
      const approvedId = await approvedProduct(cookie, '9102L1', batchId);
      const exportedId = await approvedProduct(cookie, '9102L2', batchId);
      getDb().prepare("UPDATE products SET status = 'exported' WHERE id = ?").run(exportedId);

      const res = await request(app).post(`/api/export/batch/${batchId}/drive`).set('Cookie', cookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.enqueued).toBe(1);
      expect(res.body.alreadyExported).toBe(1);
      expect(driveExportJobs(approvedId)).toHaveLength(1);
      expect(driveExportJobs(approvedId)[0].status).toBe('queued');
      expect(driveExportJobs(exportedId)).toHaveLength(0);
    });

    it('does not double-queue a product whose export is still queued or running', async () => {
      const cookie = await staff();
      const batchId = await currentBatchId(cookie);
      const productId = await approvedProduct(cookie, '9103L1', batchId);

      const first = await request(app).post(`/api/export/batch/${batchId}/drive`).set('Cookie', cookie).send({});
      expect(first.body.enqueued).toBe(1);

      // Product status is still 'approved' at this point - nothing ran the
      // job - so without the in-flight-job check this would queue a second
      // upload of the exact same photo.
      const second = await request(app).post(`/api/export/batch/${batchId}/drive`).set('Cookie', cookie).send({});
      expect(second.body.enqueued).toBe(0);
      expect(driveExportJobs(productId)).toHaveLength(1);
    });

    it('queues a product again after its previous export job failed', async () => {
      const cookie = await staff();
      const batchId = await currentBatchId(cookie);
      const productId = await approvedProduct(cookie, '9104L1', batchId);

      await request(app).post(`/api/export/batch/${batchId}/drive`).set('Cookie', cookie).send({});
      getDb().prepare("UPDATE jobs SET status = 'failed' WHERE product_id = ? AND type = 'drive_export'").run(productId);

      const retry = await request(app).post(`/api/export/batch/${batchId}/drive`).set('Cookie', cookie).send({});
      expect(retry.body.enqueued).toBe(1);
      expect(driveExportJobs(productId)).toHaveLength(2);
    });

    it('drive-status reports queued/running/succeeded from job and product state', async () => {
      const cookie = await staff();
      const batchId = await currentBatchId(cookie);
      await approvedProduct(cookie, '9105L1', batchId);
      const runningId = await approvedProduct(cookie, '9105L2', batchId);
      const succeededId = await approvedProduct(cookie, '9105L3', batchId);

      await request(app).post(`/api/export/batch/${batchId}/drive`).set('Cookie', cookie).send({});
      getDb().prepare("UPDATE jobs SET status = 'running' WHERE product_id = ? AND type = 'drive_export'").run(runningId);
      getDb().prepare("DELETE FROM jobs WHERE product_id = ? AND type = 'drive_export'").run(succeededId);
      getDb().prepare("UPDATE products SET status = 'exported' WHERE id = ?").run(succeededId);

      const res = await request(app).get(`/api/export/batch/${batchId}/drive-status`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.queued).toBe(1);
      expect(res.body.running).toBe(1);
      expect(res.body.succeeded).toBe(1);
      expect(res.body.inProgress).toBe(2);
    });
  });
});
