import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Append-only structured event log (JSONL, one file per UTC day) - this is the
// data backbone for /api/analytics/summary and for any future offline
// analysis. Every write is fire-and-forget: logging must never slow down or
// break a real staff-facing request, so failures here are swallowed after a
// single console warning.
//
// Deliberately schema-light: every event is just { ts, type, ...data }. New
// fields or event types can be added anywhere in the app without a migration
// - anything JSON-serializable can be logged, which is what keeps this
// future-proof as the process evolves.
//
// Local disk is always written to first (fast, zero setup, works out of the
// box). If AXIOM_TOKEN is set (see LOGGING_SETUP.md), every event is ALSO
// forwarded to Axiom - a durable, queryable external log sink - so history
// survives a redeploy/idle-restart on a host with ephemeral container
// storage. /api/analytics/summary reads from both and merges them (by each
// event's `id`), so the dashboard keeps working identically whether or not
// Axiom is configured, and automatically gets more durable once it is.

const LOG_DIR = path.join(process.cwd(), 'logs');
let dirEnsured = false;

function ensureLogDir(): void {
  if (dirEnsured) return;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (err) {
    console.warn('Could not create logs/ directory (logging disabled this run):', (err as any)?.message);
  }
  dirEnsured = true;
}

export interface LoggedSession {
  username: string;
  isAdmin: boolean;
}

export interface LogEvent {
  id: string;
  ts: string;
  type: string;
  username?: string;
  isAdmin?: boolean;
  [key: string]: unknown;
}

export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Axiom (external log sink) - optional, off unless AXIOM_TOKEN is set.
// ---------------------------------------------------------------------------

const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET || 'rl-jewels-events';

export function isAxiomConfigured(): boolean {
  return Boolean(AXIOM_TOKEN);
}

export function getAxiomDataset(): string {
  return AXIOM_DATASET;
}

// Events are buffered in memory and flushed in small batches rather than one
// HTTP request per event - keeps this cheap even during a burst of activity,
// and Axiom's ingest API is built for batch bodies.
let axiomBuffer: LogEvent[] = [];
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
    const res = await fetch(`https://api.axiom.co/v1/datasets/${encodeURIComponent(AXIOM_DATASET)}/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AXIOM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch.map((e) => ({ ...e, _time: e.ts }))),
    });
    if (!res.ok) {
      console.warn(`Axiom ingest responded with ${res.status} - these ${batch.length} event(s) stayed in local JSONL only.`);
    }
  } catch (err) {
    console.warn('Axiom ingest error (non-fatal, local JSONL already has these events):', (err as any)?.message);
  }
}

function queueForAxiom(event: LogEvent): void {
  if (!isAxiomConfigured()) return;
  axiomBuffer.push(event);
  if (axiomBuffer.length >= 20) {
    flushAxiomBuffer();
  } else if (!axiomFlushTimer) {
    axiomFlushTimer = setTimeout(flushAxiomBuffer, 2000);
  }
}

// Best-effort: get buffered events out before the process exits (deploy,
// restart). Not guaranteed on a hard kill, but catches the common cases.
if (typeof process !== 'undefined') {
  process.on('beforeExit', () => {
    flushAxiomBuffer();
  });
}

export function logEvent(type: string, data: Record<string, unknown> = {}, session?: LoggedSession | null): void {
  ensureLogDir();
  const ts = new Date().toISOString();
  const event: LogEvent = {
    id: crypto.randomUUID(),
    ts,
    type,
    ...(session ? { username: session.username, isAdmin: session.isAdmin } : {}),
    ...data,
  };
  const day = ts.slice(0, 10); // YYYY-MM-DD (UTC)
  const file = path.join(LOG_DIR, `events-${day}.jsonl`);
  fs.appendFile(file, JSON.stringify(event) + '\n', (err) => {
    if (err) console.warn('Log write failed (non-fatal):', err.message);
  });
  queueForAxiom(event);
}

// Reads every event logged in the last `days` days from LOCAL disk only.
// Small-shop volume (dozens to low hundreds of events/day) makes a full
// read-and-parse on every analytics request completely fine - no need for a
// database or in-memory cache at this scale.
export function readEvents(days: number): LogEvent[] {
  ensureLogDir();
  const out: LogEvent[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(LOG_DIR).filter((f) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
  } catch {
    return out;
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  for (const file of files) {
    const dateStr = file.slice('events-'.length, file.length - '.jsonl'.length);
    const fileDayMs = new Date(`${dateStr}T00:00:00Z`).getTime();
    // A file can hold events from anywhere in its UTC day, so keep any file
    // whose day could plausibly contain events >= cutoff.
    if (!isNaN(fileDayMs) && fileDayMs < cutoff - 24 * 60 * 60 * 1000) continue;

    let content: string;
    try {
      content = fs.readFileSync(path.join(LOG_DIR, file), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const evt = JSON.parse(line);
        const evtTime = Date.parse(evt.ts);
        if (!isNaN(evtTime) && evtTime >= cutoff) out.push(evt);
      } catch {
        // skip a malformed line rather than fail the whole read
      }
    }
  }
  return out;
}

// Queries Axiom for events in the last `days` days via APL (Axiom's
// query language). Deliberately asks for raw rows, not a server-side
// aggregation - the exact same JS aggregation code that already runs
// against local JSONL runs against these rows too, so there's only one
// aggregation code path to trust, not two. Defensive on every front: any
// non-2xx response, network error, or unexpected response shape just
// returns an empty array so the caller falls back to local-only data.
export async function queryAxiomEvents(days: number): Promise<LogEvent[]> {
  if (!isAxiomConfigured()) return [];
  const safeDataset = AXIOM_DATASET.replace(/'/g, "\\'");
  const apl = `['${safeDataset}'] | where _time > ago(${Math.max(1, Math.round(days))}d) | limit 50000`;
  try {
    const res = await fetch('https://api.axiom.co/v1/datasets/_apl', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AXIOM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apl }),
    });
    if (!res.ok) {
      console.warn(`Axiom query responded with ${res.status} - falling back to local-only data.`);
      return [];
    }
    const body: any = await res.json();
    const matches = Array.isArray(body?.matches) ? body.matches : [];
    return matches
      .map((m: any) => (m && typeof m === 'object' && m.data && typeof m.data === 'object' ? m.data : m))
      .filter((e: any) => e && typeof e === 'object' && typeof e.type === 'string');
  } catch (err) {
    console.warn('Axiom query error (falling back to local-only data):', (err as any)?.message);
    return [];
  }
}

// The single entry point /api/analytics/summary should use: local disk is
// always the baseline (fast, always available), and when Axiom is
// configured its events are merged in by `id` so nothing is double-counted.
// Axiom failing for any reason (misconfigured token, network hiccup, wrong
// dataset) degrades to local-only data rather than breaking the dashboard.
export async function readEventsMerged(days: number): Promise<{ events: LogEvent[]; sources: string[] }> {
  const localEvents = readEvents(days);
  if (!isAxiomConfigured()) {
    return { events: localEvents, sources: ['local'] };
  }

  const axiomEvents = await queryAxiomEvents(days);
  if (axiomEvents.length === 0) {
    return { events: localEvents, sources: ['local'] };
  }

  const byId = new Map<string, LogEvent>();
  for (const e of localEvents) byId.set(String(e.id || `${e.ts}-${e.type}-${Math.random()}`), e);
  for (const e of axiomEvents) byId.set(String(e.id || `${e.ts}-${e.type}-${Math.random()}`), e);
  return { events: Array.from(byId.values()), sources: ['local', 'axiom'] };
}
