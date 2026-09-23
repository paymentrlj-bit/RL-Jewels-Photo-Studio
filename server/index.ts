// Server bootstrap.
//
// Boot order matters and is deliberate:
//   1. config      - throws immediately in production if a security-critical
//                    value is missing, so a misconfigured deploy fails loudly
//                    at startup instead of running insecurely.
//   2. database    - migrations run before anything can read or write.
//   3. bootstrap   - first admin account, only on an empty database.
//   4. CPC master  - loaded before traffic, as in v1.
//   5. routes
//   6. workers     - started last, after orphan recovery, so a restart
//                    mid-batch picks up where it left off.

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, ensureDataDirs, isGeminiConfigured, isDriveConfigured } from './config';
import { initDatabase, getDb, closeDatabase } from './db';
import { ensureBootstrapAdmin } from './auth/users';
import { initCpcMaster } from './integrations/cpcMaster';
import { startWorkers, stopWorkers } from './queue/worker';
import { queueDepth } from './queue/jobs';
import { logEvent, flushLogs, pruneOldEvents, actorFrom } from './logging';
import { getSessionUser } from './auth/session';
import { pruneOldLoginAttempts } from './auth/rateLimit';
import { allMappings, getMapping } from './export/mappings';
import { authRouter } from './routes/auth';
import { productsRouter } from './routes/products';
import { catalogRouter } from './routes/catalog';
import { exportRouter } from './routes/exports';
import { adminRouter, clientRouter } from './routes/admin';

// Builds the API app: JSON body parsing, every router, and the /api 404
// fallback. Split out from main() so tests can mount exactly what production
// serves under /api without also booting the AI worker, the SPA static
// server, or the vite dev middleware - none of which a route test needs or
// wants running.
export function createApp(): express.Express {
  const app = express();

  // 25MB: a tethered DSLR JPEG at full resolution can run to 10-15MB, and
  // base64 inflates it by a third. v1's 20MB limit was close enough to that
  // ceiling for a high-resolution capture to be rejected outright.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  // Behind Cloud Run, nginx or a Cloudflare Tunnel, this is what makes req.ip
  // the real client rather than the proxy - which the login lockout depends on.
  app.set('trust proxy', true);

  // One event per API request: method, path, status, latency, who. This is
  // what would have caught yesterday's hang from the inside (had the process
  // still been responsive enough to log at all) and is what makes "which
  // endpoint is slow" or "who hit this" answerable after the fact instead of
  // guessed at. Logged on 'finish', not before, so status/duration are real.
  app.use('/api', (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logEvent(
        'http.request',
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
        },
        actorFrom(getSessionUser(req) || undefined)
      );
    });
    next();
  });

  app.use('/api', authRouter);
  app.use('/api', productsRouter);
  app.use('/api', catalogRouter);
  app.use('/api', exportRouter);
  app.use('/api', clientRouter);
  app.use('/api/admin', adminRouter);

  // Any unmatched /api path is a 404 in JSON, not the SPA's index.html, so a
  // frontend bug calling a wrong path surfaces as a clear error rather than
  // as "unexpected token < in JSON".
  //
  // Note that an UNAUTHENTICATED request to an unknown path gets 401 from the
  // routers above before reaching here. That is the better answer anyway - it
  // does not tell an anonymous caller which endpoints exist.
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint.' });
  });

  return app;
}

async function main(): Promise<void> {
  ensureDataDirs();
  initDatabase(config.dbPath);
  await ensureBootstrapAdmin(getDb(), config.bootstrapAdminUsername, config.bootstrapAdminPassword);

  const app = createApp();

  if (config.isProduction) {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Imported lazily so vite is never pulled into the production process.
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  // Errors that escape a route handler. Without this, express's default
  // handler replies with an HTML stack trace, which leaks paths and breaks
  // any client expecting JSON. Logged, not just printed - a console.error on
  // a server nobody is tailing might as well not have happened.
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[http] unhandled error:', err);
    logEvent('http.unhandled_error', {
      method: req.method,
      path: req.path,
      message: err.message,
      stack: err.stack?.slice(0, 2000),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Something went wrong handling that request.' });
    }
  });

  // Loaded before traffic, as in v1 - the Sheet is the source of truth and
  // the bundled CSV is the fallback if it is unreachable.
  await initCpcMaster();

  // Surfaces a bad ERP_MAPPING at boot rather than at the moment someone
  // tries to export a day's work.
  const activeMapping = getMapping(config.erpMapping);
  if (activeMapping.id !== config.erpMapping) {
    console.warn(`[config] ERP_MAPPING="${config.erpMapping}" does not exist. Available: ${allMappings().map((m) => m.id).join(', ')}`);
  }

  startWorkers();

  // Housekeeping, hourly. unref'd so it never holds the process open.
  const housekeeping = setInterval(() => {
    try {
      pruneOldLoginAttempts();
      pruneOldEvents();
    } catch (err) {
      console.warn('[housekeeping] prune failed:', (err as Error).message);
    }
  }, 60 * 60 * 1000);
  housekeeping.unref();

  // A "this process was alive and responsive" event every 5 minutes. On its
  // own this proves nothing an uptime check outside the box doesn't already
  // prove better - but a VM can hang at the OS level while the process is
  // still technically running (exactly what happened on 2026-09-22: CPU
  // spiked, Oracle's own monitoring agent went silent, SSH stopped
  // responding). When that happens, this stream stopping is a second,
  // independent signal in Axiom, and memoryRssMb over time is what turns
  // "the box hung" from a one-off mystery into a trend worth acting on
  // before it hangs again.
  const heartbeat = setInterval(() => {
    const mem = process.memoryUsage();
    logEvent('system.heartbeat', {
      uptimeSec: Math.round(process.uptime()),
      memoryRssMb: Math.round(mem.rss / (1024 * 1024)),
      memoryHeapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      queueDepth: queueDepth(),
    });
  }, 5 * 60 * 1000);
  heartbeat.unref();

  const server = app.listen(config.port, () => {
    console.log(`\nRL Jewels Photo Studio`);
    console.log(`  listening    http://localhost:${config.port}`);
    console.log(`  mode         ${config.isProduction ? 'production' : 'development'}`);
    console.log(`  data dir     ${config.dataDir}`);
    console.log(`  erp mapping  ${activeMapping.label} (${activeMapping.id})`);
    console.log(`  features     ai=${isGeminiConfigured()} drive=${isDriveConfigured()}`);
    console.log('');
    logEvent('server.started', {
      port: config.port,
      isProduction: config.isProduction,
      erpMapping: activeMapping.id,
      features: { ai: isGeminiConfigured(), drive: isDriveConfigured() },
    });
  });

  // Cloud Run and Docker send SIGTERM and then kill. Draining in-flight jobs
  // first means a deploy does not leave half-processed photos behind -
  // anything still running is requeued at next boot by recoverOrphanedJobs().
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[server] ${signal} received, shutting down.`);

    server.close();
    await stopWorkers();
    logEvent('server.stopped', { signal });
    await flushLogs();
    closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Without these, an exception or rejection nothing anticipated crashes the
  // process with nothing but whatever the terminal happened to be showing -
  // gone the moment Docker restarts it. This is the server-side twin of the
  // window.addEventListener('error'/'unhandledrejection', ...) catch-all
  // already in src/utils/analytics.ts: the one place left that could fail
  // silently and never be known about.
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaught exception:', err);
    logEvent('server.crashed', { kind: 'uncaughtException', message: err.message, stack: err.stack?.slice(0, 2000) });
    void flushLogs().finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[server] unhandled rejection:', err);
    logEvent('server.crashed', { kind: 'unhandledRejection', message: err.message, stack: err.stack?.slice(0, 2000) });
    void flushLogs().finally(() => process.exit(1));
  });
}

// Only actually boot when this file is the process entrypoint - not when
// something (route tests, most notably) imports createApp() from it. Without
// this guard, importing anything from this module starts the real HTTP
// listener, the AI worker pool and a live CPC master fetch as a side effect
// of the import, which is exactly the kind of thing that makes a test suite
// flaky and slow for reasons nobody importing the file would expect.
//
// Two branches because this file runs under two different module systems:
// `tsx` runs it as real ESM (package.json has "type": "module"), where
// import.meta.url is the reliable check - but the production build
// (`esbuild --format=cjs`) forces CommonJS via the .cjs extension, and
// esbuild leaves import.meta as an empty stub in that format rather than
// polyfilling it. require.main === module is the correct check there, and
// only there, which is why it is gated behind checking require exists first.
const isEntryPoint = (() => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url && process.argv[1]) {
      return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
    }
  } catch {
    // fall through to the CommonJS check below
  }
  try {
    return typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module;
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  main().catch((err) => {
    // A config error here is the intended fail-fast path, so print it
    // plainly rather than as an unhandled rejection stack.
    console.error(`\n[server] failed to start: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
