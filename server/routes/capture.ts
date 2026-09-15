// Tethered studio camera (DSLR) routes. Ported from v1 essentially unchanged -
// the bridge protocol and its reasoning are documented in DSLR_CAPTURE_SETUP.md
// and in server/integrations/dslrBridge.ts.

import express from 'express';
import { Readable } from 'stream';
import type { ReadableStream } from 'stream/web';
import { requireAuth, type AuthenticatedRequest } from '../auth/session';
import { logEvent, actorFrom } from '../logging';
import { debugDetail } from '../ai/client';
import {
  isDslrCaptureConfigured,
  isDslrBridgeReachable,
  captureDslrPhoto,
  getDslrLiveViewStream,
  autofocusDslr,
  focusNudgeDslr,
} from '../integrations/dslrBridge';

export const captureRouter = express.Router();
captureRouter.use(requireAuth);

function notConfigured(res: express.Response): void {
  res.status(503).json({ error: 'Studio camera capture is not configured on this server.' });
}

captureRouter.get('/dslr-capture/status', async (req: AuthenticatedRequest, res) => {
  if (!isDslrCaptureConfigured()) {
    res.json({ available: false, configured: false });
    return;
  }
  // Configured isn't the same as reachable right now - the Lenovo or camera
  // may simply be powered off, which the UI should show as "not available"
  // rather than a broken button.
  const available = await isDslrBridgeReachable();
  logEvent('dslr.status_check', { available }, actorFrom(req.user));
  res.json({ available, configured: true });
});

// Proxies the bridge's live-view feed so staff can frame and focus before
// pressing capture. Routed through here rather than the browser hitting the
// tunnel URL directly for two reasons: it reuses this app's normal staff
// login instead of needing a public camera feed, and it keeps BRIDGE_SECRET
// server-side - a plain <img src> cannot send an Authorization header.
captureRouter.get('/dslr-capture/live', async (_req, res) => {
  if (!isDslrCaptureConfigured()) {
    notConfigured(res);
    return;
  }
  try {
    const upstream = await getDslrLiveViewStream();
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'multipart/x-mixed-replace',
      'Cache-Control': 'no-cache, no-transform',
    });
    const nodeStream = Readable.fromWeb(upstream.body as ReadableStream);
    nodeStream.pipe(res);
    // If the browser navigates away, stop pulling frames from the bridge
    // rather than leaking an open connection indefinitely.
    res.on('close', () => nodeStream.destroy());
  } catch (err) {
    console.error('dslr live view proxy failed:', (err as Error)?.message || err);
    if (!res.headersSent) res.status(502).json({ error: debugDetail(err) });
  }
});

captureRouter.post('/dslr-capture', async (req: AuthenticatedRequest, res) => {
  const startedAt = Date.now();
  if (!isDslrCaptureConfigured()) {
    notConfigured(res);
    return;
  }
  try {
    const result = await captureDslrPhoto();
    // captureMs/readMs come from the bridge itself (camera + USB transfer vs
    // local file read and encode). Without this, that breakdown exists only
    // in bridge.log on the Lenovo, invisible to the durable event log.
    logEvent('dslr.capture', {
      success: true,
      latencyMs: Date.now() - startedAt,
      cameraTransferMs: result.captureMs ?? null,
      fileReadEncodeMs: result.readMs ?? null,
    }, actorFrom(req.user));
    res.json({ success: true, imageBase64: result.imageBase64 });
  } catch (err) {
    console.error('DSLR capture failed:', (err as Error)?.message || err);
    logEvent('dslr.capture', {
      success: false,
      latencyMs: Date.now() - startedAt,
      errorMessage: debugDetail(err),
    }, actorFrom(req.user));
    res.status(502).json({ error: (err as Error)?.message || 'Studio camera capture failed.', debugDetail: debugDetail(err) });
  }
});

captureRouter.post('/dslr-capture/focus', async (req: AuthenticatedRequest, res) => {
  const startedAt = Date.now();
  if (!isDslrCaptureConfigured()) {
    notConfigured(res);
    return;
  }
  try {
    await autofocusDslr();
    logEvent('dslr.autofocus', { success: true, latencyMs: Date.now() - startedAt }, actorFrom(req.user));
    res.json({ success: true });
  } catch (err) {
    console.error('DSLR autofocus failed:', (err as Error)?.message || err);
    logEvent('dslr.autofocus', { success: false, latencyMs: Date.now() - startedAt, errorMessage: debugDetail(err) }, actorFrom(req.user));
    res.status(502).json({ error: (err as Error)?.message || 'Studio camera autofocus failed.', debugDetail: debugDetail(err) });
  }
});

captureRouter.post('/dslr-capture/focus/nudge', async (req: AuthenticatedRequest, res) => {
  const startedAt = Date.now();
  if (!isDslrCaptureConfigured()) {
    notConfigured(res);
    return;
  }
  const { direction, amount } = req.body || {};
  if (direction !== 'near' && direction !== 'far') {
    res.status(400).json({ error: 'direction must be "near" or "far".' });
    return;
  }
  if (amount !== 'small' && amount !== 'large') {
    res.status(400).json({ error: 'amount must be "small" or "large".' });
    return;
  }
  try {
    await focusNudgeDslr(direction, amount);
    logEvent('dslr.focus_nudge', { success: true, direction, amount, latencyMs: Date.now() - startedAt }, actorFrom(req.user));
    res.json({ success: true });
  } catch (err) {
    console.error('DSLR focus nudge failed:', (err as Error)?.message || err);
    logEvent('dslr.focus_nudge', {
      success: false, direction, amount,
      latencyMs: Date.now() - startedAt, errorMessage: debugDetail(err),
    }, actorFrom(req.user));
    res.status(502).json({ error: (err as Error)?.message || 'Studio camera focus nudge failed.', debugDetail: debugDetail(err) });
  }
});
