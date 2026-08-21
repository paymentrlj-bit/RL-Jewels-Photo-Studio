// Standalone tethered-camera bridge for the fixed lightbox station.
//
// This runs ON THE LENOVO ITSELF (the only machine physically wired to the
// Canon body), separate from the main cloud-hosted app. It exists because a
// cloud server has no way to reach a USB-connected camera - this bridge is
// the one piece of the system that has to live next to the hardware.
//
// The cloud server calls POST /capture over the internet (via a Cloudflare
// Tunnel - see ../DSLR_CAPTURE_SETUP.md), authenticated with a shared
// secret, and this process shells out to digiCamControl's command-line tool
// to actually trigger the shutter and read back the photo.
//
// Zero npm dependencies on purpose - Node's built-in `http` and
// `child_process` are enough, so setup on the Lenovo is just "install
// Node, run this file."

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

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
const DIGICAMCONTROL_PATH = process.env.DIGICAMCONTROL_PATH;
const BRIDGE_SECRET = process.env.BRIDGE_SECRET;
// 45s, not 20s - CameraControlCmd.exe has to launch, connect over USB,
// autofocus, fire the shutter, and transfer the file back, and on a low-power
// laptop (dual-core, 4GB RAM) that pipeline can genuinely take longer than a
// desktop-class machine would need. Cutting the process off mid-transfer
// early was also leaving the camera itself stuck showing "buSY" until
// power-cycled, which this headroom avoids in the common case.
const CAPTURE_TIMEOUT_MS = 45_000;

if (!DIGICAMCONTROL_PATH) {
  log('WARNING: DIGICAMCONTROL_PATH is not set - /capture will always fail until it is.');
}
if (!BRIDGE_SECRET) {
  log('WARNING: BRIDGE_SECRET is not set - refusing to start, since this bridge will be reachable from the internet.');
  log('Set BRIDGE_SECRET to a long random value (matching DSLR_BRIDGE_SECRET on the cloud server) and restart.');
  process.exit(1);
}

function capturePhoto() {
  return new Promise((resolve, reject) => {
    if (!DIGICAMCONTROL_PATH) {
      reject(new Error('DIGICAMCONTROL_PATH is not set on this bridge.'));
      return;
    }
    const captureDir = path.join(os.tmpdir(), 'rlj-dslr-capture');
    fs.mkdirSync(captureDir, { recursive: true });
    // Real hardware test: passing /filename to CameraControlCmd.exe throws
    // "Transfer error! Path cannot be the empty string or all whitespace"
    // on this digiCamControl build - it never successfully saves a file.
    // Omitting it and letting the camera use its own sequential naming
    // (DSC_0001.JPG, DSC_0002.JPG, ...) works reliably, so we just find
    // whichever image file is newest in the folder after capture instead.
    const captureStartedAt = Date.now();

    const proc = spawn(DIGICAMCONTROL_PATH, ['/capture', '/folder', captureDir]);
    let stderr = '';
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`DSLR capture timed out after ${CAPTURE_TIMEOUT_MS / 1000}s - check the camera is connected, powered on, and not asleep.`));
    }, CAPTURE_TIMEOUT_MS);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Could not launch digiCamControl at "${DIGICAMCONTROL_PATH}": ${err.message}`));
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      const captureMs = Date.now() - captureStartedAt;
      if (code !== 0) {
        reject(new Error(`digiCamControl exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ' - check the camera is connected.'}`));
        return;
      }
      try {
        const readStartedAt = Date.now();
        const imageExts = new Set(['.jpg', '.jpeg', '.png']);
        // Find the newest image file written to this folder since capture
        // started - digiCamControl names files with its own sequential
        // counter (DSC_0001.JPG, ...), not anything we control.
        const files = fs
          .readdirSync(captureDir)
          .filter((f) => imageExts.has(path.extname(f).toLowerCase()))
          .map((f) => ({ name: f, mtimeMs: fs.statSync(path.join(captureDir, f)).mtimeMs }))
          // A couple seconds of slack for clock/filesystem timestamp granularity.
          .filter((f) => f.mtimeMs >= captureStartedAt - 2000)
          .sort((a, b) => b.mtimeMs - a.mtimeMs)
          .map((f) => f.name);
        if (files.length === 0) {
          reject(new Error('digiCamControl reported success but no output file was found - check the camera is connected and has a memory card if required.'));
          return;
        }
        const capturedPath = path.join(captureDir, files[0]);
        const buffer = fs.readFileSync(capturedPath);
        const ext = path.extname(capturedPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
        for (const f of files) {
          try { fs.unlinkSync(path.join(captureDir, f)); } catch {}
        }
        const readMs = Date.now() - readStartedAt;
        log(`timing: digiCamControl(shutter+USB transfer)=${captureMs}ms, file read+encode=${readMs}ms, total=${captureMs + readMs}ms`);
        resolve({ imageBase64: `data:${mimeType};base64,${buffer.toString('base64')}`, captureMs, readMs });
      } catch (err) {
        reject(err);
      }
    });
  });
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

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    send(res, 200, { available: Boolean(DIGICAMCONTROL_PATH) });
    return;
  }

  if (req.method === 'POST' && req.url === '/capture') {
    const authHeader = req.headers['authorization'] || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!provided || !timingSafeEqual(provided, BRIDGE_SECRET)) {
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
  log(`DIGICAMCONTROL_PATH: ${DIGICAMCONTROL_PATH || '(not set)'}`);
});
