// Things found in a day's logs: a photographer's activity log was being refused (403), the
// strong grader was silently standing in for by the cheap one, and a gold chain photographed
// for a "pote" was treated as the wrong product.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser } from '../auth/users';
import { compareIdentity, type PieceIdentity } from '../ai/identity';
import { buildOutputFramingBlock } from '../ai/prompts';

const identity = (family: PieceIdentity['family']): PieceIdentity => ({ family, description: 'x', pieceCount: 1, hasBlackBeads: false, tags: [], confidence: 'high' });

describe('who may call what', () => {
  let app: express.Express;
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-found-test-'));
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

  it('lets a photographer send their activity log, while Export stays for managers', async () => {
    await createUser({ username: 'photog', password: 'a-real-password-1', isAdmin: false, role: 'photographer' });
    const cookie = (await request(app).post('/api/login').send({ username: 'photog', password: 'a-real-password-1' })).headers['set-cookie']![0];
    const log = await request(app).post('/api/log-event').set('Cookie', cookie).send({ events: [{ type: 'shoot_check_confirmed', data: { itemType: 'Haar' } }] });
    expect(log.status).toBe(200);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'client.shoot_check_confirmed'").get()).toEqual({ n: 1 });
    expect((await request(app).get('/api/export/mappings').set('Cookie', cookie)).status).toBe(403);
    expect((await request(app).get('/api/export/drive-status').set('Cookie', cookie)).status).toBe(403);
  });

  it('still asks for a sign-in on Export', async () => {
    expect((await request(app).get('/api/export/mappings')).status).toBe(401);
  });
});

describe('a photo of a neck piece under another neck-piece name', () => {
  it('is not sent back for another photo: a pote can be a plain gold chain, a padak a mangalsutra pendant', () => {
    expect(compareIdentity('ATTACHED CHAIN POTE', identity('neckpiece')).status).toBe('match');
    expect(compareIdentity('PADAK', identity('mangalsutra')).status).toBe('match');
    expect(compareIdentity('Haar', identity('mangalsutra')).status).toBe('match');
  });

  it('still catches a real mix-up', () => {
    expect(compareIdentity('Jhumka', identity('neckpiece')).status).toBe('mismatch');
    expect(compareIdentity('Haar', identity('earring')).status).toBe('mismatch');
    expect(compareIdentity('Ring', identity('wrist')).status).toBe('mismatch');
  });
});

describe('long pieces', () => {
  it('are told to fit inside the frame, in a U or V drape if they are too long to hang straight', () => {
    const block = buildOutputFramingBlock('3:4', 'ATTACHED CHAIN POTE');
    expect(block).toMatch(/INSIDE the frame/);
    expect(block).toMatch(/U or V/);
    expect(block).toMatch(/do NOT coil, shorten, fold/i);
  });
});
