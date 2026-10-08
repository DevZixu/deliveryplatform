import type { NextFunction, Request, RequestHandler, Response } from 'express';

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTHENTICATION_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'INVALID_TOKEN'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_INACTIVE'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: string[];

  constructor(status: number, code: ErrorCode, message: string, details?: string[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static validation(details: string[]): ApiError {
    return new ApiError(400, 'VALIDATION_FAILED', 'Validation failed', details);
  }
  static badRequest(message: string, details?: string[]): ApiError {
    return new ApiError(400, 'VALIDATION_FAILED', message, details);
  }
  static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, 'AUTHENTICATION_REQUIRED', message);
  }
  static invalidCredentials(): ApiError {
    return new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  static invalidToken(): ApiError {
    return new ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
  }
  static forbidden(message = 'You do not have permission to perform this action'): ApiError {
    return new ApiError(403, 'FORBIDDEN', message);
  }
  static suspended(): ApiError {
    return new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  }
  static inactive(): ApiError {
    return new ApiError(403, 'ACCOUNT_INACTIVE', 'This account is inactive');
  }
  static notFound(message = 'Resource not found'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string): ApiError {
    return new ApiError(409, 'CONFLICT', message);
  }
  static invalidState(message: string): ApiError {
    return new ApiError(409, 'INVALID_STATE', message);
  }
}

/** Wraps an async handler so rejections reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
