import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { ApiError } from './errors.js';

export type AuthPayload = {
  sub: string;
  role: string;
  email: string;
};

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
    issuer: 'delivery-platform',
  });
}

export function verifyToken(token: string): AuthPayload {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, { issuer: 'delivery-platform' });
    if (typeof decoded === 'string' || !decoded.sub || typeof decoded.role !== 'string') {
      throw new Error('malformed payload');
    }
    return { sub: decoded.sub, role: decoded.role, email: String(decoded.email ?? '') };
  } catch {
    throw ApiError.invalidToken();
  }
}

export function extractToken(header?: string, cookie?: string): string | null {
  if (cookie) return cookie;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}
