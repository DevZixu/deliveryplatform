import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';
import { config } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import authRoutes from './routes/auth.routes.js';
import deliveriesRoutes from './routes/deliveries.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import ridersRoutes from './routes/riders.routes.js';
import statsRoutes from './routes/stats.routes.js';
import usersRoutes from './routes/users.routes.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  if (config.nodeEnv !== 'test') app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));

  app.use(
    '/api',
    rateLimit({
      windowMs: config.apiRateLimit.windowMs,
      limit: config.apiRateLimit.limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'delivery-platform', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/riders', ridersRoutes);
  app.use('/api/deliveries', deliveriesRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/stats', statsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
