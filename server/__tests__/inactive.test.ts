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
