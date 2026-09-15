// User accounts, stored in the database rather than in environment variables.
//
// The point of this module is accountability. v1's `staffName` was a free-text
// form field the staff member typed themselves, gated by a password shared
// across the whole counter - so "who shot this product" was a suggestion, not
// a record. Every product row now references a real user id.

import type BetterSqlite3 from 'better-sqlite3';
import { getDb, newId, nowIso } from '../db';
import { hashPassword, verifyPassword } from './passwords';

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  is_admin: number;
  is_active: number;
  created_at: string;
  last_login_at: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    isAdmin: row.is_admin === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function findUserByUsername(username: string): (User & { passwordHash: string }) | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined;
  return row ? { ...toUser(row), passwordHash: row.password_hash } : null;
}

export function findUserById(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function listUsers(): User[] {
  const rows = getDb()
    .prepare('SELECT * FROM users ORDER BY is_admin DESC, username ASC')
    .all() as UserRow[];
  return rows.map(toUser);
}

export async function createUser(input: {
  username: string;
  password: string;
  displayName?: string;
  isAdmin?: boolean;
}): Promise<User> {
  const username = input.username.trim();
  if (!username) throw new Error('Username is required.');
  if (!/^[a-zA-Z0-9._-]{2,40}$/.test(username)) {
    throw new Error('Username must be 2-40 characters, letters/numbers/dot/dash/underscore only.');
  }
  if (findUserByUsername(username)) {
    throw new Error(`A user named "${username}" already exists.`);
  }

  const passwordHash = await hashPassword(input.password);
  const user: UserRow = {
    id: newId('usr'),
    username,
    display_name: input.displayName?.trim() || username,
    password_hash: passwordHash,
    is_admin: input.isAdmin ? 1 : 0,
    is_active: 1,
    created_at: nowIso(),
    last_login_at: null,
  };

  getDb()
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, is_admin, is_active, created_at, last_login_at)
       VALUES (@id, @username, @display_name, @password_hash, @is_admin, @is_active, @created_at, @last_login_at)`
    )
    .run(user);

  return toUser(user);
}

export async function setUserPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function setUserActive(userId: string, isActive: boolean): void {
  getDb().prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, userId);
}

export function setUserAdmin(userId: string, isAdmin: boolean): void {
  getDb().prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
}

export function countAdmins(): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND is_active = 1')
    .get() as { n: number };
  return row.n;
}

export function recordLogin(userId: string): void {
  getDb().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId);
}

export async function authenticate(username: string, password: string): Promise<User | null> {
  const user = findUserByUsername(username);
  if (!user) {
    // Burn roughly the same time as a real verification would, so a wrong
    // username and a wrong password are not distinguishable by response time.
    await verifyPassword(password, 'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
    return null;
  }
  if (!user.isActive) return null;

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  recordLogin(user.id);
  return findUserById(user.id);
}

// Creates the first admin account on an empty database, from config. This is
// the only time a password ever comes from an environment variable - after
// this, accounts are managed in the admin UI and the env var is dead weight.
export async function ensureBootstrapAdmin(
  db: BetterSqlite3.Database,
  username: string,
  password: string
): Promise<void> {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (row.n > 0) return;

  await createUser({ username, password, displayName: username, isAdmin: true });
  console.log(
    `[auth] Bootstrapped the first admin account "${username}". ` +
    `Sign in and change this password, then add a personal account for each staff member.`
  );
}
