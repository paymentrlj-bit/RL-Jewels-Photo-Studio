// Cloud-side client for the tethered studio camera. The actual camera
// hardware is wired to the Lenovo at the fixed lightbox station, not to
// this (cloud-hosted) server, so capture happens over the network: a small
// bridge process running on the Lenovo (see dslr-bridge/) does the local
// work and exposes it at DSLR_BRIDGE_URL, reachable via a Cloudflare
// Tunnel. This module just calls that URL - see DSLR_CAPTURE_SETUP.md for
// the full setup.
//
// Off unless both DSLR_BRIDGE_URL and DSLR_BRIDGE_SECRET are set, exactly
// like the Drive export pattern elsewhere in this app.

const DSLR_BRIDGE_URL = process.env.DSLR_BRIDGE_URL?.replace(/\/+$/, '');
const DSLR_BRIDGE_SECRET = process.env.DSLR_BRIDGE_SECRET;
const STATUS_TIMEOUT_MS = 4_000;
// Must stay comfortably above the bridge's own CAPTURE_TIMEOUT_MS (45s) so
// the bridge's own clean JSON error (if it times out) has time to travel
// back through the tunnel before this side gives up first.
const CAPTURE_TIMEOUT_MS = 55_000;

export function isDslrCaptureConfigured(): boolean {
  return Boolean(DSLR_BRIDGE_URL && DSLR_BRIDGE_SECRET);
}

// Whether the bridge is actually configured AND reachable right now - the
// Lenovo may simply be powered off, which isn't an error, just "not
// available at this moment." A short timeout keeps this from hanging the
// status check if the machine is unreachable.
export async function isDslrBridgeReachable(): Promise<boolean> {
  if (!isDslrCaptureConfigured()) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(`${DSLR_BRIDGE_URL}/status`, { signal: controller.signal });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data?.available);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export interface DslrCaptureResult {
  imageBase64: string; // data URL
  // Bridge-reported stage timing (shutter+USB transfer vs local file
  // read+encode) - lets the cloud-side log distinguish camera/USB latency
  // from network/tunnel latency without needing to check bridge.log on the
  // Lenovo itself, which is invisible to the durable analytics otherwise.
  captureMs?: number;
  readMs?: number;
}

// Proxies the bridge's live-view MJPEG feed. No AbortController/timeout
// here on purpose - this is meant to stay open for as long as the browser
// keeps the stream open, not bounded like the other short request/response
// calls above. The caller (server.ts) is responsible for tearing this down
// when the browser disconnects.
export async function getDslrLiveViewStream(): Promise<Response> {
  if (!DSLR_BRIDGE_URL || !DSLR_BRIDGE_SECRET) {
    throw new Error('Studio camera capture is not configured on this server (DSLR_BRIDGE_URL/DSLR_BRIDGE_SECRET are not set).');
  }
  const response = await fetch(`${DSLR_BRIDGE_URL}/live`, {
    headers: { Authorization: `Bearer ${DSLR_BRIDGE_SECRET}` },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Studio camera live view is not available (HTTP ${response.status}).`);
  }
  return response;
}

export async function captureDslrPhoto(): Promise<DslrCaptureResult> {
  if (!DSLR_BRIDGE_URL || !DSLR_BRIDGE_SECRET) {
    throw new Error('Studio camera capture is not configured on this server (DSLR_BRIDGE_URL/DSLR_BRIDGE_SECRET are not set).');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);
  try {
    const response = await fetch(`${DSLR_BRIDGE_URL}/capture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${DSLR_BRIDGE_SECRET}` },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || `Studio camera bridge returned HTTP ${response.status}.`);
    }
    return { imageBase64: data.imageBase64, captureMs: data.captureMs, readMs: data.readMs };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Studio camera capture timed out - the Lenovo bridge may be offline or the camera unresponsive.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
