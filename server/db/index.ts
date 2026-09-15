// SQLite connection, opened once per process.
//
// Why SQLite and not Postgres: this is a single-store tool with one or two
// capture stations and a few thousand products. SQLite handles that load
// without breathing hard, needs no second container, and - critically - runs
// identically whether this is deployed to Cloud Run with a mounted volume, a
// VPS, or the Lenovo at the lightbox station itself. That last option is a
// genuine possibility for a store whose internet can drop, and it stays open
// only because there is no separate database server to stand up.
//
// WAL mode is on so a long-running background job never blocks a staff member
// reading their queue.

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations';

let instance: Database.Database | null = null;

export function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Waits rather than throwing SQLITE_BUSY the instant two writers overlap -
  // with background workers and staff requests hitting the same file, brief
  // contention is normal and should be invisible.
  db.pragma('busy_timeout = 5000');

  runMigrations(db);
  return db;
}

export function initDatabase(dbPath: string): Database.Database {
  if (instance) return instance;
  instance = openDatabase(dbPath);
  return instance;
}

export function getDb(): Database.Database {
  if (!instance) {
    throw new Error('Database accessed before initDatabase() was called.');
  }
  return instance;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}

export function newId(prefix: string): string {
  // Sortable by creation time, which makes queue and history listings
  // naturally ordered without a join on created_at.
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${ts}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
