// Stateless signed-cookie sessions, carried over from v1.
//
// The reasoning there was sound and still applies: an in-memory session store
// logs every signed-in staff member out whenever the container restarts, which
// on a scale-to-zero host happens several times a day. A signed cookie
// survives that without needing a session table.
//
// What changed from v1: the cookie carries a user id rather than a username
// plus an isAdmin boolean, so revoking or demoting an account takes effect on
// the next request instead of whenever that person's 12-hour cookie happens
// to expire.

import crypto from 'crypto';
import type express from 'express';
import { config } from '../config';
import { findUserById, type User } from './users';

const SESSION_COOKIE = 'rlj_session';

interface SessionPayload {
  uid: string;
  exp: number;
}

export interface AuthenticatedRequest extends express.Request {
  user?: User;
}

function sign(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function unsign(token: string): SessionPayload | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.exp || Date.now() > payload.exp) return null;
    if (!payload.uid) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setSessionCookie(res: express.Response, user: User): void {
  const token = sign({ uid: user.id, exp: Date.now() + config.sessionTtlMs });
  const secure = config.isProduction ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      config.sessionTtlMs / 1000
    )}${secure}`
  );
}

export function clearSessionCookie(res: express.Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Resolves the cookie to a live user row, so a deactivated account stops
// working immediately rather than at cookie expiry.
//
// Memoized per request: several routers are mounted at /api and each runs
// requireAuth, so without this a single request would hit the users table
// once per mounted router. The cache lives on the request object, so it
// cannot outlive the request or leak one user's session into another's.
const RESOLVED = Symbol('rlj.resolvedUser');

interface RequestWithCache extends express.Request {
  [RESOLVED]?: User | null;
}

export function getSessionUser(req: express.Request): User | null {
  const cached = req as RequestWithCache;
  if (RESOLVED in cached) return cached[RESOLVED] ?? null;

  const resolve = (): User | null => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;

    const payload = unsign(token);
    if (!payload) return null;

    const user = findUserById(payload.uid);
    if (!user || !user.isActive) return null;
    return user;
  };

  const user = resolve();
  cached[RESOLVED] = user;
  return user;
}

export function requireAuth(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
): void {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  req.user = user;
  next();
}

export function requireAdmin(
  req: AuthenticatedRequest,
  res: express.Response,
  next: express.NextFunction
): void {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  if (!user.isAdmin) {
    res.status(403).json({ error: 'This action requires an admin account.' });
    return;
  }
  req.user = user;
  next();
}
