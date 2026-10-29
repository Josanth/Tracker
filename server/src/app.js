import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import dashboardRoutes from './routes/dashboard.js';
import { HttpError } from './util.js';

export function createApp(db, { exposeResetToken = process.env.NODE_ENV !== 'production', staticDir } = {}) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.use(authRoutes(db, { exposeResetToken }));
  api.use(projectRoutes(db));
  api.use(taskRoutes(db));
  api.use(dashboardRoutes(db));
  api.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'API route not found')));
  app.use('/api', api);

  // In production the built React app is served from the same origin.
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON' } });
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  return app;
}
