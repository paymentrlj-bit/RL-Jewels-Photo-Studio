import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, checkPasswordPolicy } from '../auth/passwords';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong horse battery staple', hash)).toBe(false);
  });

  it('produces a different hash each time, so equal passwords are not detectable', async () => {
    const a = await hashPassword('same-password-here');
    const b = await hashPassword('same-password-here');
    expect(a).not.toBe(b);
    // Both must still verify - the difference is the salt, not the password.
    expect(await verifyPassword('same-password-here', a)).toBe(true);
    expect(await verifyPassword('same-password-here', b)).toBe(true);
  });

  it('encodes its parameters so they can be raised later without breaking old hashes', async () => {
    const hash = await hashPassword('some-password-value');
    const [algorithm, N, r, p] = hash.split('$');
    expect(algorithm).toBe('scrypt');
    expect(Number(N)).toBeGreaterThanOrEqual(1 << 16);
    expect(Number(r)).toBe(8);
    expect(Number(p)).toBe(1);
  });

  it('returns false rather than throwing on a malformed stored hash', async () => {
    // A corrupt row must fail the login, not crash the login endpoint.
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
    expect(await verifyPassword('anything', 'scrypt$1$2$3')).toBe(false);
  });

  it('handles unicode passwords', async () => {
    const hash = await hashPassword('पासवर्ड-१२३४५६');
    expect(await verifyPassword('पासवर्ड-१२३४५६', hash)).toBe(true);
    expect(await verifyPassword('पासवर्ड-१२३४५७', hash)).toBe(false);
  });
});

describe('checkPasswordPolicy', () => {
  it('accepts a reasonable password', () => {
    expect(checkPasswordPolicy('lightbox-counter-2026').ok).toBe(true);
  });

  it('rejects anything under 10 characters', () => {
    expect(checkPasswordPolicy('short').ok).toBe(false);
  });

  it('rejects the v1 shared passwords specifically', () => {
    // v1 defaulted to "admin" and "gold". Neither should ever be settable again.
    expect(checkPasswordPolicy('admin').ok).toBe(false);
    expect(checkPasswordPolicy('gold').ok).toBe(false);
    expect(checkPasswordPolicy('gold123').ok).toBe(false);
  });

  it('rejects an absurdly long password rather than spending CPU on it', () => {
    expect(checkPasswordPolicy('x'.repeat(500)).ok).toBe(false);
  });
});
