// Password hashing with scrypt from Node's own crypto module.
//
// No bcrypt/argon2 dependency on purpose: both are native modules that need a
// compiler in the Docker image, and scrypt is a memory-hard KDF built into
// Node with no such cost. For a handful of staff accounts on a single-store
// tool this is the right trade.
//
// v1 stored no password hashes at all - it compared a plaintext env var. That
// worked only because there were exactly two shared passwords, which is the
// thing being fixed here.

import crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options?: crypto.ScryptOptions
) => Promise<Buffer>;

// OWASP's current floor for scrypt is N=2^17 with r=8, p=1. Raising N later
// is safe: the parameters are encoded in each stored hash, so old hashes keep
// verifying and only re-hash on the user's next password change.
const SCRYPT_N = 1 << 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    // scrypt's memory need is roughly 128 * N * r bytes (~128MB at these
    // parameters). Node's default maxmem is 32MB and would reject the call
    // outright, so it has to be raised to match.
    maxmem: 256 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');

    if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    const derived = await scrypt(password, salt, expected.length, {
      N, r, p,
      maxmem: 256 * 1024 * 1024,
    });

    // Length check first: timingSafeEqual throws on a length mismatch rather
    // than returning false.
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

// Deliberately modest: length is what actually matters, and complexity rules
// push people toward writing passwords on a sticky note by the lightbox.
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (password.length < 10) {
    return { ok: false, reason: 'Password must be at least 10 characters.' };
  }
  if (password.length > 200) {
    return { ok: false, reason: 'Password must be 200 characters or fewer.' };
  }
  const weak = ['password', 'admin', '1234567890', 'rljewels', 'gold'];
  if (weak.some((w) => password.toLowerCase() === w || password.toLowerCase() === `${w}123`)) {
    return { ok: false, reason: 'That password is too easy to guess. Pick something else.' };
  }
  return { ok: true };
}
