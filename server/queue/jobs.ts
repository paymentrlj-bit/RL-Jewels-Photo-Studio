// The work queue, backed by the jobs table.
//
// This is the single biggest change from v1. There, processing a photo meant
// holding an HTTP request open for up to five minutes while the staff member
// watched a progress bar and could not do anything else. One product at a
// time, and closing the tab lost the work.
//
// Here, capturing a photo enqueues a job and returns immediately. Staff keep
// shooting; workers drain the queue behind them. At 3,247 products that is the
// difference between a tool that is usable for a catalogue run and one that
// is not.
//
// Jobs are claimed with an atomic UPDATE so two workers can never take the
// same row, and any job left 'running' by a crash is recovered at boot.

import { getDb, newId, nowIso } from '../db';

export type JobType = 'enhance' | 'copy';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'needs_reshoot';

export interface Job {
  id: string;
  productId: string;
  type: JobType;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  lastError: string;
  stage: string;
  lockedBy: string | null;
  lockedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface JobRow {
  id: string;
  product_id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  payload: string;
  result: string | null;
  last_error: string;
  stage: string;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    productId: row.product_id,
    type: row.type as JobType,
    status: row.status as JobStatus,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    result: parseJson<Record<string, unknown> | null>(row.result, null),
    lastError: row.last_error,
    stage: row.stage,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function enqueueJob(input: {
  productId: string;
  type: JobType;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
}): Job {
  const row: JobRow = {
    id: newId('job'),
    product_id: input.productId,
    type: input.type,
    status: 'queued',
    // Higher runs first. A reshoot that a staff member is standing at the
    // counter waiting on should jump ahead of a backlog queued an hour ago.
    priority: input.priority ?? 0,
    attempts: 0,
    max_attempts: input.maxAttempts ?? 3,
    payload: JSON.stringify(input.payload ?? {}),
    result: null,
    last_error: '',
    stage: '',
    locked_by: null,
    locked_at: null,
    created_at: nowIso(),
    started_at: null,
    finished_at: null,
  };

  getDb()
    .prepare(
      `INSERT INTO jobs (id, product_id, type, status, priority, attempts, max_attempts,
                         payload, result, last_error, stage, locked_by, locked_at,
                         created_at, started_at, finished_at)
       VALUES (@id, @product_id, @type, @status, @priority, @attempts, @max_attempts,
               @payload, @result, @last_error, @stage, @locked_by, @locked_at,
               @created_at, @started_at, @finished_at)`
    )
    .run(row);

  return toJob(row);
}

// Atomically takes the highest-priority queued job. The UPDATE targets a
// single id chosen by the subquery, so two workers racing cannot both win -
// the second one's WHERE clause no longer matches and it claims nothing.
export function claimNextJob(workerId: string): Job | null {
  const db = getDb();
  const at = nowIso();

  const claim = db.transaction(() => {
    const candidate = db
      .prepare(
        `SELECT id FROM jobs
         WHERE status = 'queued'
         ORDER BY priority DESC, created_at ASC
         LIMIT 1`
      )
      .get() as { id: string } | undefined;

    if (!candidate) return null;

    const updated = db
      .prepare(
        `UPDATE jobs
         SET status = 'running', locked_by = ?, locked_at = ?, started_at = COALESCE(started_at, ?),
             attempts = attempts + 1
         WHERE id = ? AND status = 'queued'`
      )
      .run(workerId, at, at, candidate.id);

    if (updated.changes === 0) return null;

    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(candidate.id) as JobRow;
  });

  const row = claim();
  return row ? toJob(row) : null;
}

export function setJobStage(jobId: string, stage: string): void {
  getDb().prepare('UPDATE jobs SET stage = ? WHERE id = ?').run(stage, jobId);
}

export function completeJob(jobId: string, status: Exclude<JobStatus, 'queued' | 'running'>, result?: Record<string, unknown>): void {
  getDb()
    .prepare(
      `UPDATE jobs SET status = ?, result = ?, stage = '', locked_by = NULL, locked_at = NULL, finished_at = ?
       WHERE id = ?`
    )
    .run(status, result ? JSON.stringify(result) : null, nowIso(), jobId);
}

// Returns true if the job was put back on the queue for another attempt,
// false if it has exhausted them and is now terminally failed.
export function failJob(jobId: string, error: string, retryable: boolean): boolean {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
  if (!job) return false;

  const canRetry = retryable && job.attempts < job.max_attempts;

  if (canRetry) {
    db.prepare(
      `UPDATE jobs SET status = 'queued', last_error = ?, stage = '', locked_by = NULL, locked_at = NULL
       WHERE id = ?`
    ).run(error.slice(0, 500), jobId);
    return true;
  }

  db.prepare(
    `UPDATE jobs SET status = 'failed', last_error = ?, stage = '', locked_by = NULL, locked_at = NULL, finished_at = ?
     WHERE id = ?`
  ).run(error.slice(0, 500), nowIso(), jobId);
  return false;
}

export function getJob(jobId: string): Job | null {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function getLatestJobForProduct(productId: string, type?: JobType): Job | null {
  const row = type
    ? (getDb()
        .prepare('SELECT * FROM jobs WHERE product_id = ? AND type = ? ORDER BY created_at DESC LIMIT 1')
        .get(productId, type) as JobRow | undefined)
    : (getDb()
        .prepare('SELECT * FROM jobs WHERE product_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(productId) as JobRow | undefined);
  return row ? toJob(row) : null;
}

export interface QueueDepth {
  queued: number;
  running: number;
  failed: number;
}

export function queueDepth(): QueueDepth {
  const rows = getDb()
    .prepare(`SELECT status, COUNT(*) AS n FROM jobs WHERE status IN ('queued','running','failed') GROUP BY status`)
    .all() as { status: string; n: number }[];
  const counts = Object.fromEntries(rows.map((r) => [r.status, r.n]));
  return {
    queued: counts.queued ?? 0,
    running: counts.running ?? 0,
    failed: counts.failed ?? 0,
  };
}

// Crash recovery, run once at boot before workers start.
//
// A job stuck in 'running' means the process died holding it. Without this, a
// restart mid-batch would strand every in-flight photo forever, which on a
// host that recycles containers is a routine event rather than an exotic one.
// The attempt is already counted, so a job that repeatedly kills the process
// still exhausts its retries instead of looping indefinitely.
export function recoverOrphanedJobs(): number {
  const result = getDb()
    .prepare(
      `UPDATE jobs
       SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
           locked_by = NULL, locked_at = NULL, stage = '',
           last_error = CASE
             WHEN attempts >= max_attempts
               THEN 'Server restarted while this job was running, and it had no attempts left.'
             ELSE 'Server restarted while this job was running - requeued automatically.'
           END
       WHERE status = 'running'`
    )
    .run();
  return result.changes;
}

// Requeues a terminally failed job - the "Retry" button on a failed item.
export function requeueJob(jobId: string): boolean {
  const result = getDb()
    .prepare(
      `UPDATE jobs SET status = 'queued', attempts = 0, last_error = '', result = NULL,
                       finished_at = NULL, locked_by = NULL, locked_at = NULL
       WHERE id = ? AND status IN ('failed', 'needs_reshoot')`
    )
    .run(jobId);
  return result.changes > 0;
}
