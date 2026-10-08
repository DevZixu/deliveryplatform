import 'dotenv/config';
import { randomBytes } from 'node:crypto';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret = process.env.JWT_SECRET ?? randomBytes(48).toString('hex');

if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

const number = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  nodeEnv,
  port: number(process.env.PORT, 4000),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  databaseUrl: process.env.DATABASE_URL,
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  bcryptRounds: 12,
  /** Delivery pricing model, applied server-side on every delivery creation. */
  pricing: {
    baseFee: number(process.env.PRICE_BASE, 2.5),
    perKm: number(process.env.PRICE_PER_KM, 1.25),
    minimumFee: number(process.env.PRICE_MINIMUM, 3),
    perKgSurcharge: number(process.env.PRICE_PER_KG, 0.4),
  },
  authRateLimit: { windowMs: 15 * 60 * 1000, limit: number(process.env.AUTH_RATE_LIMIT, 30) },
  apiRateLimit: { windowMs: 15 * 60 * 1000, limit: number(process.env.API_RATE_LIMIT, 600) },
} as const;

export type Config = typeof config;
