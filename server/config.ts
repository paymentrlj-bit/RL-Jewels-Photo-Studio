// Single source of truth for every environment variable this app reads.
//
// v1 read process.env directly from a dozen places and silently fell back to
// insecure defaults - most dangerously ADMIN_PASSWORD='admin' /
// STAFF_PASSWORD='gold', which would have gone to production the first time
// someone forgot to set them. This module fails fast instead: in production,
// a missing security-critical value stops the process at boot with a message
// naming exactly what to set, rather than starting a server that looks fine
// and is trivially broken into.
//
// Optional integrations (Gemini, Drive, Axiom) deliberately stay
// optional - the app boots and runs without them, and each feature
// advertises its own availability to the UI. That behaviour from v1 was
// right and is preserved.

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

function required(name: string, fallbackInDev: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();
  if (isProduction) {
    throw new Error(
      `${name} is not set. This is required in production - the server will not start without it. ` +
      `Set it in your hosting provider's environment variables.`
    );
  }
  console.warn(`[config] ${name} is not set - using an insecure development default. Never run production like this.`);
  return fallbackInDev;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

function numeric(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Everything the app persists - the SQLite database and every captured and
// processed image - lives under one directory. One directory means one
// volume mount in Docker, one thing to back up, and one path to change when
// moving between a VPS, Cloud Run with a mounted volume, and the Lenovo at
// the store. v1 had no persistent state at all, which is the single biggest
// reason a closed browser tab lost a shoot.
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data-store'));

export const config = {
  isProduction,
  port: numeric('PORT', 3000),

  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'studio.db'),
  imageDir: path.join(DATA_DIR, 'images'),

  // Signs the session cookie. A random per-process value logs every staff
  // member out on each restart, so this must be fixed in production.
  sessionSecret: required('SESSION_SECRET', 'dev-only-insecure-session-secret'),
  sessionTtlMs: numeric('SESSION_TTL_HOURS', 12) * 60 * 60 * 1000,

  // Seeds the first admin account on an empty database. After first boot,
  // accounts live in the users table and are managed from the admin UI -
  // this is only ever used once.
  bootstrapAdminUsername: process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() || 'admin',
  bootstrapAdminPassword: required('BOOTSTRAP_ADMIN_PASSWORD', 'dev-only-insecure-admin-password'),

  // Brute-force protection on /api/login. v1 had none at all.
  loginMaxAttempts: numeric('LOGIN_MAX_ATTEMPTS', 8),
  loginWindowMs: numeric('LOGIN_WINDOW_MINUTES', 15) * 60 * 1000,
  loginLockoutMs: numeric('LOGIN_LOCKOUT_MINUTES', 15) * 60 * 1000,

  geminiApiKey: optional('GEMINI_API_KEY'),

  // How many photos the background worker processes at once. Each job is
  // several sequential Gemini calls, so this is about API concurrency limits
  // and not CPU. Two is a safe default for a single store; raise it once a
  // real rate limit is known.
  queueConcurrency: numeric('QUEUE_CONCURRENCY', 2),
  queueMaxAttempts: numeric('QUEUE_MAX_ATTEMPTS', 3),

  ocrSpaceApiKey: optional('OCR_SPACE_API_KEY'),

  drive: {
    clientId: optional('GOOGLE_DRIVE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_DRIVE_CLIENT_SECRET'),
    refreshToken: optional('GOOGLE_DRIVE_REFRESH_TOKEN'),
    rootFolderId: optional('GOOGLE_DRIVE_ROOT_FOLDER_ID'),
  },

  axiom: {
    token: optional('AXIOM_TOKEN'),
    dataset: process.env.AXIOM_DATASET?.trim() || 'rl-jewels-events',
  },

  // Which ERP column mapping to use when exporting. See server/export/mappings/.
  // Config, not code, specifically so pointing this at the store's real ERP
  // is a one-line change rather than a rewrite of the export module.
  erpMapping: process.env.ERP_MAPPING?.trim() || 'generic',
};

export function isDriveConfigured(): boolean {
  const { clientId, clientSecret, refreshToken, rootFolderId } = config.drive;
  return Boolean(clientId && clientSecret && refreshToken && rootFolderId);
}

export function isAxiomConfigured(): boolean {
  return Boolean(config.axiom.token);
}

export function isGeminiConfigured(): boolean {
  return Boolean(config.geminiApiKey);
}

export function ensureDataDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.imageDir, { recursive: true });
}
