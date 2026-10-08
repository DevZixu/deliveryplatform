import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../lib/errors.js';
import { extractToken, verifyToken } from '../lib/tokens.js';
import type { AuthPayload } from '../lib/tokens.js';
import { db } from '../prisma/db.js';
import type { UserRow } from '../types/db.js';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthPayload;
    user?: UserRow;
  }
}

/**
 * Verifies the JWT, then re-reads the account from the database so that
 * suspended / deactivated accounts lose access immediately — the token
 * alone is never enough to grant access.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractToken(req.get('authorization'), req.cookies?.access_token);
    if (!token) throw ApiError.unauthorized();

    const auth = verifyToken(token);
    const user = await db.orm.public.User.first({ id: auth.sub });
    if (!user) throw ApiError.invalidToken();
    if (user.status === 'SUSPENDED') throw ApiError.suspended();
    if (user.status === 'INACTIVE') throw ApiError.inactive();

    req.auth = auth;
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/** Restricts an authenticated route to the listed roles. */
export function authorize(...roles: string[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden('This endpoint is not available to your role'));
    }
    return next();
  };
}
