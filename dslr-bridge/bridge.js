// Standalone tethered-camera bridge for the fixed lightbox station.
//
// This runs ON THE LENOVO ITSELF (the only machine physically wired to the
// Canon body), separate from the main cloud-hosted app. It exists because a
// cloud server has no way to reach a USB-connected camera - this bridge is
// the one piece of the system that has to live next to the hardware.
//
// The cloud server calls POST /capture and GET /live over the internet (via
// a Cloudflare Tunnel - see ../DSLR_CAPTURE_SETUP.md), authenticated with a
// shared secret, and this process talks to digiCamControl's own built-in web
// server (a separate thing from this bridge - it's a feature of the full
// digiCamControl GUI app, which must be running with live view started) to
// trigger captures and relay the live preview feed.
//
// Real hardware finding: capturing via a freshly-spawned CameraControlCmd.exe
// process while digiCamControl's GUI has live view active fails outright -
// two separate OS processes fighting over the same USB camera handle. Going
// through digiCamControl's own HTTP API instead (the same process instance
// that owns live view) works cleanly, which is why this bridge talks to that
// API rather than shelling out to the CLI tool the way earlier versions did.
//
// Zero npm dependencies on purpose - Node's built-in `http`/`https` are
// enough, so setup on the Lenovo is just "install Node, run this file."

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Task Scheduler runs this with no visible console window, so console.log
// alone disappears - mirror everything to a log file next to bridge.js too,
// so timing breakdowns are checkable after the fact either way.
const LOG_FILE = path.join(__dirname, 'bridge.log');
function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  try { fs.appendFileSync(LOG_FILE, stamped + '\n'); } catch {}
}

const PORT = Number(process.env.PORT) || 3001;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
// digiCamControl's own web server, always localhost since it and this bridge
// run on the same Lenovo - not worth an env var, this never varies. Requires
// File -> Settings -> Webserver -> "Use web server" enabled in the GUI app,
// and that app must be running (not just CameraControlCmd.exe) for any of
// this - including plain captures now - to work.
const WEBSERVER_BASE = 'http://localhost:5513';
// The MJPEG live-view stream digiCamControl serves once live view is
// started - a *different* port than the web server above.
const LIVEVIEW_STREAM_URL = 'http://127.0.0.1:5514/live';
// 45s, not 20s - the capture call has to reach the camera over USB,
// autofocus, fire the shutter, and transfer the file back, and on a
// low-power laptop (dual-core, 4GB RAM) that pipeline can genuinely take
// longer than a desktop-class machine would need. Real captures observed
// 8.7-9.9s; this headroom covers a slow one without cutting it off early -
// doing that previously left the camera itself stuck "buSY" until
// power-cycled.
const CAPTURE_TIMEOUT_MS = 45_000;
// How long to keep polling the capture folder for the new file after the
// capture HTTP call returns "OK" - covers any brief gap between the response
// and the file actually finishing its write to disk.
const FILE_POLL_TIMEOUT_MS = 8_000;
const FILE_POLL_INTERVAL_MS = 300;

if (!BRIDGE_SECRET) {
  log('WARNING: BRIDGE_SECRET is not set - refusing to start, since this bridge will be reachable from the internet.');
  log('Set BRIDGE_SECRET to a long random value (matching DSLR_BRIDGE_SECRET on the cloud server) and restart.');
  process.exit(1);
}

// Minimal GET helper (no npm deps) that resolves with the response body as
// text, or rejects on network error / timeout. Used for the small, fast
// webserver calls (capture trigger, live-view resume, status ping) - not
// for the live-view stream itself, which is proxied by piping instead.
//
// Talks over a raw TCP socket instead of Node's http.get(). Real hardware
// finding: digiCamControl's own web server sends a malformed response with
// a duplicate Content-Length header on these endpoints, which Node's
// default (strict, llhttp-based) parser rejects outright with "Parse
// Error: Duplicate Content-Length" - and setting insecureHTTPParser: true
// on http.get() was NOT enough to work around it on the Node version this
// runs on; that flag doesn't cover every malformed-header case in every
// Node release. These calls are all small plain-text/JSON GETs to
// localhost, so hand-rolling the request/response here entirely
// sidesteps Node's HTTP parser (and its opinions about what a "valid"
// response looks like) rather than depending on it being lenient enough.
function httpGetText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const socket = net.createConnection({ host: parsed.hostname, port: Number(parsed.port) || 80 });

    let raw = Buffer.alloc(0);
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(arg);
    };

    const timer = setTimeout(() => finish(reject, new Error('timed out')), timeoutMs);

    socket.on('connect', () => {
      const requestPath = parsed.pathname + parsed.search;
      socket.write(`GET ${requestPath} HTTP/1.1\r\nHost: ${parsed.hostname}\r\nConnection: close\r\n\r\n`);
    });
    socket.on('data', (chunk) => { raw = Buffer.concat([raw, chunk]); });
    socket.on('end', () => {
      const text = raw.toString('utf8');
      const headerEnd = text.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        finish(resolve, { statusCode: 0, body: '' });
        return;
      }
      const statusLine = text.slice(0, headerEnd).split('\r\n')[0];
      const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)/);
      const statusCode = statusMatch ? Number(statusMatch[1]) : 0;
      const body = text.slice(headerEnd + 4);
      finish(resolve, { statusCode, body });
    });
    socket.on('error', (err) => finish(reject, err));
  });
}

// Fire-and-forget: bring live view back after a capture (or on startup).
// Never blocks or fails the caller - if this doesn't work, the next /status
// check or a manual click in the GUI recovers it, and the studio-critical
// path (actually capturing the photo) isn't held hostage to it.
function resumeLiveView() {
  httpGetText(`${WEBSERVER_BASE}/?CMD=LiveViewWnd_Show`, 5_000)
    .then(() => log('live view resumed'))
    .catch((err) => log(`live view resume failed (non-fatal): ${err.message}`));
}

function waitForCapturedFile(captureDir, capturedAfter) {
  const imageExts = new Set(['.jpg', '.jpeg', '.png']);
  const deadline = Date.now() + FILE_POLL_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const tick = () => {
      let files = [];
      try {
        files = fs
          .readdirSync(captureDir)
          .filter((f) => imageExts.has(path.extname(f).toLowerCase()))
          .map((f) => ({ name: f, mtimeMs: fs.statSync(path.join(captureDir, f)).mtimeMs }))
          // A couple seconds of slack for clock/filesystem timestamp granularity.
          .filter((f) => f.mtimeMs >= capturedAfter - 2000)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .map((f) => f.name);
      } catch (err) {
        reject(err);
        return;
      }
      if (files.length > 0) {
        resolve(files);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('digiCamControl reported success but no output file appeared - check the GUI app\'s save folder is set to the path in DSLR_CAPTURE_SETUP.md.'));
        return;
      }
      setTimeout(tick, FILE_POLL_INTERVAL_MS);
    };
    tick();
  });
}

async function capturePhoto() {
  const captureDir = path.join(os.tmpdir(), 'rlj-dslr-capture');
  fs.mkdirSync(captureDir, { recursive: true });
  const captureStartedAt = Date.now();

  // camera= is left empty deliberately - real hardware test confirmed
  // digiCamControl defaults to whatever's currently connected, which avoids
  // hardcoding this camera's name/serial (and breaking if the body is ever
  // swapped).
  const { statusCode, body } = await httpGetText(`${WEBSERVER_BASE}/?slc=capture&camera=`, CAPTURE_TIMEOUT_MS);
  if (statusCode !== 200 || !/ok/i.test(body)) {
    throw new Error(`digiCamControl capture command failed (HTTP ${statusCode}): ${body.slice(0, 300) || 'no response body'}`);
  }
  const captureMs = Date.now() - captureStartedAt;

  const readStartedAt = Date.now();
  const files = await waitForCapturedFile(captureDir, captureStartedAt);
  const capturedPath = path.join(captureDir, files[0]);
  const buffer = fs.readFileSync(capturedPath);
  const ext = path.extname(capturedPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  for (const f of files) {
    try { fs.unlinkSync(path.join(captureDir, f)); } catch {}
  }
  const readMs = Date.now() - readStartedAt;
  log(`timing: digiCamControl(shutter+USB transfer)=${captureMs}ms, file read+encode=${readMs}ms, total=${captureMs + readMs}ms`);

  // Live view stops the moment a real capture fires (expected DSLR
  // behavior - the mirror has to physically flip for an actual exposure,
  // which can't happen while live view is reading the sensor continuously)
  // - bring it back now so the feed is ready again without staff needing to
  // do anything.
  resumeLiveView();

  return { imageBase64: `data:${mimeType};base64,${buffer.toString('base64')}`, captureMs, readMs };
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req) {
  const authHeader = req.headers['authorization'] || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return Boolean(provided) && timingSafeEqual(provided, BRIDGE_SECRET);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    // Live check, not a static config boolean - this now depends on the
    // full digiCamControl GUI app actually running with its web server on,
    // not just a file path being set, so ping it for real.
    try {
      const { statusCode } = await httpGetText(`${WEBSERVER_BASE}/session.json`, 3_000);
      send(res, 200, { available: statusCode === 200 });
    } catch {
      send(res, 200, { available: false });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/live') {
    // Same auth as /capture - this is a real (if unexciting) camera feed of
    // the studio, not something to leave open to anyone who finds the
    // tunnel hostname.
    if (!isAuthorized(req)) {
      send(res, 401, { error: 'Unauthorized.' });
      return;
    }
    const upstream = http.get(LIVEVIEW_STREAM_URL, (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 200, {
        'Content-Type': upstreamRes.headers['content-type'] || 'multipart/x-mixed-replace',
        'Cache-Control': 'no-cache, no-transform',
      });
      upstreamRes.pipe(res);
    });
    upstream.on('error', (err) => {
      log(`live view proxy failed: ${err.message}`);
      if (!res.headersSent) send(res, 502, { error: 'Live view is not available - is live view started in digiCamControl?' });
      else res.end();
    });
    // If the caller (cloud server) disconnects, stop pulling the stream.
    req.on('close', () => upstream.destroy());
    return;
  }

  if (req.method === 'POST' && req.url === '/capture') {
    if (!isAuthorized(req)) {
      send(res, 401, { error: 'Unauthorized.' });
      return;
    }
    try {
      const result = await capturePhoto();
      log('capture ok');
      send(res, 200, { success: true, imageBase64: result.imageBase64, captureMs: result.captureMs, readMs: result.readMs });
    } catch (err) {
      log(`capture failed: ${err.message}`);
      send(res, 502, { error: err.message || 'Studio camera capture failed.' });
    }
    return;
  }

  send(res, 404, { error: 'Not found.' });
});

server.listen(PORT, () => {
  log(`DSLR bridge listening on http://localhost:${PORT}`);
  log(`digiCamControl web server expected at: ${WEBSERVER_BASE}`);
  resumeLiveView();
});
