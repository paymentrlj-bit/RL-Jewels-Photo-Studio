import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';

// Tethered DSLR capture via digiCamControl's standalone CameraControlCmd.exe -
// https://github.com/dukus/digiCamControl. That binary connects to the
// camera, fires the shutter, and writes the resulting file itself; this
// module just shells out to it and reads the file back. Off unless
// DIGICAMCONTROL_PATH is set, so this is a no-op on any host that isn't the
// Windows laptop actually wired to the studio camera (including this dev
// environment).
//
// CameraControlCmd.exe /capture /folder <dir> /filename <name> /iso ... /aperture ... /shutter ...
// (command reference: https://github.com/dukus/digiCamControl/blob/master/CameraControlCmd/Program.cs)

const DIGICAMCONTROL_PATH = process.env.DIGICAMCONTROL_PATH;
const CAPTURE_TIMEOUT_MS = 20_000;

export function isDslrCaptureConfigured(): boolean {
  return Boolean(DIGICAMCONTROL_PATH);
}

export interface DslrCaptureResult {
  imageBase64: string; // data URL
}

export async function captureDslrPhoto(): Promise<DslrCaptureResult> {
  if (!DIGICAMCONTROL_PATH) {
    throw new Error('Studio camera capture is not configured on this server (DIGICAMCONTROL_PATH is not set).');
  }

  const captureDir = path.join(os.tmpdir(), 'rlj-dslr-capture');
  fs.mkdirSync(captureDir, { recursive: true });
  const filenameBase = `capture-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  await new Promise<void>((resolve, reject) => {
    const proc = spawn(DIGICAMCONTROL_PATH, ['/capture', '/folder', captureDir, '/filename', filenameBase]);

    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

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
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`digiCamControl exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 300)}` : ' - check the camera is connected.'}`));
      }
    });
  });

  // digiCamControl decides the final extension itself, so find whatever it
  // just wrote rather than assuming one.
  const files = fs.readdirSync(captureDir).filter((f) => f.startsWith(filenameBase));
  if (files.length === 0) {
    throw new Error('digiCamControl reported success but no output file was found - check the camera is connected and has a memory card if required.');
  }

  const capturedPath = path.join(captureDir, files[0]);
  const buffer = fs.readFileSync(capturedPath);
  const ext = path.extname(capturedPath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  for (const f of files) {
    try {
      fs.unlinkSync(path.join(captureDir, f));
    } catch {
      // Temp bridge file - not worth failing the request over a cleanup miss.
    }
  }

  return { imageBase64: `data:${mimeType};base64,${buffer.toString('base64')}` };
}
