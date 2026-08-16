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
// box) as a fast local buffer. If AXIOM_TOKEN is set (see LOGGING_SETUP.md),
// every event is ALSO forwarded to Axiom - a durable, queryable external log
// sink - so history survives a redeploy/idle-restart on a host with
// ephemeral container storage.
//
// Once Axiom is configured, /api/analytics/summary reads EXCLUSIVELY from
// Axiom, not local disk - by request, so the dashboard's numbers always
// reflect one single source of truth rather than a merge of a durable store
// and a possibly-stale local buffer. If the Axiom query itself fails, that
// failure is surfaced as a real error (not silently papered over with local
// data), so a misconfiguration is visible and diagnosable instead of just
// quietly showing incomplete numbers.

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

const AXIOM_QUERY_TIMEOUT_MS = 15_000;

// Axiom's APL query API has returned events under a couple of different
// response shapes across API versions - this handles both defensively:
//   1. { matches: [ { data: {...event fields...} }, ... ] }
//   2. { tables: [ { fields: [{name}], columns: [[...],[...],...] } ] } (columnar)
// Throws a descriptive error if neither shape is recognized, rather than
// silently returning nothing - an unrecognized shape is a bug worth seeing,
// not swallowing.
function parseAxiomEvents(body: any): LogEvent[] {
  if (Array.isArray(body?.matches)) {
    return body.matches
      .map((m: any) => (m && typeof m === 'object' && m.data && typeof m.data === 'object' ? m.data : m))
      .filter((e: any) => e && typeof e === 'object' && typeof e.type === 'string');
  }

  if (Array.isArray(body?.tables) && body.tables.length > 0) {
    const table = body.tables[0];
    const fieldNames: string[] = Array.isArray(table?.fields)
      ? table.fields.map((f: any) => f?.name).filter((n: any) => typeof n === 'string')
      : [];
    const columns: any[][] = Array.isArray(table?.columns) ? table.columns : [];
    if (fieldNames.length > 0 && columns.length > 0) {
      const rowCount = columns[0]?.length || 0;
      const rows: LogEvent[] = [];
      for (let i = 0; i < rowCount; i++) {
        const row: any = {};
        fieldNames.forEach((name, colIdx) => {
          row[name] = columns[colIdx]?.[i];
        });
        const candidate = row.data && typeof row.data === 'object' ? row.data : row;
        if (candidate && typeof candidate.type === 'string') rows.push(candidate);
      }
      return rows;
    }
    // A table with zero matching rows is a legitimate, valid result (e.g. a
    // brand new dataset) - not a parse failure.
    if (fieldNames.length === 0 && columns.length === 0) return [];
  }

  // An explicitly empty/absent result set (e.g. Axiom omits both keys when
  // there's nothing to return) is also legitimate, not a parse failure.
  if (body && typeof body === 'object' && !('matches' in body) && !('tables' in body)) {
    if (body.status && typeof body.status === 'object') return [];
  }

  throw new Error(
    `Unrecognized Axiom query response shape (keys: ${body && typeof body === 'object' ? Object.keys(body).join(', ') : typeof body}). ` +
    'The query API response format may have changed - please report this so the parser can be updated.'
  );
}

// Queries Axiom for events in the last `days` days via APL (Axiom's query
// language). Asks for raw rows, not a server-side aggregation - the exact
// same JS aggregation code that already runs against local JSONL runs
// against these rows too, so there's only one aggregation code path to
// trust, not two. Throws on any failure (network, non-2xx, unrecognized
// response shape) - callers decide whether to surface or fall back.
export async function queryAxiomEvents(days: number): Promise<LogEvent[]> {
  if (!isAxiomConfigured()) return [];
  const safeDataset = AXIOM_DATASET.replace(/'/g, "\\'");
  const apl = `['${safeDataset}'] | where _time > ago(${Math.max(1, Math.round(days))}d) | limit 50000`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AXIOM_QUERY_TIMEOUT_MS);
  try {
    // 'format' is required by Axiom's APL query API, but as a URL query
    // parameter, NOT a JSON body field (confirmed against Axiom's official
    // Go client, which hardcodes ?format=tabular) - sending it in the body
    // still throws "format in query is required", since the API never reads
    // it from there. 'tabular' returns the { tables: [...] } columnar shape,
    // which parseAxiomEvents already handles.
    const res = await fetch('https://api.axiom.co/v1/datasets/_apl?format=tabular', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AXIOM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apl }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Axiom query failed with HTTP ${res.status}${errText ? `: ${errText.slice(0, 300)}` : ` (${res.statusText})`}`);
    }
    const body: any = await res.json();
    return parseAxiomEvents(body);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Axiom query timed out after ${AXIOM_QUERY_TIMEOUT_MS / 1000}s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// The single entry point /api/analytics/summary should use. When Axiom is
// configured, it is the EXCLUSIVE source - no merge with local disk, and a
// query failure propagates as a real error rather than silently degrading
// to local data, so a misconfiguration is visible instead of just quietly
// showing incomplete numbers. Local disk remains the source when Axiom
// isn't configured at all.
export async function readEventsForAnalytics(days: number): Promise<{ events: LogEvent[]; sources: string[] }> {
  if (isAxiomConfigured()) {
    const axiomEvents = await queryAxiomEvents(days);
    return { events: axiomEvents, sources: ['axiom'] };
  }
  return { events: readEvents(days), sources: ['local'] };
}
