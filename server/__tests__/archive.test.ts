// Delete means "archive": staff see the product vanish, the admin keeps it, with
// its photos and audit data, in the Archive tab. And the Share tab's category and
// weight filters.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import type express from 'express';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createApp } from '../index';
import { createUser } from '../auth/users';
import { createProduct, getProduct, setProductStatus } from '../db/products';
import { getLatestPhoto, imageExists } from '../storage/images';
import { categoryOf, matchesFilter, weightOf, parseWeightParam, categoryOptions } from '../catalog/filters';

let app: express.Express;
let dir: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-archive-test-'));
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

async function loginAs(username: string, role: 'admin' | 'manager' | 'photographer') {
  await createUser({ username, password: 'a-real-password-1', isAdmin: role === 'admin', role: role === 'admin' ? undefined : role });
  const res = await request(app).post('/api/login').send({ username, password: 'a-real-password-1' });
  return res.headers['set-cookie']![0];
}

async function shoot(cookie: string, body: Record<string, unknown> = { itemType: 'Haar' }) {
  const created = await request(app).post('/api/products').set('Cookie', cookie).send(body);
  const id = created.body.product.id as string;
  await request(app).post(`/api/products/${id}/photo`).set('Cookie', cookie).send({ imageBase64: jpeg });
  return id;
}

describe('delete is an archive', () => {
  it('tells staff it is gone and hides it everywhere they look', async () => {
    const staff = await loginAs('photog', 'photographer');
    const id = await shoot(staff, { cpc: '5551L1', itemType: 'Haar' });
    getDb().prepare("UPDATE products SET status = 'awaiting_review' WHERE id = ?").run(id);

    const res = await request(app).delete(`/api/products/${id}`).set('Cookie', staff);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect((await request(app).get('/api/products').set('Cookie', staff)).body.products).toHaveLength(0);
    expect((await request(app).get(`/api/products/${id}`).set('Cookie', staff)).status).toBe(404);
    expect((await request(app).get('/api/products').set('Cookie', staff)).body.counts.awaiting_review ?? 0).toBe(0);
    // The same tag can be shot again without a "already in the system" warning.
    expect((await request(app).post('/api/products').set('Cookie', staff).send({ cpc: '5551L1', itemType: 'Haar' })).status).toBe(201);
  });

  it('keeps the row and the photos, and cancels the job so it is never processed', async () => {
    const staff = await loginAs('photog', 'photographer');
    const id = await shoot(staff);
    const photo = getLatestPhoto(id, 'original')!;
    expect(getDb().prepare("SELECT status FROM jobs WHERE product_id = ?").get(id)).toEqual({ status: 'queued' });

    await request(app).delete(`/api/products/${id}`).set('Cookie', staff);

    expect(getProduct(id)).toBeNull();
    const row = getDb().prepare('SELECT archived_at, archived_by, archived_status FROM products WHERE id = ?').get(id) as { archived_at: string; archived_by: string; archived_status: string };
    expect(row.archived_at).toBeTruthy();
    expect(row.archived_by).toBeTruthy();
    expect(row.archived_status).toBe('queued');
    expect(getLatestPhoto(id, 'original')?.id).toBe(photo.id);
    expect(getDb().prepare("SELECT status FROM jobs WHERE product_id = ?").get(id)).toEqual({ status: 'failed' });
  });

  it('archives on bulk delete too, but still never touches an approved piece', async () => {
    const staff = await loginAs('mgr', 'manager');
    const pending = await shoot(staff);
    const approved = await shoot(staff, { cpc: '5552L1', itemType: 'Ring' });
    getDb().prepare("UPDATE products SET status = 'approved' WHERE id = ?").run(approved);
    const res = await request(app).post('/api/products/bulk-delete').set('Cookie', staff).send({ ids: [pending, approved] });
    expect(res.body.deleted).toBe(1);
    expect(getDb().prepare('SELECT archived_at FROM products WHERE id = ?').get(pending)).toEqual({ archived_at: expect.any(String) });
    expect(getProduct(approved)).not.toBeNull();
  });
});

describe('the admin Archive', () => {
  it('is for managers and admins, not photographers, and only an admin can erase', async () => {
    const photog = await loginAs('photog', 'photographer');
    const mgr = await loginAs('mgr', 'manager');
    const admin = await loginAs('boss', 'admin');
    const id = await shoot(photog);
    await request(app).delete(`/api/products/${id}`).set('Cookie', photog);

    expect((await request(app).get('/api/archive').set('Cookie', photog)).status).toBe(403);
    expect((await request(app).post(`/api/archive/${id}/restore`).set('Cookie', photog)).status).toBe(403);
    expect((await request(app).get('/api/archive').set('Cookie', mgr)).status).toBe(200);
    expect((await request(app).delete(`/api/archive/${id}`).set('Cookie', mgr)).status).toBe(403);
    expect((await request(app).delete(`/api/archive/${id}`).set('Cookie', admin)).status).toBe(200);
  });

  it('keeps the reason staff gave, and shows it with a summary', async () => {
    const staff = await loginAs('photog', 'photographer');
    const mgr = await loginAs('mgr', 'manager');
    const a = await shoot(staff);
    const b = await shoot(staff);
    const c = await shoot(staff);
    await request(app).delete(`/api/products/${a}`).set('Cookie', staff).send({ reason: 'ai_not_true' });
    await request(app).delete(`/api/products/${b}`).set('Cookie', staff).send({ reason: 'other', note: '  chain  looked   wrong  ' });
    await request(app).delete(`/api/products/${c}`).set('Cookie', staff).send({ reason: 'made-up' });

    const res = await request(app).get('/api/archive').set('Cookie', mgr);
    const byId = Object.fromEntries(res.body.items.map((i: { id: string }) => [i.id, i]));
    expect(byId[a]).toMatchObject({ reason: 'AI picture not true to the piece', reasonCode: 'ai_not_true', reasonNote: '' });
    expect(byId[b]).toMatchObject({ reason: 'Other', reasonNote: 'chain looked wrong' });
    // A code the app does not know is not stored as if it were one.
    expect(byId[c]).toMatchObject({ reason: 'No reason given', reasonCode: '' });
    expect(res.body.summary.byReason).toEqual(expect.arrayContaining([{ name: 'AI picture not true to the piece', count: 1 }, { name: 'Other', count: 1 }]));
  });

  it('gives bulk deletes one reason for all of them', async () => {
    const staff = await loginAs('mgr', 'manager');
    const x = await shoot(staff);
    const y = await shoot(staff);
    await request(app).post('/api/products/bulk-delete').set('Cookie', staff).send({ ids: [x, y], reason: 'test' });
    const res = await request(app).get('/api/archive').set('Cookie', staff);
    expect(res.body.items.map((i: { reasonCode: string }) => i.reasonCode)).toEqual(['test', 'test']);
  });

  it('shows what was deleted, who shot it, what the AI flagged, and a summary', async () => {
    const staff = await loginAs('photog', 'photographer');
    const admin = await loginAs('boss', 'admin');
    const id = await shoot(staff, { cpc: '5553L1', itemType: 'FANCY HAR SET', grossWeightGrams: '22.5' });
    getDb().prepare("UPDATE products SET status = 'awaiting_review', audit_reason = 'Chain pattern changed', audit_checklist = ?, estimated_cost_usd = 0.2, net_weight_grams = '22.500' WHERE id = ?")
      .run(JSON.stringify({ chainPatternMatches: false, sharpFocus: true }), id);
    await request(app).delete(`/api/products/${id}`).set('Cookie', staff);

    const res = await request(app).get('/api/archive').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    const item = res.body.items[0];
    expect(item).toMatchObject({ id, cpc: '5553L1', category: 'Haar', weightGrams: 22.5, staffName: 'photog', statusWhenDeleted: 'awaiting_review', auditReason: 'Chain pattern changed' });
    expect(item.failedChecks.map((c: { check: string }) => c.check)).toEqual(['chainPatternMatches']);
    expect(item.photos.original).toBeTruthy();
    expect(res.body.summary.total).toBe(1);
    expect(res.body.summary.byCategory).toEqual([{ name: 'Haar', count: 1 }]);
  });

  it('restores a product exactly as it was', async () => {
    const staff = await loginAs('photog', 'photographer');
    const admin = await loginAs('boss', 'admin');
    const id = await shoot(staff);
    await request(app).delete(`/api/products/${id}`).set('Cookie', staff);
    expect((await request(app).post(`/api/archive/${id}/restore`).set('Cookie', admin)).status).toBe(200);
    expect((await request(app).get(`/api/products/${id}`).set('Cookie', staff)).status).toBe(200);
    expect((await request(app).get('/api/archive').set('Cookie', admin)).body.items).toHaveLength(0);
  });

  it('erases only archived products, files included', async () => {
    const staff = await loginAs('photog', 'photographer');
    const admin = await loginAs('boss', 'admin');
    const live = await shoot(staff);
    expect((await request(app).delete(`/api/archive/${live}`).set('Cookie', admin)).status).toBe(404);
    expect(getProduct(live)).not.toBeNull();

    await request(app).delete(`/api/products/${live}`).set('Cookie', staff);
    const photo = getLatestPhoto(live, 'original')!;
    expect(imageExists(photo)).toBe(true);
    expect((await request(app).delete(`/api/archive/${live}`).set('Cookie', admin)).status).toBe(200);
    expect(getDb().prepare('SELECT id FROM products WHERE id = ?').get(live)).toBeUndefined();
    expect(imageExists(photo)).toBe(false);
  });
});

describe('category and weight filters', () => {
  it('knows the store\'s names for a category', () => {
    expect(categoryOf('FANCY HAR SET')).toBe('Haar');
    expect(categoryOf('rani haar')).toBe('Haar');
    expect(categoryOf('something unheard of')).toBe('Other');
    expect(matchesFilter({ id: '1', itemType: 'Har set', netWeightGrams: '20', grossWeightGrams: '' }, { category: 'har' })).toBe(true);
    expect(matchesFilter({ id: '1', itemType: 'Ring', netWeightGrams: '20', grossWeightGrams: '' }, { category: 'har' })).toBe(false);
  });

  it('treats the weight range as inclusive, falls back to gross, and leaves out pieces with no weight', () => {
    const row = (net: string, gross = '') => ({ id: 'x', itemType: 'Haar', netWeightGrams: net, grossWeightGrams: gross });
    const f = { minWeight: 15, maxWeight: 30 };
    expect(matchesFilter(row('15'), f)).toBe(true);
    expect(matchesFilter(row('30.000'), f)).toBe(true);
    expect(matchesFilter(row('14.999'), f)).toBe(false);
    expect(matchesFilter(row('30.5'), f)).toBe(false);
    expect(matchesFilter(row('', '20'), f)).toBe(true);
    expect(matchesFilter(row(''), f)).toBe(false);
    expect(matchesFilter(row('12'), { minWeight: 10 })).toBe(true);
    expect(weightOf({ netWeightGrams: '12,5' })).toBe(12.5);
    expect(parseWeightParam('15,5')).toBe(15.5);
    expect(parseWeightParam('abc')).toBeNull();
    expect(parseWeightParam('')).toBeNull();
  });

  it('lists the categories that exist, most common first', () => {
    const options = categoryOptions([{ itemType: 'Haar' }, { itemType: 'Har set' }, { itemType: 'Ring' }, { itemType: 'zzz' }]);
    expect(options.map((o) => [o.type, o.count])).toEqual([['Haar', 2], ['Ring', 1], ['Other', 1]]);
    expect(options[0].aliases).toContain('har');
  });

  it('filters the Share list: Haars between 15 and 30 grams', async () => {
    const mgr = await loginAs('mgr', 'manager');
    const make = (itemType: string, net: string) => {
      const p = createProduct({ createdBy: (getDb().prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id, itemType, netWeightGrams: net, cpc: `C${Math.random()}` });
      setProductStatus(p.id, 'approved');
      return p.id;
    };
    const inRange = make('FANCY HAR SET', '22.5');
    make('Haar', '40');
    make('Haar', '10');
    make('Ring', '20');
    make('Haar', '');

    const res = await request(app).get('/api/products').query({ status: 'approved,exported', category: 'har', minWeight: '15', maxWeight: '30' }).set('Cookie', mgr);
    expect(res.status).toBe(200);
    expect(res.body.products.map((p: { id: string }) => p.id)).toEqual([inRange]);
    expect(res.body.total).toBe(1);

    const cats = await request(app).get('/api/products/categories').query({ status: 'approved,exported' }).set('Cookie', mgr);
    expect(cats.body.categories.find((c: { type: string }) => c.type === 'Haar').count).toBe(4);
  });
});
