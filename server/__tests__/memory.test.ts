// Design memory (db/fixRequests.ts): corrections made on earlier pieces of a
// style are warned about on the next one - but only once they recur, only for
// the right style, and without one stubborn piece skewing it.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initDatabase, closeDatabase, getDb } from '../db';
import { createUser } from '../auth/users';
import { createProduct } from '../db/products';
import { recordFixRequest, designMemoryFor, buildDesignMemoryBlock } from '../db/fixRequests';

let dir: string;
let userId: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-memory-test-'));
  initDatabase(path.join(dir, 'test.db'));
  userId = (await createUser({ username: 'memory', password: 'a-real-password-1' })).id;
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  getDb().exec('DELETE FROM fix_requests; DELETE FROM products;');
});

const piece = (itemType: string) => createProduct({ createdBy: userId, itemType }).id;

describe('design memory', () => {
  it('warns about a mistake once it has happened on two pieces of the style', () => {
    const a = piece('ATTACHED CHAIN POTE');
    recordFixRequest({ productId: a, itemType: 'ATTACHED CHAIN POTE', issues: ['black_beads'], source: 'staff' });
    expect(designMemoryFor('ATTACHED CHAIN POTE').lessons).toEqual([]);

    const b = piece('ATTACHED CHAIN POTE');
    recordFixRequest({ productId: b, itemType: 'Attached Chain Pote', issues: ['black_beads'], source: 'audit' });
    recordFixRequest({ productId: b, itemType: 'ATTACHED CHAIN POTE', issues: [], note: 'the clasp has two hooks', source: 'reject' });

    const memory = designMemoryFor('ATTACHED CHAIN POTE');
    expect(memory.scope).toBe('style');
    expect(memory.lessons).toEqual([expect.objectContaining({ code: 'black_beads', count: 2 })]);
    expect(memory.notes).toEqual(['the clasp has two hooks']);

    const block = buildDesignMemoryBlock('ATTACHED CHAIN POTE', memory);
    expect(block).toContain('LESSONS FROM EARLIER PHOTOS');
    expect(block).toContain('black beads were turned gold');
    expect(block).toContain('the clasp has two hooks');
  });

  it('counts a problem once per piece, however often it was flagged on it', () => {
    const a = piece('ZUMKA');
    for (let i = 0; i < 5; i++) recordFixRequest({ productId: a, itemType: 'ZUMKA', issues: ['beads'], source: 'staff' });
    expect(designMemoryFor('ZUMKA').lessons).toEqual([]);
  });

  it('falls back to the category for a style it has little history on', () => {
    for (const style of ['SHORT CHAIN POTE', 'DESIGNER POTE']) {
      const id = piece(style);
      recordFixRequest({ productId: id, itemType: style, issues: ['black_beads'], source: 'staff', note: 'style-specific note' });
    }
    const memory = designMemoryFor('LONG PBB');
    expect(memory.scope).toBe('category');
    expect(memory.lessons.map((l) => l.code)).toEqual(['black_beads']);
    // Notes are about one style's quirks; they do not travel across styles.
    expect(memory.notes).toEqual([]);
  });

  it('never learns from the piece being processed', () => {
    const a = piece('PADAK');
    const b = piece('PADAK');
    recordFixRequest({ productId: a, itemType: 'PADAK', issues: ['motif'], source: 'staff' });
    recordFixRequest({ productId: b, itemType: 'PADAK', issues: ['motif'], source: 'staff' });
    expect(designMemoryFor('PADAK', b).lessons).toEqual([]);
  });

  it('ignores unknown codes and says nothing when there is nothing to say', () => {
    const a = piece('RING');
    recordFixRequest({ productId: a, itemType: 'RING', issues: ['not-a-fix'], source: 'staff' });
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM fix_requests').get()).toEqual({ n: 0 });
    expect(buildDesignMemoryBlock('RING', designMemoryFor('RING'))).toBe('');
  });
});
