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
  db.exec('DELETE FROM users; DELETE FROM login_attempts; DELETE FROM events;');
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
