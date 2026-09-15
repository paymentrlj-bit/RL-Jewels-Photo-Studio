import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type BetterSqlite3 from 'better-sqlite3';
import { openDatabase } from '../db';

// The queue functions talk to the shared connection from ../db. These tests
// drive the same SQL against a throwaway database so the claim/recover
// behaviour is verified for real rather than mocked - the atomicity is the
// entire point of the design and a mock would prove nothing.
let db: BetterSqlite3.Database;
let dir: string;

function seedUser(): string {
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, is_admin, is_active, created_at)
     VALUES ('usr_1', 'tester', 'Tester', 'x', 1, 1, '2026-01-01T00:00:00.000Z')`
  ).run();
  return 'usr_1';
}

function seedProduct(id: string): string {
  db.prepare(
    `INSERT INTO products (id, cpc, status, created_by, created_at, updated_at)
     VALUES (?, 'RLJ-1', 'queued', 'usr_1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
  ).run(id);
  return id;
}

function insertJob(id: string, productId: string, opts: { status?: string; priority?: number; attempts?: number; maxAttempts?: number; createdAt?: string } = {}): void {
  db.prepare(
    `INSERT INTO jobs (id, product_id, type, status, priority, attempts, max_attempts, payload, last_error, stage, created_at)
     VALUES (?, ?, 'enhance', ?, ?, ?, ?, '{}', '', '', ?)`
  ).run(
    id, productId,
    opts.status ?? 'queued',
    opts.priority ?? 0,
    opts.attempts ?? 0,
    opts.maxAttempts ?? 3,
    opts.createdAt ?? '2026-01-01T00:00:00.000Z'
  );
}

// Mirrors claimNextJob() from ../queue/jobs against the test connection.
function claim(workerId: string): { id: string } | null {
  const at = new Date().toISOString();
  const run = db.transaction(() => {
    const candidate = db
      .prepare(`SELECT id FROM jobs WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT 1`)
      .get() as { id: string } | undefined;
    if (!candidate) return null;

    const updated = db
      .prepare(
        `UPDATE jobs SET status = 'running', locked_by = ?, locked_at = ?,
                         started_at = COALESCE(started_at, ?), attempts = attempts + 1
         WHERE id = ? AND status = 'queued'`
      )
      .run(workerId, at, at, candidate.id);

    return updated.changes === 0 ? null : { id: candidate.id };
  });
  return run();
}

function recoverOrphans(): number {
  return db
    .prepare(
      `UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
           locked_by = NULL, locked_at = NULL, stage = ''
       WHERE status = 'running'`
    )
    .run().changes;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rlj-queue-test-'));
  db = openDatabase(path.join(dir, 'test.db'));
  seedUser();
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('brings a fresh database to the latest version', () => {
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(1);
  });

  it('creates every table the app depends on', () => {
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
      .map((r) => r.name);
    for (const table of ['users', 'login_attempts', 'batches', 'products', 'photos', 'jobs', 'events', 'settings']) {
      expect(tables).toContain(table);
    }
  });

  it('cascades photo rows when a product is deleted', () => {
    seedProduct('prd_1');
    db.prepare(
      `INSERT INTO photos (id, product_id, kind, filename, mime_type, bytes, source, created_at)
       VALUES ('img_1', 'prd_1', 'original', 'a.jpg', 'image/jpeg', 10, 'upload', '2026-01-01T00:00:00.000Z')`
    ).run();

    db.prepare('DELETE FROM products WHERE id = ?').run('prd_1');
    expect(db.prepare('SELECT COUNT(*) AS n FROM photos').get()).toEqual({ n: 0 });
  });
});

describe('claimNextJob', () => {
  it('claims a queued job and marks it running', () => {
    seedProduct('prd_1');
    insertJob('job_1', 'prd_1');

    expect(claim('worker-1')?.id).toBe('job_1');
    const job = db.prepare('SELECT status, locked_by, attempts FROM jobs WHERE id = ?').get('job_1');
    expect(job).toMatchObject({ status: 'running', locked_by: 'worker-1', attempts: 1 });
  });

  it('never hands the same job to two workers', () => {
    seedProduct('prd_1');
    insertJob('job_1', 'prd_1');

    const first = claim('worker-1');
    const second = claim('worker-2');

    expect(first?.id).toBe('job_1');
    expect(second).toBeNull();
  });

  it('takes higher priority first', () => {
    seedProduct('prd_1');
    insertJob('job_old', 'prd_1', { priority: 0, createdAt: '2026-01-01T00:00:00.000Z' });
    insertJob('job_reshoot', 'prd_1', { priority: 10, createdAt: '2026-01-02T00:00:00.000Z' });

    // A reshoot has someone waiting at the counter, so it jumps the backlog
    // even though it was queued later.
    expect(claim('worker-1')?.id).toBe('job_reshoot');
  });

  it('breaks priority ties by age, oldest first', () => {
    seedProduct('prd_1');
    insertJob('job_newer', 'prd_1', { createdAt: '2026-01-02T00:00:00.000Z' });
    insertJob('job_older', 'prd_1', { createdAt: '2026-01-01T00:00:00.000Z' });

    expect(claim('worker-1')?.id).toBe('job_older');
  });

  it('returns null on an empty queue', () => {
    expect(claim('worker-1')).toBeNull();
  });
});

describe('recoverOrphanedJobs', () => {
  it('requeues a job stranded by a crash', () => {
    seedProduct('prd_1');
    insertJob('job_1', 'prd_1', { status: 'running', attempts: 1, maxAttempts: 3 });

    expect(recoverOrphans()).toBe(1);
    expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_1')).toEqual({ status: 'queued' });
  });

  it('fails a stranded job that has no attempts left, instead of looping forever', () => {
    // Otherwise a job that reliably kills the process would be requeued on
    // every boot and crash the server indefinitely.
    seedProduct('prd_1');
    insertJob('job_1', 'prd_1', { status: 'running', attempts: 3, maxAttempts: 3 });

    recoverOrphans();
    expect(db.prepare('SELECT status FROM jobs WHERE id = ?').get('job_1')).toEqual({ status: 'failed' });
  });

  it('leaves queued and finished jobs alone', () => {
    seedProduct('prd_1');
    insertJob('job_queued', 'prd_1', { status: 'queued' });
    insertJob('job_done', 'prd_1', { status: 'succeeded' });

    expect(recoverOrphans()).toBe(0);
  });
});
