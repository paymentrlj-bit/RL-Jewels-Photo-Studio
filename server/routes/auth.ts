import express from 'express';
import { authenticate } from '../auth/users';
import { setSessionCookie, clearSessionCookie, getSessionUser, requireAuth, type AuthenticatedRequest } from '../auth/session';
import { checkLockout, recordLoginAttempt } from '../auth/rateLimit';
import { logEvent, actorFrom } from '../logging';
import { isGeminiConfigured, isDriveConfigured, isAxiomConfigured, config } from '../config';

export const authRouter = express.Router();

// Behind a proxy (Cloud Run, nginx, a Cloudflare Tunnel) req.ip is the
// proxy's address unless trust proxy is set, which would make the per-IP half
// of the lockout useless. The forwarded header is checked first and treated
// as a hint only - it is client-controlled, so it can widen the set of
// buckets an attacker is throttled across but never unlock an account.
function clientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return (req.ip || '').slice(0, 64);
}

authRouter.post('/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const ip = clientIp(req);

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' });
    return;
  }

  const lockout = checkLockout(username, ip);
  if (lockout.locked) {
    logEvent('auth.login_locked_out', { username, ip, failures: lockout.failuresInWindow });
    res.status(429)
      .set('Retry-After', String(lockout.retryAfterSeconds))
      .json({
        error: `Too many failed sign-in attempts. Try again in ${Math.ceil(lockout.retryAfterSeconds / 60)} minute(s).`,
        retryAfterSeconds: lockout.retryAfterSeconds,
      });
    return;
  }

  const user = await authenticate(username, password);
  recordLoginAttempt(username, ip, Boolean(user));

  if (!user) {
    logEvent('auth.login_failure', { username, ip });
    // Deliberately does not say whether the username exists.
    res.status(401).json({ error: 'Incorrect username or password.' });
    return;
  }

  setSessionCookie(res, user);
  logEvent('auth.login_success', { ip }, actorFrom(user));
  res.json({ username: user.username, displayName: user.displayName, isAdmin: user.isAdmin });
});

authRouter.post('/logout', (req, res) => {
  const user = getSessionUser(req);
  if (user) logEvent('auth.logout', {}, actorFrom(user));
  clearSessionCookie(res);
  res.json({ success: true });
});

authRouter.get('/session', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = req.user!;
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  });
});

// Public so the sign-in screen can warn about a misconfigured server before
// anyone types a password. Says only whether a feature is on, never what any
// credential is.
authRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    features: {
      ai: isGeminiConfigured(),
      driveExport: isDriveConfigured(),
      axiomMirror: isAxiomConfigured(),
    },
    erpMapping: config.erpMapping,
  });
});
