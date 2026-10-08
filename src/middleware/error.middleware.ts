import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors.js';
import { config } from '../config/env.js';

export const notFoundHandler = (_req: Request, res: Response): void => {
  res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) return next(error);

  if (error instanceof ApiError) {
    return res.status(error.status).json({
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
  }

  // Prisma / database constraint violations that escaped the service layer.
  const code = (error as { code?: string })?.code;
  if (typeof code === 'string' && code.startsWith('P2')) {
    return res.status(409).json({ error: 'Resource constraint violated', code: 'CONFLICT' });
  }

  console.error(`[${req.method} ${req.originalUrl}]`, error);
  return res.status(500).json({
    error: config.nodeEnv === 'production' ? 'Internal server error' : String((error as Error)?.message ?? error),
    code: 'INTERNAL_ERROR',
  });
};
