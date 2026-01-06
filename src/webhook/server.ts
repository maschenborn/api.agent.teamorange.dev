import express, { type Express } from 'express';
import { healthRouter } from './routes/health.js';
import { emailWebhookRouter } from './routes/email.js';
import { verifyResendSignature } from './middleware/verify-signature.js';
import { executeRouter } from '../api/routes/execute.js';
import { statusRouter } from '../api/routes/status.js';
import { sessionsRouter } from '../api/routes/sessions.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

export function createServer(): Express {
  const app = express();

  // Parse JSON for all routes except webhook (needs raw body for signature verification)
  app.use((req, res, next) => {
    if (req.path === '/webhook/email') {
      express.text({ type: 'application/json' })(req, res, next);
    } else {
      express.json()(req, res, next);
    }
  });

  // Routes
  app.use('/health', healthRouter);

  // API Routes (JWT protected)
  app.use('/api/execute', executeRouter);
  app.use('/api/status', statusRouter);
  app.use('/api/sessions', sessionsRouter);

  // Webhook Routes
  app.use('/webhook/email', verifyResendSignature, emailWebhookRouter);

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

export function startServer(): void {
  const app = createServer();
  const port = config.port;

  app.listen(port, () => {
    logger.info({ port }, '🚀 Webhook server started');
  });
}
