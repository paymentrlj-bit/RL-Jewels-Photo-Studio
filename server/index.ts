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
import { config, ensureDataDirs, isGeminiConfigured, isDriveConfigured } from './config';
import { initDatabase, getDb, closeDatabase } from './db';
import { ensureBootstrapAdmin } from './auth/users';
import { initCpcMaster } from './integrations/cpcMaster';
import { startWorkers, stopWorkers } from './queue/worker';
import { logEvent, flushLogs, pruneOldEvents } from './logging';
import { pruneOldLoginAttempts } from './auth/rateLimit';
import { allMappings, getMapping } from './export/mappings';
import { authRouter } from './routes/auth';
import { productsRouter } from './routes/products';
import { catalogRouter } from './routes/catalog';
import { exportRouter } from './routes/exports';
import { adminRouter, clientRouter } from './routes/admin';

async function main(): Promise<void> {
  ensureDataDirs();
  initDatabase(config.dbPath);
  await ensureBootstrapAdmin(getDb(), config.bootstrapAdminUsername, config.bootstrapAdminPassword);

  const app = express();

  // 25MB: a tethered DSLR JPEG at full resolution can run to 10-15MB, and
  // base64 inflates it by a third. v1's 20MB limit was close enough to that
  // ceiling for a high-resolution capture to be rejected outright.
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  // Behind Cloud Run, nginx or a Cloudflare Tunnel, this is what makes req.ip
  // the real client rather than the proxy - which the login lockout depends on.
  app.set('trust proxy', true);

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
  // any client expecting JSON.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[http] unhandled error:', err);
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
}

main().catch((err) => {
  // A config error here is the intended fail-fast path, so print it plainly
  // rather than as an unhandled rejection stack.
  console.error(`\n[server] failed to start: ${(err as Error).message}\n`);
  process.exit(1);
});
