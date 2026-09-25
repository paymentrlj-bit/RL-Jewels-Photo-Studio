// Admin routes: staff accounts, the enhance prompt, and the analytics the
// store actually needs to run this - throughput, QA failure patterns, and
// cost.

import express from 'express';
import { requireAuth, requireAdmin, type AuthenticatedRequest } from '../auth/session';
import { logEvent, actorFrom, readEvents, type EventPayload } from '../logging';
import { checkPasswordPolicy } from '../auth/passwords';
import {
  listUsers,
  createUser,
  setUserPassword,
  setUserActive,
  setUserAdmin,
  findUserById,
  countAdmins,
} from '../auth/users';
import { getEnhancePromptState, setEnhancePrompt, resetEnhancePrompt } from '../settings';
import { countProductsByStatus } from '../db/products';
import { queueDepth } from '../queue/jobs';
import { storageStats } from '../storage/images';
import { getCpcMasterStats } from '../integrations/cpcMaster';
import { COSTS_ARE_CALIBRATED } from '../ai/client';
import { getUsdToInrRate } from '../integrations/exchangeRate';
import { AUDIT_CHECKS } from '../ai/operations';
import { isAxiomConfigured, config } from '../config';

export const adminRouter = express.Router();

// ---------------------------------------------------------------------------
// Client-side event ingestion. Any signed-in user, not admin-only.
// Best-effort: a logging failure must never surface to the user.
// ---------------------------------------------------------------------------

const clientRouter = express.Router();
clientRouter.use(requireAuth);

clientRouter.post('/log-event', (req: AuthenticatedRequest, res) => {
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  for (const event of events.slice(0, 50)) {
    if (!event?.type || typeof event.type !== 'string') continue;
    // The client sends its fields as `data` (src/utils/analytics.ts). This
    // used to read `payload` only, which silently dropped every field - the
    // js_error events in Axiom arrived with no message or stack at all.
    const data = event.data ?? event.payload;
    const payload = data && typeof data === 'object' && !Array.isArray(data) ? (data as EventPayload) : {};
    logEvent(`client.${event.type}`, payload, actorFrom(req.user));
  }
  res.json({ success: true });
});

export { clientRouter };

// ---------------------------------------------------------------------------
// Everything below is admin-only.
// ---------------------------------------------------------------------------

adminRouter.use(requireAdmin);

adminRouter.get('/users', (_req, res) => {
  res.json({ users: listUsers() });
});

adminRouter.post('/users', async (req: AuthenticatedRequest, res) => {
  const { username, password, displayName, isAdmin } = req.body || {};

  const policy = checkPasswordPolicy(String(password || ''));
  if (!policy.ok) {
    res.status(400).json({ error: policy.reason });
    return;
  }

  try {
    const user = await createUser({
      username: String(username || ''),
      password: String(password),
      displayName: displayName ? String(displayName) : undefined,
      isAdmin: Boolean(isAdmin),
    });
    logEvent('admin.user_created', { createdUserId: user.id, username: user.username, isAdmin: user.isAdmin }, actorFrom(req.user));
    res.status(201).json({ user });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

adminRouter.patch('/users/:id', async (req: AuthenticatedRequest, res) => {
  const target = findUserById(req.params.id);
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const actor = req.user!;
  const body = req.body || {};

  // Guards against locking everyone out of admin - a one-admin store that
  // demotes or deactivates its only admin has no way back in short of
  // editing the database by hand.
  const wouldRemoveLastAdmin =
    target.isAdmin &&
    countAdmins() <= 1 &&
    ((body.isAdmin === false) || (body.isActive === false));

  if (wouldRemoveLastAdmin) {
    res.status(409).json({ error: 'This is the only active admin account. Promote another admin first.' });
    return;
  }

  if (typeof body.password === 'string' && body.password) {
    const policy = checkPasswordPolicy(body.password);
    if (!policy.ok) {
      res.status(400).json({ error: policy.reason });
      return;
    }
    await setUserPassword(target.id, body.password);
    logEvent('admin.user_password_reset', { targetUserId: target.id }, actorFrom(actor));
  }

  if (typeof body.isActive === 'boolean') {
    setUserActive(target.id, body.isActive);
    logEvent('admin.user_active_changed', { targetUserId: target.id, isActive: body.isActive }, actorFrom(actor));
  }

  if (typeof body.isAdmin === 'boolean') {
    setUserAdmin(target.id, body.isAdmin);
    logEvent('admin.user_admin_changed', { targetUserId: target.id, isAdmin: body.isAdmin }, actorFrom(actor));
  }

  res.json({ user: findUserById(target.id) });
});

// ---------------------------------------------------------------------------
// The enhance prompt
// ---------------------------------------------------------------------------

adminRouter.get('/prompt', (_req, res) => {
  res.json(getEnhancePromptState());
});

adminRouter.post('/prompt', (req: AuthenticatedRequest, res) => {
  const actor = req.user!;
  try {
    if (req.body?.reset) {
      resetEnhancePrompt(actor.username);
      logEvent('admin.prompt_reset', {}, actorFrom(actor));
    } else {
      setEnhancePrompt(String(req.body?.prompt || ''), actor.username);
      logEvent('admin.prompt_updated', { length: String(req.body?.prompt || '').length }, actorFrom(actor));
    }
    res.json(getEnhancePromptState());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

adminRouter.get('/analytics/summary', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Kicked off alongside the (synchronous) event reads below rather than
  // awaited up front, so a slow or unreachable rate source never adds its
  // latency on top of the event scan - both are ready by the time either is
  // needed for the response.
  const usdToInrPromise = getUsdToInrRate();

  const completions = readEvents({ sinceIso, types: ['pipeline.completed'] });
  const verdicts = readEvents({ sinceIso, types: ['pipeline.audit_verdict'] });
  const apiCalls = readEvents({ sinceIso, types: ['pipeline.api_call'] });
  const escalations = readEvents({ sinceIso, types: ['pipeline.escalated'] });
  const usdToInr = await usdToInrPromise;

  const byStatus: Record<string, number> = {};
  let totalCostUsd = 0;
  let totalLatencyMs = 0;
  let latencySamples = 0;

  for (const event of completions) {
    const status = String(event.payload.status || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
    totalCostUsd += Number(event.payload.estimatedCostUsd) || 0;
    const latency = Number(event.payload.totalLatencyMs);
    if (Number.isFinite(latency)) {
      totalLatencyMs += latency;
      latencySamples++;
    }
  }

  // Which QA check fails most often - the single most useful number here.
  // A dominant "too dark" or "blown highlights" is a lightbox problem;
  // a dominant "matchesOriginalDesign" is a prompt problem. They call for
  // completely different fixes, and without this you are guessing.
  const checkFailures: Record<string, number> = Object.fromEntries(AUDIT_CHECKS.map((c) => [c, 0]));
  let verdictCount = 0;
  for (const event of verdicts) {
    const checklist = event.payload.checklist as Record<string, boolean> | undefined;
    if (!checklist) continue;
    verdictCount++;
    for (const check of AUDIT_CHECKS) {
      if (checklist[check] === false) checkFailures[check]++;
    }
  }

  // Per-stage latency and failure rates, to spot a stage getting slower or
  // flakier before it becomes everyone's problem.
  const stages: Record<string, { calls: number; failures: number; timeouts: number; totalLatencyMs: number }> = {};
  for (const event of apiCalls) {
    const stage = String(event.payload.stage || 'unknown');
    const entry = stages[stage] || (stages[stage] = { calls: 0, failures: 0, timeouts: 0, totalLatencyMs: 0 });
    entry.calls++;
    if (!event.payload.success) entry.failures++;
    if (event.payload.timedOut) entry.timeouts++;
    entry.totalLatencyMs += Number(event.payload.latencyMs) || 0;
  }

  const processed = completions.length;

  res.json({
    windowDays: days,
    generatedAt: new Date().toISOString(),

    throughput: {
      photosProcessed: processed,
      byStatus,
      approvalRate: processed > 0 ? Number((((byStatus.awaiting_review || 0) / processed) * 100).toFixed(1)) : null,
      reshootRate: processed > 0 ? Number((((byStatus.needs_reshoot || 0) / processed) * 100).toFixed(1)) : null,
      escalationCount: escalations.length,
      escalationRate: processed > 0 ? Number(((escalations.length / processed) * 100).toFixed(1)) : null,
      avgLatencyMs: latencySamples > 0 ? Math.round(totalLatencyMs / latencySamples) : null,
    },

    cost: {
      totalEstimatedUsd: Number(totalCostUsd.toFixed(2)),
      avgPerPhotoUsd: processed > 0 ? Number((totalCostUsd / processed).toFixed(4)) : null,
      // Gemini bills in USD; this is a display conversion for a store that
      // thinks in rupees, not a second currency of billing. usdToInrRate
      // is today's market rate where reachable (refreshed every few hours),
      // falling back to the static USD_TO_INR_RATE config value otherwise -
      // rateIsLive says which one this response used. It is still not
      // necessarily Google's own invoice conversion rate; see
      // server/integrations/exchangeRate.ts for why that number isn't
      // available without Billing API credentials.
      totalEstimatedInr: Number((totalCostUsd * usdToInr.rate).toFixed(2)),
      avgPerPhotoInr: processed > 0 ? Number(((totalCostUsd / processed) * usdToInr.rate).toFixed(3)) : null,
      usdToInrRate: usdToInr.rate,
      rateIsLive: usdToInr.live,
      calibrated: COSTS_ARE_CALIBRATED,
      note: COSTS_ARE_CALIBRATED
        ? 'Using the COST_*_USD rates configured for this deployment.'
        : 'PLACEHOLDER RATES - these are estimates, not real Gemini billing. Check your Cloud Billing console after a pilot run and set the COST_*_USD environment variables to make these numbers trustworthy.',
    },

    qualityChecks: {
      verdictsAnalyzed: verdictCount,
      failuresByCheck: checkFailures,
      note: 'The most frequently failing check is the best target for improvement. Exposure and focus failures usually mean a lighting or camera fix; design and colour failures usually mean a prompt fix.',
    },

    stageLatency: Object.fromEntries(
      Object.entries(stages).map(([stage, s]) => [
        stage,
        {
          calls: s.calls,
          failures: s.failures,
          timeouts: s.timeouts,
          avgLatencyMs: s.calls > 0 ? Math.round(s.totalLatencyMs / s.calls) : 0,
        },
      ])
    ),

    system: {
      productCounts: countProductsByStatus(),
      queue: queueDepth(),
      storage: storageStats(),
      cpcMaster: getCpcMasterStats(),
      erpMapping: config.erpMapping,
      axiomMirror: isAxiomConfigured(),
      eventSource: 'local database (durable)',
    },
  });
});

adminRouter.get('/analytics/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const types = req.query.types ? String(req.query.types).split(',') : undefined;
  res.json({ events: readEvents({ types, limit }) });
});
