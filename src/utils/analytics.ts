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

export function isMobileUserAgent(): boolean {
  try {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

// Network Information API - Chrome/Android only, undefined elsewhere. This is
// what turns "it felt slow on mobile" from a guess into a measurable claim:
// if timeouts/slow pipeline runs cluster on '2g'/'slow-2g' samples, that
// confirms a network cause instead of a server one.
function getNetworkInfo(): Record<string, unknown> {
  try {
    const conn =
      (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!conn) return {};
    return {
      networkEffectiveType: conn.effectiveType,
      networkDownlinkMbps: conn.downlink,
      networkRttMs: conn.rtt,
      networkSaveData: conn.saveData,
    };
  } catch {
    return {};
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
        ...getNetworkInfo(),
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

  // Catch-all for uncaught exceptions and unhandled promise rejections -
  // this is what catches things nobody anticipated logging a specific event
  // for. A crash that never gets reported can't ever be fixed.
  window.addEventListener('error', (e) => {
    logClientEvent('js_error', {
      kind: 'error',
      message: String(e.message || 'Unknown error').slice(0, 500),
      source: e.filename,
      line: e.lineno,
      stack: e.error?.stack ? String(e.error.stack).slice(0, 1000) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason: any = e.reason;
    logClientEvent('js_error', {
      kind: 'unhandledrejection',
      message: String(reason?.message || reason || 'Unknown rejection').slice(0, 500),
      stack: reason?.stack ? String(reason.stack).slice(0, 1000) : undefined,
    });
  });
}
