import { or } from '@prisma/orm-postgres/orm-client';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { config } from '../config/env.js';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { getPagination, getStringQuery, paged } from '../lib/pagination.js';
import { db } from '../prisma/db.js';
import { serializeUser, serializeUserWithRider } from '../serializers/user.serializer.js';
import { setAccountStatus } from '../services/user.service.js';
import type { AccountStatus, UserRole, UserRow } from '../types/db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_STATUSES: AccountStatus[] = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
const ROLES: UserRole[] = ['CUSTOMER', 'RIDER', 'ADMIN'];

async function loadUserWithProfile(user: UserRow) {
  const profile = user.role === 'RIDER' ? await db.orm.public.RiderProfile.first({ userId: user.id }) : null;
  return serializeUserWithRider(user, profile);
}

export const me = asyncHandler(async (req: Request, res: Response) => {
  res.json({ user: await loadUserWithProfile(req.user!) });
});

/** Self-service profile update: name, phone, password (with current password). */
export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const patch: Record<string, string> = {};

  if (req.body.firstName !== undefined) patch.firstName = String(req.body.firstName);
  if (req.body.lastName !== undefined) patch.lastName = String(req.body.lastName);
  if (req.body.phone !== undefined) patch.phone = String(req.body.phone);

  if (req.body.password !== undefined) {
    const currentPassword = String(req.body.currentPassword ?? '');
    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) throw ApiError.validation(['currentPassword is incorrect']);
    patch.passwordHash = await bcrypt.hash(String(req.body.password), config.bcryptRounds);
  }

  if (Object.keys(patch).length === 0) throw ApiError.badRequest('No changes supplied');

  const updated = await db.orm.public.User.where({ id: user.id }).update(patch);
  if (!updated) throw ApiError.notFound('User not found');
  res.json({ user: await loadUserWithProfile(updated) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  let q = db.orm.public.User.where((u) => u.id.isNotNull());

  const role = getStringQuery(req, 'role');
  if (role) {
    if (!ROLES.includes(role as UserRole)) throw ApiError.badRequest(`role must be one of: ${ROLES.join(', ')}`);
    q = q.where((u) => u.role.eq(role as UserRole));
  }

  const status = getStringQuery(req, 'status');
  if (status) {
    if (!ACCOUNT_STATUSES.includes(status as AccountStatus)) {
      throw ApiError.badRequest(`status must be one of: ${ACCOUNT_STATUSES.join(', ')}`);
    }
    q = q.where((u) => u.status.eq(status as AccountStatus));
  }

  const search = getStringQuery(req, 'search');
  if (search) {
    const term = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    q = q.where((u) => or(u.email.ilike(term), u.firstName.ilike(term), u.lastName.ilike(term)));
  }

  const [rows, countResult] = await Promise.all([
    q.orderBy([(u) => u.createdAt.desc(), (u) => u.id.desc()])
      .offset(pagination.offset)
      .limit(pagination.limit)
      .all(),
    q.aggregate((a) => ({ total: a.count() })),
  ]);

  res.json(paged(rows.map(serializeUser), countResult.total, pagination));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw ApiError.notFound('User not found');
  const user = await db.orm.public.User.first({ id });
  if (!user) throw ApiError.notFound('User not found');
  res.json({ user: await loadUserWithProfile(user) });
});

export const changeStatus = asyncHandler(async (req: Request, res: Response) => {
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) throw ApiError.notFound('User not found');
  const target = await db.orm.public.User.first({ id });
  if (!target) throw ApiError.notFound('User not found');

  const status = String(req.body.status ?? '') as AccountStatus;
  if (!ACCOUNT_STATUSES.includes(status)) {
    throw ApiError.badRequest(`status must be one of: ${ACCOUNT_STATUSES.join(', ')}`);
  }

  const updated = await setAccountStatus(target, status, req.user!);
  res.json({ user: serializeUser(updated) });
});
