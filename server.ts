import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createApp } from './server/routes.ts';
import { closeAllWorkspaceStreams } from './server/sse.ts';

async function startServer() {
  const { app, db, config } = createApp();

  if (!config.isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    app.use(
      '/assets',
      express.static(path.join(distDir, 'assets'), { maxAge: '7d', immutable: true })
    );
    app.use(express.static(distDir, { maxAge: '1d', index: false }));
    app.get('*', (_req, res) => {
      if (fs.existsSync(indexHtml)) {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
      } else {
        res
          .status(503)
          .send('ATK Deck frontend build not found. Run "npm run build" before starting in production.');
      }
    });
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `ATK Deck server listening on http://${config.host}:${config.port} (${config.nodeEnv}, DATA_DIR: ${config.dataDir}, SQLite: ${config.dbPath})`
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`ATK Deck received ${signal}; closing connections and flushing SQLite WAL...`);

    const forceTimer = setTimeout(() => {
      try {
        if (config.dbPath !== ':memory:') {
          db.pragma('wal_checkpoint(TRUNCATE)');
        }
        db.close();
      } catch {
        // ignore close error on forced exit
      }
      process.exit(0);
    }, 8000);
    forceTimer.unref();

    closeAllWorkspaceStreams();
    server.closeIdleConnections?.();
    server.close(() => {
      clearTimeout(forceTimer);
      try {
        if (config.dbPath !== ':memory:') {
          db.pragma('wal_checkpoint(TRUNCATE)');
        }
        db.close();
      } catch {
        // ignore close error
      }
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

void startServer();
