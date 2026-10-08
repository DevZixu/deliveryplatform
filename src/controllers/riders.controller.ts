import type { Request, Response } from 'express';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { getPagination, getStringQuery, paged } from '../lib/pagination.js';
import { db } from '../prisma/db.js';
import { serializeRiderProfile, serializeUserWithRider } from '../serializers/user.serializer.js';
import { setAvailability, updateRiderProfile } from '../services/rider.service.js';
import type { RiderAvailability, RiderProfileRow, UserRow } from '../types/db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RIDER_STATUSES = ['AVAILABLE', 'OFFLINE'] as const;

async function requireTargetRider(id: string): Promise<{ user: UserRow; profile: RiderProfileRow }> {
  if (!UUID_RE.test(id)) throw ApiError.notFound('Rider not found');
  const user = await db.orm.public.User.first({ id });
  if (!user || user.role !== 'RIDER') throw ApiError.notFound('Rider not found');
  const profile = await db.orm.public.RiderProfile.first({ userId: user.id });
  if (!profile) throw ApiError.notFound('Rider profile not found');
  return { user, profile };
}

/** The signed-in rider reads their own profile. */
export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const profile = await db.orm.public.RiderProfile.first({ userId: user.id });
  if (!profile) throw ApiError.notFound('Rider profile not found');
  res.json({ rider: serializeRiderProfile(profile), user: serializeUserWithRider(user, profile) });
});

/** Self-service profile edits (vehicle, licence, city) — verification stays with admins. */
export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const profile = await updateRiderProfile(req.user!, req.body as Record<string, string>);
  res.json({ rider: serializeRiderProfile(profile) });
});

export const setMyAvailability = asyncHandler(async (req: Request, res: Response) => {
  const target = String(req.body.availability ?? '');
  if (!(RIDER_STATUSES as readonly string[]).includes(target)) {
    throw ApiError.badRequest(`availability must be one of: ${RIDER_STATUSES.join(', ')}`);
  }
  const profile = await setAvailability(req.user!, target as 'AVAILABLE' | 'OFFLINE');
  res.json({ rider: serializeRiderProfile(profile) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPagination(req);
  let q = db.orm.public.RiderProfile.where((r) => r.id.isNotNull());

  const availability = getStringQuery(req, 'availability');
  if (availability) {
    const allowed = ['AVAILABLE', 'BUSY', 'OFFLINE'];
    if (!allowed.includes(availability)) {
      throw ApiError.badRequest(`availability must be one of: ${allowed.join(', ')}`);
    }
    q = q.where((r) => r.availability.eq(availability as RiderAvailability));
  }

  const verified = getStringQuery(req, 'verified');
  if (verified === 'true' || verified === 'false') {
    q = q.where((r) => r.isVerified.eq(verified === 'true'));
  }

  const search = getStringQuery(req, 'search');
  if (search) {
    const term = `%${search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    q = q.where((r) => r.vehiclePlate.ilike(term));
  }

  const [rows, countResult] = await Promise.all([
    q.orderBy([(r) => r.createdAt.desc(), (r) => r.id.desc()])
      .offset(pagination.offset)
      .limit(pagination.limit)
      .all(),
    q.aggregate((a) => ({ total: a.count() })),
  ]);

  const users = rows.length === 0
    ? []
    : await db.orm.public.User
      .where((u) => u.id.in(rows.map((r) => r.userId)))
      .all();
  const byId = new Map(users.map((u) => [u.id, u]));

  const data = rows.map((profile) => {
    const owner = byId.get(profile.userId);
    return owner ? serializeUserWithRider(owner, profile) : { rider: serializeRiderProfile(profile) };
  });
  res.json(paged(data, countResult.total, pagination));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const { user, profile } = await requireTargetRider(String(req.params.id));
  res.json({ user: serializeUserWithRider(user, profile) });
});

/** Admin verification gate — only verified riders may take jobs. */
export const verify = asyncHandler(async (req: Request, res: Response) => {
  const { profile } = await requireTargetRider(String(req.params.id));
  const isVerified = req.body.isVerified !== false;
  const updated = await db.orm.public.RiderProfile.where({ id: profile.id }).update({ isVerified });
  res.json({ rider: serializeRiderProfile(updated ?? profile) });
});

/** Admin override (e.g. force-offline after a complaint). BUSY cannot be forced. */
export const adminSetAvailability = asyncHandler(async (req: Request, res: Response) => {
  const { user, profile } = await requireTargetRider(String(req.params.id));
  const target = String(req.body.availability ?? '');
  if (!(RIDER_STATUSES as readonly string[]).includes(target)) {
    throw ApiError.badRequest(`availability must be one of: ${RIDER_STATUSES.join(', ')}`);
  }
  const updated = await setAvailability(user, target as 'AVAILABLE' | 'OFFLINE');
  res.json({ rider: serializeRiderProfile(updated ?? profile) });
});
