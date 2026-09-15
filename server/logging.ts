// Structured event log.
//
// Changed from v1: the local copy is a table in the same SQLite database as
// everything else, not JSONL files under logs/.
//
// v1's reasoning for the Axiom mirror was that local disk is ephemeral on a
// scale-to-zero host, so history vanishes on redeploy. That was true - but
// the fix was an external dependency for something the app now solves for
// itself, because the database already has to live on a persistent volume for
// products and images to survive at all. Events ride along on that volume.
//
// The Axiom mirror stays, and is still worth turning on: it gives a second
// place to look and ad-hoc querying beyond what the dashboard offers. It is
// now genuinely optional rather than the only way to keep history.
//
// Every write is fire-and-forget. Logging must never slow down or break a
// staff-facing request, so failures here get one console warning and are
// otherwise swallowed.

import { config, isAxiomConfigured } from './config';
import { getDb, nowIso } from './db';
import type { User } from './auth/users';

export type EventPayload = Record<string, unknown>;

export interface LoggedActor {
  username: string;
  isAdmin: boolean;
}

export function actorFrom(user: User | undefined | null): LoggedActor | undefined {
  return user ? { username: user.username, isAdmin: user.isAdmin } : undefined;
}

export function newRequestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Strips undefined so they neither hit the database as "undefined" strings nor
// confuse Axiom's schema inference.
function clean(payload: EventPayload): EventPayload {
  const out: EventPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export function logEvent(type: string, payload: EventPayload = {}, actor?: LoggedActor): void {
  const at = nowIso();
  const cleaned = clean(payload);

  try {
    getDb()
      .prepare('INSERT INTO events (at, type, username, is_admin, payload) VALUES (?, ?, ?, ?, ?)')
      .run(at, type, actor?.username || '', actor?.isAdmin ? 1 : 0, JSON.stringify(cleaned));
  } catch (err) {
    console.warn(`[log] could not persist event "${type}": ${(err as Error).message}`);
  }

  queueForAxiom({ _time: at, type, username: actor?.username || '', isAdmin: Boolean(actor?.isAdmin), ...cleaned });
}

// ---------------------------------------------------------------------------
// Axiom mirror - optional, off unless AXIOM_TOKEN is set. Batched, because one
// HTTP request per event would be wasteful and Axiom's ingest API takes arrays.
// ---------------------------------------------------------------------------

let axiomBuffer: Record<string, unknown>[] = [];
let axiomFlushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushAxiomBuffer(): Promise<void> {
  if (axiomFlushTimer) {
    clearTimeout(axiomFlushTimer);
    axiomFlushTimer = null;
  }
  if (!isAxiomConfigured() || axiomBuffer.length === 0) return;

  const batch = axiomBuffer;
  axiomBuffer = [];

  try {
    const res = await fetch(
      `https://api.axiom.co/v1/datasets/${encodeURIComponent(config.axiom.dataset)}/ingest`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.axiom.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(batch),
      }
    );
    if (!res.ok) {
      console.warn(
        `[log] Axiom ingest responded ${res.status} - these ${batch.length} event(s) are in the local database only.`
      );
    }
  } catch (err) {
    console.warn(
      `[log] Axiom ingest error (non-fatal, local database already has these events): ${(err as Error).message}`
    );
  }
}

function queueForAxiom(event: Record<string, unknown>): void {
  if (!isAxiomConfigured()) return;
  axiomBuffer.push(event);
  if (axiomBuffer.length >= 20) {
    void flushAxiomBuffer();
    return;
  }
  if (!axiomFlushTimer) {
    axiomFlushTimer = setTimeout(() => void flushAxiomBuffer(), 5000);
    // Never hold the process open just to flush logs.
    axiomFlushTimer.unref?.();
  }
}

// Called from the shutdown handler so a clean stop doesn't drop buffered events.
export async function flushLogs(): Promise<void> {
  await flushAxiomBuffer();
}

// ---------------------------------------------------------------------------
// Reading events back - powers the admin dashboard. Unlike v1 this always
// reads the local database: it is now the durable store, so there is no
// "which source is authoritative" ambiguity to resolve.
// ---------------------------------------------------------------------------

export interface StoredEvent {
  at: string;
  type: string;
  username: string;
  isAdmin: boolean;
  payload: EventPayload;
}

export function readEvents(options: { sinceIso?: string; types?: string[]; limit?: number } = {}): StoredEvent[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.sinceIso) {
    clauses.push('at >= ?');
    params.push(options.sinceIso);
  }
  if (options.types?.length) {
    clauses.push(`type IN (${options.types.map(() => '?').join(', ')})`);
    params.push(...options.types);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(options.limit ?? 50_000, 200_000);

  const rows = getDb()
    .prepare(`SELECT at, type, username, is_admin, payload FROM events ${where} ORDER BY at DESC LIMIT ?`)
    .all(...params, limit) as { at: string; type: string; username: string; is_admin: number; payload: string }[];

  return rows.map((row) => {
    let payload: EventPayload = {};
    try {
      payload = JSON.parse(row.payload) as EventPayload;
    } catch {
      // A corrupt payload should not take out the whole dashboard query.
      payload = { _unparseable: true };
    }
    return { at: row.at, type: row.type, username: row.username, isAdmin: row.is_admin === 1, payload };
  });
}

// Events are the cheapest rows here but the most numerous. Ninety days is well
// past the point where anything drives a decision, and keeps the database
// small enough to copy off the Lenovo on a USB stick if it ever needs to be.
export function pruneOldEvents(retentionDays = 90): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  return getDb().prepare('DELETE FROM events WHERE at < ?').run(cutoff).changes;
}
