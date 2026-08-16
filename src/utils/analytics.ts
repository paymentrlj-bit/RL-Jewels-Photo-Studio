// Lightweight, best-effort client-side event logger. Events are queued and
// sent in small batches to /api/log-event (which fans them into the same
// structured log the server-side pipeline writes to - see logging.ts) so the
// full staff journey (not just the API calls) is visible for analysis:
// which step people stall on, which capture method they used, how often an
// OCR-autofilled field needed correcting, whether generated copy got edited,
// and so on.
//
// Logging must never affect the app itself: every failure here is swallowed
// silently, and nothing here blocks or throws into the caller.

interface QueuedEvent {
  type: string;
  data: Record<string, unknown>;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function isMobileUserAgent(): boolean {
  try {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function flush(useBeacon = false): void {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  const payload = JSON.stringify({ events: batch });

  try {
    if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon('/api/log-event', blob);
      return;
    }
  } catch {
    // fall through to fetch
  }

  fetch('/api/log-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
  }).catch(() => {
    // best-effort only - a logging failure must never surface to the user
  });
}

// Queues a client-side event. Batches up to 10 events or 3 seconds of
// inactivity, whichever comes first, so normal usage doesn't spam the
// network with one request per click.
export function logClientEvent(type: string, data: Record<string, unknown> = {}): void {
  try {
    queue.push({
      type,
      data: {
        ...data,
        isMobile: isMobileUserAgent(),
        viewportWidth: typeof window !== 'undefined' ? window.innerWidth : undefined,
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : undefined,
      },
    });
    if (queue.length >= 10) {
      flush();
      return;
    }
    if (!flushTimer) {
      flushTimer = setTimeout(() => flush(), 3000);
    }
  } catch {
    // never let logging break the app
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => flush(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush(true);
  });
}
