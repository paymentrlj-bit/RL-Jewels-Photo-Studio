// Versioned schema migrations, tracked with SQLite's built-in `user_version`
// pragma. Each entry runs exactly once, in order, inside a transaction.
//
// Rules for changing this file:
//   - NEVER edit a migration that has already shipped. Add a new one.
//   - Migrations run automatically at boot, before the server accepts traffic.
//
// The store's whole shoot history lives in this database, so a botched
// migration is a data-loss event, not an inconvenience.

import type BetterSqlite3 from 'better-sqlite3';

interface Migration {
  version: number;
  name: string;
  up: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    up: `
      -- Real per-person accounts. v1 had two shared passwords, which made
      -- every "who shot this product" field unverifiable self-reported text.
      CREATE TABLE users (
        id             TEXT PRIMARY KEY,
        username       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name   TEXT NOT NULL DEFAULT '',
        password_hash  TEXT NOT NULL,
        is_admin       INTEGER NOT NULL DEFAULT 0,
        is_active      INTEGER NOT NULL DEFAULT 1,
        created_at     TEXT NOT NULL,
        last_login_at  TEXT
      );

      -- Backs the brute-force lockout on /api/login.
      CREATE TABLE login_attempts (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        username   TEXT NOT NULL,
        ip         TEXT NOT NULL DEFAULT '',
        success    INTEGER NOT NULL,
        at         TEXT NOT NULL
      );
      CREATE INDEX idx_login_attempts_lookup ON login_attempts (username, at);

      -- A shoot session: staff open a batch, run items through it, close it
      -- and export the batch as one unit. v1 had no grouping at all, which
      -- is why it could only ever handle one product at a time.
      CREATE TABLE batches (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        created_by  TEXT NOT NULL REFERENCES users(id),
        created_at  TEXT NOT NULL,
        closed_at   TEXT
      );

      CREATE TABLE products (
        id                     TEXT PRIMARY KEY,
        batch_id               TEXT REFERENCES batches(id) ON DELETE SET NULL,
        cpc                    TEXT NOT NULL DEFAULT '',
        -- The ProductId half of the CPC (see cpcMaster). Indexed because
        -- "have we already shot this product?" is the single most valuable
        -- question a 3,247-SKU catalogue run needs answered, and v1 could
        -- not answer it at all.
        catalog_product_id     TEXT,
        name                   TEXT NOT NULL DEFAULT '',
        description            TEXT NOT NULL DEFAULT '',
        seo_meta_title         TEXT NOT NULL DEFAULT '',
        seo_meta_description   TEXT NOT NULL DEFAULT '',
        seo_keywords           TEXT NOT NULL DEFAULT '',
        image_alt_text         TEXT NOT NULL DEFAULT '',
        url_slug               TEXT NOT NULL DEFAULT '',
        item_type              TEXT NOT NULL DEFAULT '',
        purity                 TEXT NOT NULL DEFAULT '22kt',
        gender                 TEXT NOT NULL DEFAULT 'unisex',
        size                   TEXT NOT NULL DEFAULT 'DEFAULT',
        gross_weight_grams     TEXT NOT NULL DEFAULT '',
        other_weight_grams     TEXT NOT NULL DEFAULT '',
        net_weight_grams       TEXT NOT NULL DEFAULT '',
        -- draft -> queued -> processing -> awaiting_review -> approved -> exported
        -- plus the terminal-ish needs_reshoot and failed.
        status                 TEXT NOT NULL DEFAULT 'draft',
        review_note            TEXT NOT NULL DEFAULT '',
        audit_checklist        TEXT,
        audit_reason           TEXT NOT NULL DEFAULT '',
        model_used             TEXT NOT NULL DEFAULT '',
        attempt_count          INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd     REAL NOT NULL DEFAULT 0,
        created_by             TEXT NOT NULL REFERENCES users(id),
        created_at             TEXT NOT NULL,
        updated_at             TEXT NOT NULL,
        approved_at            TEXT,
        exported_at            TEXT
      );
      CREATE INDEX idx_products_status    ON products (status);
      CREATE INDEX idx_products_batch     ON products (batch_id);
      CREATE INDEX idx_products_catalogid ON products (catalog_product_id);
      CREATE INDEX idx_products_cpc       ON products (cpc);

      -- Images are files on disk; only their metadata lives here. Holding
      -- multi-megabyte base64 in the database (or, as v1 did, in React state
      -- and 20MB JSON bodies) does not survive a real catalogue run.
      CREATE TABLE photos (
        id          TEXT PRIMARY KEY,
        product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        kind        TEXT NOT NULL,
        filename    TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        bytes       INTEGER NOT NULL DEFAULT 0,
        source      TEXT NOT NULL DEFAULT 'upload',
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_photos_product ON photos (product_id, kind);

      -- The work queue. Staff capture fast and walk away; these rows are
      -- what the background workers chew through.
      CREATE TABLE jobs (
        id            TEXT PRIMARY KEY,
        product_id    TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type          TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'queued',
        priority      INTEGER NOT NULL DEFAULT 0,
        attempts      INTEGER NOT NULL DEFAULT 0,
        max_attempts  INTEGER NOT NULL DEFAULT 3,
        payload       TEXT NOT NULL DEFAULT '{}',
        result        TEXT,
        last_error    TEXT NOT NULL DEFAULT '',
        stage         TEXT NOT NULL DEFAULT '',
        locked_by     TEXT,
        locked_at     TEXT,
        created_at    TEXT NOT NULL,
        started_at    TEXT,
        finished_at   TEXT
      );
      CREATE INDEX idx_jobs_claim   ON jobs (status, priority DESC, created_at);
      CREATE INDEX idx_jobs_product ON jobs (product_id);

      -- Local durable event log. Mirrors to Axiom when configured; unlike v1
      -- this copy survives a container restart on its own, because it sits in
      -- the same persisted volume as everything else.
      CREATE TABLE events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        at         TEXT NOT NULL,
        type       TEXT NOT NULL,
        username   TEXT NOT NULL DEFAULT '',
        is_admin   INTEGER NOT NULL DEFAULT 0,
        payload    TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX idx_events_at   ON events (at);
      CREATE INDEX idx_events_type ON events (type, at);

      -- Admin-editable settings (currently the enhance prompt). v1 kept this
      -- in browser localStorage, so every staff device had its own copy and
      -- a prompt fix reached nobody else.
      CREATE TABLE settings (
        key         TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        updated_by  TEXT
      );
    `,
  },
];

export function runMigrations(db: BetterSqlite3.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);

  if (pending.length === 0) return;

  for (const migration of pending) {
    const apply = db.transaction(() => {
      db.exec(migration.up);
      // pragma values cannot be bound as parameters, and `version` here comes
      // from this file's own literal integers, never from user input.
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
    console.log(`[db] migration ${migration.version} applied: ${migration.name}`);
  }
}

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
