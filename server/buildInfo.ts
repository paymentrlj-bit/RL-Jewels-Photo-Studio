// Identifies the frontend build being served, so an open tab can tell that
// the server has been updated underneath it.
//
// Staff keep the app open on the counter phone all day. A deploy replaces the
// server, but the tab keeps running the JavaScript it loaded that morning -
// which is how the counter phone was still on the old tag scanner hours after
// the new one shipped.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

let cached: string | null = null;

// index.html names the hashed JS and CSS bundles, so its hash changes exactly
// when the frontend does.
export function frontendBuildId(): string {
  if (cached) return cached;
  try {
    const html = fs.readFileSync(path.join(process.cwd(), 'dist', 'index.html'));
    cached = crypto.createHash('sha1').update(html).digest('hex').slice(0, 12);
  } catch {
    cached = 'dev';
  }
  return cached;
}
