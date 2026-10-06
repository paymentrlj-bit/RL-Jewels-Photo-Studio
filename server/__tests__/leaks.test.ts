// The pipeline's money-saving behaviour, driven through the real worker, queue,
// database and image handling with only the Gemini calls replaced. These are the
// "stop the leaks" rules: a picture that is paid for is never thrown away, an
// out-of-credit account never burns a photo, and plain pieces skip the counting.
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

const mocks = vi.hoisted(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  return {
    enhanceImage: vi.fn(),
    auditOutput: vi.fn(),
    analyzeDetail: vi.fn(),
    identifyPiece: vi.fn(),
  };
});

vi.mock('../ai/operations', async (orig) => ({
  ...(await orig<typeof import('../ai/operations')>()),
  enhanceImage: mocks.enhanceImage,
  auditOutput: mocks.auditOutput,
  segmentJewelry: vi.fn(async () => null),
  generateCopy: vi.fn(async () => {
    throw new Error('no copy in this test');
  }),
}));
vi.mock('../ai/inventory', async (orig) => ({ ...(await orig<typeof import('../ai/inventory')>()), analyzeDetail: mocks.analyzeDetail }));
vi.mock('../ai/identity', async (orig) => ({ ...(await orig<typeof import('../ai/identity')>()), identifyPiece: mocks.identifyPiece }));

import { initDatabase, closeDatabase, getDb } from '../db';
import { createUser } from '../auth/users';
import { createProduct, getProduct } from '../db/products';
import { saveImage } from '../storage/images';
import { enqueueJob, getJob } from '../queue/jobs';
import { startWorkers, stopWorkers } from '../queue/worker';
import { getBlockingIssue, clearBlockingIssue } from '../queue/systemStatus';
import { clearSegmentationCache, clearInventoryCache } from '../queue/groundingCache';
import { AUDIT_CHECKS } from '../ai/operations';
import { inventoryNeeded } from '../catalog/risk';

let dir: string;
let userId: string;
let photo: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-leaks-test-'));
  initDatabase(path.join(dir, 'test.db'));
  photo = (await sharp({ create: { width: 256, height: 256, channels: 3, background: '#ffffff' } }).jpeg().toBuffer()).toString('base64');
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  getDb().exec('DELETE FROM product_vectors; DELETE FROM fix_requests; DELETE FROM jobs; DELETE FROM photos; DELETE FROM products; DELETE FROM batches; DELETE FROM users; DELETE FROM events;');
  userId = (await createUser({ username: 'tester', password: 'a-real-password-1', isAdmin: true })).id;
  clearBlockingIssue();
  clearSegmentationCache();
  clearInventoryCache();
  vi.clearAllMocks();
  mocks.enhanceImage.mockResolvedValue({ imageBase64: photo, mimeType: 'image/jpeg' });
  mocks.auditOutput.mockResolvedValue({
    overallPass: true,
    modelClaimedPass: true,
    verdictDisagreed: false,
    reason: 'Looks right.',
    checklist: Object.fromEntries(AUDIT_CHECKS.map((c) => [c, true])),
    originalCounts: '',
    enhancedCounts: '',
  });
  mocks.analyzeDetail.mockResolvedValue({ analysis: { regions: [], inventory: { elements: [], chainStrands: null, chainLinkStyle: null, surfaceFinish: null, naturalOrientation: null, proportions: null, referenceScale: { present: false, measurements: null } } }, crops: [] });
});

afterEach(async () => {
  await stopWorkers();
});

function shoot(itemType: string): string {
  const product = createProduct({ createdBy: userId, itemType, cpc: `RLJ-${Math.random().toString(36).slice(2, 8)}` });
  saveImage({ productId: product.id, kind: 'original', data: photo, mimeType: 'image/jpeg', source: 'upload' });
  return product.id;
}

async function until(check: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('which pieces get the detail count', () => {
  it('skips plain pieces and never skips the ones the audit fails on', () => {
    expect(inventoryNeeded({ itemType: 'Stud' })).toBe(false);
    expect(inventoryNeeded({ itemType: 'Nose Pin' })).toBe(false);
    for (const t of ['FANCY HAR SET', 'Haar', 'Mangalsutra', 'Chain', 'Ring', 'Kada', 'Pendant', 'Jhumka', 'something unknown', '']) {
      expect(inventoryNeeded({ itemType: t }), t).toBe(true);
    }
  });
});

describe('the worker', () => {
  it('does not run the detail count for a stud, and does for a haar', async () => {
    const stud = shoot('Stud');
    const haar = shoot('Haar');
    mocks.identifyPiece.mockImplementation(async () => null);
    enqueueJob({ productId: stud, type: 'enhance' });
    enqueueJob({ productId: haar, type: 'enhance' });
    startWorkers();
    await until(() => ['awaiting_review', 'needs_reshoot', 'needs_angle', 'failed'].includes(getProduct(stud)!.status) && ['awaiting_review', 'needs_reshoot', 'needs_angle', 'failed'].includes(getProduct(haar)!.status));
    expect(getProduct(stud)!.status).toBe('awaiting_review');
    expect(mocks.analyzeDetail).toHaveBeenCalledTimes(1);
  });

  it('keeps a picture it already paid for when only the checker fails, instead of drawing it again', async () => {
    const id = shoot('Stud');
    mocks.auditOutput.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
    enqueueJob({ productId: id, type: 'enhance' });
    startWorkers();
    await until(() => getProduct(id)!.status === 'awaiting_review');
    expect(mocks.enhanceImage).toHaveBeenCalledTimes(1);
    const product = getProduct(id)!;
    expect(product.auditReason).toMatch(/automatic check could not run/i);
    expect(getDb().prepare(`SELECT COUNT(*) AS n FROM photos WHERE product_id = ? AND kind = 'processed'`).get(id)).toEqual({ n: 1 });
  });

  it('puts a photo back, without using an attempt, when the account is out of credit', async () => {
    const id = shoot('Stud');
    mocks.enhanceImage.mockRejectedValue(new Error('{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio"}}'));
    const job = enqueueJob({ productId: id, type: 'enhance' });
    startWorkers();
    await until(() => getBlockingIssue()?.code === 'billing_cap');
    await until(() => getJob(job.id)!.status === 'queued');
    expect(getJob(job.id)!.attempts).toBe(0);
    expect(getProduct(id)!.status).toBe('queued');
  });
});

describe('automatic retries', () => {
  it('gives a photo job one automatic retry and other jobs the usual three', () => {
    const id = shoot('Stud');
    expect(enqueueJob({ productId: id, type: 'enhance' }).maxAttempts).toBe(2);
    expect(enqueueJob({ productId: id, type: 'copy' }).maxAttempts).toBe(3);
  });
});
