// A switched-off account says so - but only to someone who knows its password.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser, setUserActive, findUserByUsername } from '../auth/users';

let app: express.Express;
let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-inactive-test-'));
  initDatabase(path.join(dir, 'test.db'));
  app = createApp();
});
afterAll(() => {
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  getDb().exec('DELETE FROM users; DELETE FROM login_attempts; DELETE FROM events;');
});

describe('login for a switched-off account', () => {
  it('tells the right password it is switched off, and a wrong one nothing extra', async () => {
    await createUser({ username: 'vijay', password: 'a-real-password-1', role: 'photographer' });
    setUserActive(findUserByUsername('vijay')!.id, false);

    const right = await request(app).post('/api/login').send({ username: 'Vijay', password: 'a-real-password-1' });
    expect(right.status).toBe(403);
    expect(right.body.error).toMatch(/switched off/i);

    const wrong = await request(app).post('/api/login').send({ username: 'vijay', password: 'nope-nope-nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).not.toMatch(/switched off/i);
  });
});

describe('admin password reset', () => {
  it('lets the person sign in with the new password and not the old one', async () => {
    await createUser({ username: 'boss', password: 'a-real-password-1', isAdmin: true });
    await createUser({ username: 'Vijay', password: 'a-real-password-1', role: 'photographer' });
    const login = await request(app).post('/api/login').send({ username: 'boss', password: 'a-real-password-1' });
    const cookie = login.headers['set-cookie']![0];
    const target = findUserByUsername('Vijay')!;

    const reset = await request(app).patch(`/api/admin/users/${target.id}`).set('Cookie', cookie).send({ password: 'Vijay@2026gold' });
    expect(reset.status).toBe(200);

    expect((await request(app).post('/api/login').send({ username: 'vijay', password: 'a-real-password-1' })).status).toBe(401);
    expect((await request(app).post('/api/login').send({ username: 'vijay', password: 'Vijay@2026gold' })).status).toBe(200);
  });
});

describe('stray spaces and changing your own password', () => {
  it('accepts a password pasted with a trailing space, before and after a reset', async () => {
    await createUser({ username: 'boss', password: 'a-real-password-1', isAdmin: true });
    await createUser({ username: 'Vijay', password: 'a-real-password-1', role: 'photographer' });
    const cookie = (await request(app).post('/api/login').send({ username: 'boss', password: 'a-real-password-1' })).headers['set-cookie']![0];
    const target = findUserByUsername('Vijay')!;
    await request(app).patch(`/api/admin/users/${target.id}`).set('Cookie', cookie).send({ password: 'Vijay@2026gold \n' });
    expect((await request(app).post('/api/login').send({ username: 'vijay', password: 'Vijay@2026gold' })).status).toBe(200);
    expect((await request(app).post('/api/login').send({ username: 'vijay', password: ' Vijay@2026gold ' })).status).toBe(200);
  });

  it('lets a signed-in person change their own password, but only with the current one', async () => {
    await createUser({ username: 'Vijay', password: 'a-real-password-1', role: 'photographer' });
    const cookie = (await request(app).post('/api/login').send({ username: 'Vijay', password: 'a-real-password-1' })).headers['set-cookie']![0];

    const bad = await request(app).post('/api/me/password').set('Cookie', cookie).send({ currentPassword: 'wrong-wrong-wrong', newPassword: 'Another-Pass-77' });
    expect(bad.status).toBe(400);

    const ok = await request(app).post('/api/me/password').set('Cookie', cookie).send({ currentPassword: 'a-real-password-1', newPassword: 'Another-Pass-77' });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/login').send({ username: 'Vijay', password: 'Another-Pass-77' })).status).toBe(200);
    expect((await request(app).post('/api/login').send({ username: 'Vijay', password: 'a-real-password-1' })).status).toBe(401);
  });
});
