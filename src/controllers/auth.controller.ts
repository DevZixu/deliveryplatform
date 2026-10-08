import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { config } from '../config/env.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { signToken } from '../lib/tokens.js';
import { db } from '../prisma/db.js';
import type { UserRow } from '../types/db.js';
import { serializeUserWithRider } from '../serializers/user.serializer.js';

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

function issueToken(res: Response, user: UserRow): string {
  const token = signToken({ sub: user.id, role: user.role, email: user.email });
  res.cookie('access_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });
  return token;
}

async function loadWithProfile(user: UserRow) {
  const profile = user.role === 'RIDER' ? await db.orm.public.RiderProfile.first({ userId: user.id }) : null;
  return serializeUserWithRider(user, profile);
}

/**
 * Register a customer or a rider. Admin accounts are provisioned by the
 * seed script — never through the public API.
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const email = normalizeEmail(String(req.body.email));
  const { password, firstName, lastName, phone, role, vehicleType, vehiclePlate, licenseNumber, city } =
    req.body as {
      password: string;
      firstName: string;
      lastName: string;
      phone?: string;
      role?: 'CUSTOMER' | 'RIDER';
      vehicleType?: string;
      vehiclePlate?: string;
      licenseNumber?: string;
      city?: string;
    };

  if (role === 'RIDER') {
    const missing: string[] = [];
    if (!vehicleType) missing.push('vehicleType is required for riders');
    if (!vehiclePlate) missing.push('vehiclePlate is required for riders');
    if (!licenseNumber) missing.push('licenseNumber is required for riders');
    if (missing.length) throw ApiError.validation(missing);
  }

  const existing = await db.orm.public.User.first({ email });
  if (existing) throw ApiError.conflict('An account with that email already exists');

  const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
  const selectedRole = role ?? 'CUSTOMER';

  const user = await db.orm.public.User.create({
    id: crypto.randomUUID(),
    email,
    passwordHash,
    firstName,
    lastName,
    phone: phone ?? null,
    role: selectedRole,
    status: 'ACTIVE',
  });

  if (selectedRole === 'RIDER') {
    await db.orm.public.RiderProfile.create({
      id: crypto.randomUUID(),
      userId: user.id,
      availability: 'OFFLINE',
      vehicleType: vehicleType!,
      vehiclePlate: vehiclePlate!,
      licenseNumber: licenseNumber!,
      city: city ?? null,
      isVerified: false,
      completedRuns: 0,
    });
  }

  const token = issueToken(res, user);
  res.status(201).json({ token, user: await loadWithProfile(user) });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const email = normalizeEmail(String(req.body.email));
  const { password } = req.body as { password: string };

  const user = await db.orm.public.User.first({ email });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw ApiError.invalidCredentials();
  }
  if (user.status === 'SUSPENDED') throw ApiError.suspended();
  if (user.status === 'INACTIVE') throw ApiError.inactive();

  const token = issueToken(res, user);
  res.json({ token, user: await loadWithProfile(user) });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie('access_token', { httpOnly: true, sameSite: 'lax', path: '/' });
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  res.json({ user: await loadWithProfile(req.user!) });
});
