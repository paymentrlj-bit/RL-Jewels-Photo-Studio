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
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser } from '../auth/users';
import { getProduct } from '../db/products';
import { saveImage } from '../storage/images';
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
  db.exec('DELETE FROM product_vectors; DELETE FROM fix_requests; DELETE FROM jobs; DELETE FROM photos; DELETE FROM products; DELETE FROM batches; DELETE FROM users; DELETE FROM login_attempts; DELETE FROM events;');
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

describe('real photo beside the AI render', () => {
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

  it('shows the cut-out next to an AI render and lets the reviewer switch to it', async () => {
    await createUser({ username: 'cutter', password: 'a-real-password-1', isAdmin: false });
    const cookie = (await loginAs('cutter', 'a-real-password-1')).cookie!;
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Ring' });
    const id = created.body.product.id as string;
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg });
    saveImage({ productId: id, kind: 'processed', data: jpeg, source: 'upload' });
    const cut = saveImage({ productId: id, kind: 'cutout', data: jpeg, source: 'faithful' });

    const list = await request(app).get(`/api/products/${id}`).set('Cookie', cookie);
    expect(list.body.product.renderMode).toBe('ai');
    expect(list.body.product.cutoutPhotoId).toBe(cut.id);

    const res = await request(app).post(`/api/products/${id}/use-cutout`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    // Now the catalogue photo IS the real photo, so there is nothing left to compare.
    expect(res.body.product.renderMode).toBe('faithful');
    expect(res.body.product.cutoutPhotoId).toBeNull();
  });

  it('refuses when there is no cut-out', async () => {
    await createUser({ username: 'nocut', password: 'a-real-password-1', isAdmin: false });
    const cookie = (await loginAs('nocut', 'a-real-password-1')).cookie!;
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Ring' });
    const res = await request(app).post(`/api/products/${created.body.product.id}/use-cutout`).set('Cookie', cookie);
    expect(res.status).toBe(400);
  });
});

describe('sharing and the Meta catalogue feed', () => {
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const cfg = config as { metaFeedKey: string; publicBaseUrl: string };

  async function approvedProduct(price?: string) {
    await createUser({ username: 'sharer', password: 'a-real-password-1', isAdmin: false });
    const cookie = (await loginAs('sharer', 'a-real-password-1')).cookie!;
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Jhumka', cpc: 'SH1' });
    const id = created.body.product.id as string;
    const photo = saveImage({ productId: id, kind: 'processed', data: jpeg, source: 'upload' });
    await request(app).patch(`/api/products/${id}`).set('Cookie', cookie).send({ name: 'Peacock Meenakari Jhumka', description: 'A jhumka.', ...(price ? { priceInr: price } : {}) });
    getDb().prepare("UPDATE products SET status = 'approved' WHERE id = ?").run(id);
    return { cookie, id, photoId: photo.id };
  }

  it('keeps the feed off until a key is set, and answers 404 either way to a wrong key', async () => {
    cfg.metaFeedKey = '';
    expect((await request(app).get('/feeds/meta-catalog.csv?key=anything')).status).toBe(404);
    cfg.metaFeedKey = 'secret-feed-key';
    expect((await request(app).get('/feeds/meta-catalog.csv?key=wrong')).status).toBe(404);
    expect((await request(app).get('/feeds/meta-catalog.csv')).status).toBe(404);
  });

  it('lists only approved products that have a price, with a signed photo link', async () => {
    cfg.metaFeedKey = 'secret-feed-key';
    cfg.publicBaseUrl = 'https://studio.example.com';
    const { photoId } = await approvedProduct('₹45,000');
    const res = await request(app).get('/feeds/meta-catalog.csv?key=secret-feed-key');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/^id,title,description,availability,condition,price,link,image_link,brand,product_type/);
    expect(res.text).toMatch(/SH1,Peacock Meenakari Jhumka,A jhumka\.,in stock,new,45000\.00 INR,/);
    const link = /(https:\/\/studio\.example\.com\/public\/photo\/[^,\r\n]+)/.exec(res.text)![1];
    // The link works with no login; a tampered token does not.
    expect((await request(app).get(link.replace('https://studio.example.com', ''))).status).toBe(200);
    expect((await request(app).get(`/public/photo/${photoId}/not-the-token`)).status).toBe(404);
  });

  it('leaves out a product with no price rather than guessing one', async () => {
    cfg.metaFeedKey = 'secret-feed-key';
    await approvedProduct();
    const res = await request(app).get('/feeds/meta-catalog.csv?key=secret-feed-key');
    expect(res.text.trim().split('\r\n')).toHaveLength(1);
  });

  it('only takes a price that is a whole number of rupees', async () => {
    const { cookie, id } = await approvedProduct();
    expect((await request(app).patch(`/api/products/${id}`).set('Cookie', cookie).send({ priceInr: 'a lot' })).status).toBe(400);
    const ok = await request(app).patch(`/api/products/${id}`).set('Cookie', cookie).send({ priceInr: 'Rs. 1,25,000' });
    expect(ok.body.product.priceInr).toBe('125000');
  });
});

describe('look-alike search', () => {
  async function photoOf(bar: boolean) {
    const sharp = (await import('sharp')).default;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="100%" height="100%" fill="#222244"/>${bar
      ? '<rect x="40" y="130" width="220" height="40" fill="#c9a227"/>'
      : '<circle cx="150" cy="150" r="70" fill="none" stroke="#c9a227" stroke-width="22"/>'}</svg>`;
    return 'data:image/jpeg;base64,' + (await sharp(Buffer.from(svg)).jpeg().toBuffer()).toString('base64');
  }

  it('warns before shooting a design that is already in the system, and says nothing for a new one', async () => {
    await createUser({ username: 'looker', password: 'a-real-password-1', isAdmin: false });
    const cookie = (await loginAs('looker', 'a-real-password-1')).cookie!;
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Pendant', name: 'Ring pendant' });
    const id = created.body.product.id as string;
    const ring = await photoOf(false);
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: ring });
    await new Promise((r) => setTimeout(r, 400)); // the fingerprint is made in the background

    const same = await request(app).post('/api/similar/check').set('Cookie', cookie).send({ imageBase64: ring });
    expect(same.status).toBe(200);
    expect(same.body.matches[0]).toMatchObject({ productId: id, tier: 'same', name: 'Ring pendant' });

    const other = await request(app).post('/api/similar/check').set('Cookie', cookie).send({ imageBase64: await photoOf(true) });
    expect(other.body.matches).toEqual([]);

    const mine = await request(app).get(`/api/products/${id}/similar`).set('Cookie', cookie);
    expect(mine.status).toBe(200);
  });

  it('does not stop a shoot when the photo cannot be read', async () => {
    await createUser({ username: 'looker2', password: 'a-real-password-1', isAdmin: false });
    const cookie = (await loginAs('looker2', 'a-real-password-1')).cookie!;
    const res = await request(app).post('/api/similar/check').set('Cookie', cookie).send({ imageBase64: 'data:image/jpeg;base64,AAAA' });
    expect(res.status).toBe(200);
    expect(res.body.matches).toEqual([]);
  });
});

describe('roles', () => {
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

  async function as(role: 'photographer' | 'manager' | 'admin', name: string) {
    await createUser({ username: name, password: 'a-real-password-1', isAdmin: role === 'admin', role: role === 'admin' ? undefined : role });
    return (await loginAs(name, 'a-real-password-1')).cookie!;
  }
  async function pieceIn(cookie: string, status: string) {
    const created = await request(app).post('/api/products').set('Cookie', cookie).send({ itemType: 'Ring' });
    const id = created.body.product.id as string;
    await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg });
    getDb().prepare('UPDATE products SET status = ? WHERE id = ?').run(status, id);
    return id;
  }

  it('lets a photographer fix, send back and delete, but not approve, export or touch an approved piece', async () => {
    const photog = await as('photographer', 'photog');
    const id = await pieceIn(photog, 'awaiting_review');
    expect((await request(app).post(`/api/products/${id}/approve`).set('Cookie', photog)).status).toBe(403);
    const batchId = (await request(app).get('/api/batches/current').set('Cookie', photog)).body.batch.id;
    expect((await request(app).get(`/api/export/batch/${batchId}/csv`).set('Cookie', photog)).status).toBe(403);
    expect((await request(app).post(`/api/products/${id}/fix`).set('Cookie', photog).send({ issues: ['beads'] })).status).toBe(202);
    getDb().prepare("UPDATE products SET status = 'awaiting_review' WHERE id = ?").run(id);
    expect((await request(app).post(`/api/products/${id}/reject`).set('Cookie', photog).send({ note: 'blurry' })).status).toBe(200);
    expect((await request(app).delete(`/api/products/${id}`).set('Cookie', photog)).status).toBe(200);
    const approved = await pieceIn(photog, 'approved');
    expect((await request(app).post(`/api/products/${approved}/reject`).set('Cookie', photog).send({})).status).toBe(403);
  });

  it('lets a photographer correct what they typed, but not the price or copy', async () => {
    const photog = await as('photographer', 'photog2');
    const id = await pieceIn(photog, 'awaiting_review');
    expect((await request(app).patch(`/api/products/${id}`).set('Cookie', photog).send({ itemType: 'Kada' })).status).toBe(200);
    expect((await request(app).patch(`/api/products/${id}`).set('Cookie', photog).send({ priceInr: '5000' })).status).toBe(403);
    expect((await request(app).patch(`/api/products/${id}`).set('Cookie', photog).send({ name: 'Mine' })).status).toBe(403);
  });

  it('lets a manager approve, and only an admin send back an approved piece', async () => {
    const mgr = await as('manager', 'mgr');
    const admin = await as('admin', 'boss');
    const id = await pieceIn(mgr, 'awaiting_review');
    expect((await request(app).post(`/api/products/${id}/approve`).set('Cookie', mgr)).status).toBe(200);
    expect((await request(app).post(`/api/products/${id}/reject`).set('Cookie', mgr).send({ note: 'x' })).status).toBe(403);
    const back = await request(app).post(`/api/products/${id}/reject`).set('Cookie', admin).send({ note: 'background is grey' });
    expect(back.status).toBe(200);
    expect(back.body.product.status).toBe('needs_reshoot');
  });

  it('gives new accounts the photographer role unless an admin says otherwise, and reports it at sign-in', async () => {
    const admin = await as('admin', 'boss2');
    const made = await request(app).post('/api/admin/users').set('Cookie', admin).send({ username: 'newbie', password: 'a-real-password-1' });
    expect(made.body.user.role).toBe('photographer');
    const session = await request(app).get('/api/session').set('Cookie', (await loginAs('newbie', 'a-real-password-1')).cookie!);
    expect(session.body.role).toBe('photographer');
    const promoted = await request(app).patch(`/api/admin/users/${made.body.user.id}`).set('Cookie', admin).send({ role: 'manager' });
    expect(promoted.body.user.role).toBe('manager');
  });
});

describe('daily summary and the retake list', () => {
  it('gives admins today\'s numbers and keeps them from everyone else', async () => {
    await createUser({ username: 'boss3', password: 'a-real-password-1', isAdmin: true });
    await createUser({ username: 'shooter', password: 'a-real-password-1', role: 'photographer' });
    const admin = (await loginAs('boss3', 'a-real-password-1')).cookie!;
    const shooter = (await loginAs('shooter', 'a-real-password-1')).cookie!;
    await request(app).post('/api/products').set('Cookie', shooter).send({ itemType: 'Ring' });
    getDb().prepare("UPDATE products SET status = 'needs_reshoot'").run();
    const res = await request(app).get('/api/admin/daily-summary').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ shot: 1, toRetake: 1 });
    expect(res.body.text).toMatch(/Shot today: 1/);
    expect((await request(app).get('/api/admin/daily-summary').set('Cookie', shooter)).status).toBe(403);
  });
});

describe('Telegram delivery of the daily summary', () => {
  const TOKEN = '123456789:AAFabcdefghijklmnopqrstuvwxyz_0123456';

  afterAll(() => vi.unstubAllGlobals());

  it('keeps the token secret, checks it works, finds chats and sends', async () => {
    await createUser({ username: 'tgboss', password: 'a-real-password-1', isAdmin: true });
    const cookie = (await loginAs('tgboss', 'a-real-password-1')).cookie!;
    getDb().prepare("DELETE FROM settings WHERE key LIKE 'telegram_%'").run();
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body || '{}');
      calls.push({ url, body });
      const result = url.endsWith('/getMe') ? { username: 'RLJSTUDIO_BOT' }
        : url.endsWith('/getUpdates') ? [{ message: { chat: { id: -100123, type: 'group', title: 'Managers' } } }, { message: { chat: { id: -100123, type: 'group', title: 'Managers' } } }]
        : {};
      return { ok: true, json: async () => ({ ok: true, result }) };
    }));

    const bad = await request(app).put('/api/admin/telegram').set('Cookie', cookie).send({ token: 'nonsense' });
    expect(bad.status).toBe(400);

    const saved = await request(app).put('/api/admin/telegram').set('Cookie', cookie).send({ token: TOKEN });
    expect(saved.status).toBe(200);
    expect(saved.body.botName).toBe('@RLJSTUDIO_BOT');
    expect(JSON.stringify(saved.body)).not.toContain(TOKEN);
    expect((await request(app).get('/api/admin/telegram').set('Cookie', cookie)).text).not.toContain(TOKEN);

    const chats = await request(app).get('/api/admin/telegram/chats').set('Cookie', cookie);
    expect(chats.body.chats).toEqual([{ id: '-100123', title: 'Managers', type: 'group' }]);

    expect((await request(app).post('/api/admin/telegram/test').set('Cookie', cookie)).status).toBe(400); // no chat chosen yet
    await request(app).put('/api/admin/telegram').set('Cookie', cookie).send({ chatId: '-100123', hour: 20 });
    const test = await request(app).post('/api/admin/telegram/test').set('Cookie', cookie);
    expect(test.status).toBe(200);
    const sent = calls.find((c) => c.url.endsWith('/sendMessage'))!;
    expect(sent.body.chat_id).toBe('-100123');
    expect(String(sent.body.text)).toMatch(/Shot today/);
    expect(String(sent.body.text)).not.toContain('*');
  });

  it('does not give the token away when Telegram refuses it', async () => {
    await createUser({ username: 'tgboss2', password: 'a-real-password-1', isAdmin: true });
    const cookie = (await loginAs('tgboss2', 'a-real-password-1')).cookie!;
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error(`boom for https://api.telegram.org/bot${TOKEN}/getUpdates`); }));
    const res = await request(app).get('/api/admin/telegram/chats').set('Cookie', cookie);
    expect(res.status).toBe(400);
    expect(res.text).not.toContain(TOKEN);
  });

  it('is for admins only', async () => {
    await createUser({ username: 'tgmgr', password: 'a-real-password-1', role: 'manager' });
    const cookie = (await loginAs('tgmgr', 'a-real-password-1')).cookie!;
    expect((await request(app).get('/api/admin/telegram').set('Cookie', cookie)).status).toBe(403);
  });
});

describe('daily shoot batches', () => {
  it('puts everyone\'s shots from the same day in one batch named for that day', async () => {
    await createUser({ username: 'a1', password: 'a-real-password-1', isAdmin: false });
    await createUser({ username: 'b1', password: 'a-real-password-1', isAdmin: false });
    const ca = (await loginAs('a1', 'a-real-password-1')).cookie!;
    const cb = (await loginAs('b1', 'a-real-password-1')).cookie!;
    const p1 = await request(app).post('/api/products').set('Cookie', ca).send({ itemType: 'Ring', batchId: 'stale-batch-id' });
    const p2 = await request(app).post('/api/products').set('Cookie', cb).send({ itemType: 'Ring' });
    expect(p1.body.product.batchId).toBe(p2.body.product.batchId);
    const batch = (await request(app).get('/api/batches/current').set('Cookie', ca)).body.batch;
    expect(batch.id).toBe(p1.body.product.batchId);
    expect(batch.name).toMatch(/^Shoot \d{1,2}\/\d{1,2}\/\d{4}$/);
  });
});

describe('re-homing old shoots by date', () => {
  it('moves a product shot on a later day out of an old batch into a batch for its own day, once', async () => {
    const user = await createUser({ username: 'rehome', password: 'a-real-password-1', isAdmin: false });
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key = 'batches_rehomed_v1'").run();
    db.prepare("INSERT INTO batches (id, name, created_by, created_at) VALUES ('bch_old', 'Shoot 17/9/2026', ?, '2026-09-17T05:00:00.000Z')").run(user.id);
    const mk = (id: string, at: string) => db.prepare("INSERT INTO products (id, batch_id, created_by, created_at, updated_at, status) VALUES (?, 'bch_old', ?, ?, ?, 'approved')").run(id, user.id, at, at);
    mk('prd_same_day', '2026-09-17T06:00:00.000Z');
    mk('prd_later', '2026-10-04T05:30:00.000Z');
    const { rehomeProductsByShootDate } = await import('../db/products');
    expect(rehomeProductsByShootDate().moved).toBe(1);
    const later = db.prepare("SELECT b.name FROM products p JOIN batches b ON b.id = p.batch_id WHERE p.id = 'prd_later'").get() as { name: string };
    expect(later.name).toBe('Shoot 4/10/2026');
    const same = db.prepare("SELECT batch_id FROM products WHERE id = 'prd_same_day'").get() as { batch_id: string };
    expect(same.batch_id).toBe('bch_old');
    expect(rehomeProductsByShootDate().moved).toBe(0);
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
