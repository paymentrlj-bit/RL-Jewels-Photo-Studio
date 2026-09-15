// Brute-force protection for /api/login.
//
// v1 had none. A single shared staff password, no lockout, and a public URL is
// a combination that gets guessed - and behind it sits the store's full
// product catalogue and a Gemini key someone else can spend.
//
// Attempts are recorded in the database rather than an in-memory Map, for the
// same reason sessions are signed cookies: on a host that recycles containers,
// an in-memory counter resets to zero on every restart, and an attacker who
// can trigger restarts gets unlimited attempts.

import { getDb, nowIso } from '../db';
import { config } from '../config';

export interface LockoutState {
  locked: boolean;
  retryAfterSeconds: number;
  failuresInWindow: number;
}

// Keyed on username AND ip together, so one staff member fat-fingering their
// password from the counter tablet cannot lock out the rest of the store, and
// an attacker cycling usernames from one address still gets throttled.
function attemptKey(username: string, ip: string): { username: string; ip: string } {
  return { username: username.trim().toLowerCase(), ip: ip || '' };
}

export function recordLoginAttempt(username: string, ip: string, success: boolean): void {
  const key = attemptKey(username, ip);
  getDb()
    .prepare('INSERT INTO login_attempts (username, ip, success, at) VALUES (?, ?, ?, ?)')
    .run(key.username, key.ip, success ? 1 : 0, nowIso());
}

export function checkLockout(username: string, ip: string): LockoutState {
  const key = attemptKey(username, ip);
  const windowStart = new Date(Date.now() - config.loginWindowMs).toISOString();

  const rows = getDb()
    .prepare(
      `SELECT at, success FROM login_attempts
       WHERE username = ? AND ip = ? AND at >= ?
       ORDER BY at DESC`
    )
    .all(key.username, key.ip, windowStart) as { at: string; success: number }[];

  // Only failures since the most recent success count - signing in
  // successfully clears the slate rather than leaving someone one typo away
  // from a lockout for the rest of the window.
  const failures: { at: string }[] = [];
  for (const row of rows) {
    if (row.success === 1) break;
    failures.push(row);
  }

  if (failures.length < config.loginMaxAttempts) {
    return { locked: false, retryAfterSeconds: 0, failuresInWindow: failures.length };
  }

  const newestFailureAt = new Date(failures[0].at).getTime();
  const unlocksAt = newestFailureAt + config.loginLockoutMs;
  const remainingMs = unlocksAt - Date.now();

  if (remainingMs <= 0) {
    return { locked: false, retryAfterSeconds: 0, failuresInWindow: failures.length };
  }

  return {
    locked: true,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    failuresInWindow: failures.length,
  };
}

// Keeps the table from growing without bound. Called on a timer from the
// server bootstrap; attempts older than a day have no bearing on any lockout
// window worth configuring.
export function pruneOldLoginAttempts(): number {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = getDb().prepare('DELETE FROM login_attempts WHERE at < ?').run(cutoff);
  return result.changes;
}
