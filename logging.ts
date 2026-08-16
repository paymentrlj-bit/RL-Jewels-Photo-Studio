import fs from 'fs';
import path from 'path';

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
// Caveat worth knowing: this writes to local disk. If this server is hosted
// on a platform with ephemeral storage (containers recycled on every deploy
// or idle-restart), logs older than the current container's lifetime will be
// lost. Fine for iterating locally or on a host with a persistent disk/volume
// - if that's not your setup, treat /api/analytics/summary's numbers as
// "since last restart" rather than a permanent record.

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
  ts: string;
  type: string;
  username?: string;
  isAdmin?: boolean;
  [key: string]: unknown;
}

export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function logEvent(type: string, data: Record<string, unknown> = {}, session?: LoggedSession | null): void {
  ensureLogDir();
  const ts = new Date().toISOString();
  const event: LogEvent = {
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
}

// Reads every event logged in the last `days` days, newest files included.
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
