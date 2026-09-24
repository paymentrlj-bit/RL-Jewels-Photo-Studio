// Stamps dist/sw.js with a hash of this build's own output, so the service
// worker script is byte-different from the last deploy.
//
// This has to run AFTER `vite build` (which copies public/sw.js into dist/
// verbatim) and is the actual fix behind "the service worker never updates":
// a browser only re-fetches and installs a new service worker when the
// script's bytes differ from what it already has. A static file copied
// unchanged into every build is never different, so the worker - and the
// stale JS bundle it was serving cache-first - never got replaced no matter
// how many times the server itself redeployed.
//
// Hashing the built assets (not just a timestamp) also means an identical
// rebuild (no source changes) does not force every open tab to reinstall a
// worker for nothing.

import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const distDir = path.join(process.cwd(), 'dist');
const swPath = path.join(distDir, 'sw.js');

if (!fs.existsSync(swPath)) {
  console.warn('[stamp-sw] dist/sw.js not found - skipping (public/sw.js missing?)');
  process.exit(0);
}

const assetsDir = path.join(distDir, 'assets');
const hash = createHash('sha256');
if (fs.existsSync(assetsDir)) {
  // Sorted so the hash is stable across filesystems/build order, not just
  // across identical content.
  for (const name of fs.readdirSync(assetsDir).sort()) {
    hash.update(name);
    hash.update(fs.readFileSync(path.join(assetsDir, name)));
  }
}
const stamp = hash.digest('hex').slice(0, 12);

const source = fs.readFileSync(swPath, 'utf8');
if (!source.includes('__CACHE_NAME__')) {
  console.warn('[stamp-sw] __CACHE_NAME__ placeholder not found in dist/sw.js - is public/sw.js out of sync with this script?');
  process.exit(1);
}
fs.writeFileSync(swPath, source.replace(/__CACHE_NAME__/g, stamp));
console.log(`[stamp-sw] dist/sw.js stamped with build ${stamp}`);
