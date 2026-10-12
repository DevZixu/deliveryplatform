import { or } from '@prisma/orm-postgres/orm-client';
import type { Request, Response } from 'express';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { getPagination, getStringQuery, paged } from '../lib/pagination.js';
import { quoteFee } from '../lib/pricing.js';
import { db } from '../prisma/db.js';
import { serializeDelivery } from '../serializers/delivery.serializer.js';
import {
  advanceAsRider,
  acceptDelivery,
  assignRider,
  cancelDelivery,
  createDelivery,
  DELIVERY_STATUSES,
  transitionDelivery,
  unassignRider,
} from '../services/delivery.service.js';
import type { CreateDeliveryInput } from '../services/delivery.service.js';
import type {
  DeliveryStatus,
  DeliveryWithRelations,
  UserRow,
} from '../types/db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_SELECT = ['id', 'firstName', 'lastName', 'email', 'phone'] as const;

const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (m) => `\\${m}`);

function deliveryId(req: Request): string {
  const id = String(req.params.id ?? '');
  if (!UUID_RE.test(id)) throw ApiError.notFound('Delivery not found');
  return id;
}

/**
 * Loads a delivery with its relations, enforcing row-level access:
 * admins see everything, customers their own orders, riders the orders
 * assigned to them (plus unclaimed offers for the accept action).
 */
async function loadDelivery(
  id: string,
  user: UserRow,
  opts: { offer?: boolean } = {},
): Promise<DeliveryWithRelations> {
  const delivery = await db.orm.public.Delivery
    .where((d) => d.id.eq(id))
    .include('payment')
    .include('customer', (c) => c.select(...ACTOR_SELECT))
    .include('rider', (r) => r.select(...ACTOR_SELECT))
    .include('events', (e) => e.orderBy((ev) => ev.createdAt.asc()).limit(200))
    .first();

  if (!delivery) throw ApiError.notFound('Delivery not found');
  if (user.role === 'ADMIN' || user.role === 'STAFF') return delivery;
  if (user.role === 'CUSTOMER') {
    if (delivery.customerId !== user.id) throw ApiError.notFound('Delivery not found');
    return delivery;
  }
  if (delivery.riderId === user.id) return delivery;
  if (opts.offer && delivery.status === 'CONFIRMED' && !delivery.riderId) return delivery;
  throw ApiError.notFound('Delivery not found');
}

function scopedDeliveries(req: Request, user: UserRow) {
  let q = db.orm.public.Delivery.where((d) => d.id.isNotNull());

  const status = getStringQuery(req, 'status');
  if (status) {
    if (!DELIVERY_STATUSES.includes(status as DeliveryStatus)) {
      throw ApiError.badRequest(`status must be one of: ${DELIVERY_STATUSES.join(', ')}`);
    }
    q = q.where((d) => d.status.eq(status as DeliveryStatus));
  }

  const search = getStringQuery(req, 'search');
  if (search) {
    const term = `%${escapeLike(search)}%`;
    q = q.where((d) =>
      or(d.trackingCode.ilike(term), d.recipientName.ilike(term), d.pickupName.ilike(term)),
    );
  }

  if (user.role === 'ADMIN' || user.role === 'STAFF') {
    const customerId = getStringQuery(req, 'customerId');
    const riderId = getStringQuery(req, 'riderId');
    if (customerId) q = q.where((d) => d.customerId.eq(customerId));
    if (riderId) q = q.where((d) => d.riderId.eq(riderId));
    return q;
  }

  if (user.role === 'CUSTOMER') {
    return q.where((d) => d.customerId.eq(user.id));
  }

  // Riders: their own route by default, or the open marketplace of offers.
  const view = getStringQuery(req, 'view');
  if (view === 'available') {
    return q.where((d) => d.status.eq('CONFIRMED')).where((d) => d.riderId.isNull());
  }
  return q.where((d) => d.riderId.eq(user.id));
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export const quote = asyncHandler(async (req: Request, res: Response) => {
  res.json(quoteFee({ distanceKm: Number(req.body.distanceKm), weightKg: Number(req.body.weightKg ?? 1) }));
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const create = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const delivery = await createDelivery(user, req.body as CreateDeliveryInput);
  const withRelations: DeliveryWithRelations = { ...delivery, customer: user };
  res.status(201).json({ delivery: serializeDelivery(withRelations) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const pagination = getPagination(req);
  const base = scopedDeliveries(req, user);

  const [rows, countResult] = await Promise.all([
    base
      .orderBy([(d) => d.createdAt.desc(), (d) => d.id.desc()])
      .offset(pagination.offset)
      .limit(pagination.limit)
      .include('payment')
      .include('customer', (c) => c.select(...ACTOR_SELECT))
      .include('rider', (r) => r.select(...ACTOR_SELECT))
      .all(),
    base.aggregate((a) => ({ total: a.count() })),
  ]);

  res.json(paged(rows.map(serializeDelivery), countResult.total, pagination));
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const delivery = await loadDelivery(deliveryId(req), req.user!);
  res.json({ delivery: serializeDelivery(delivery) });
});

export const getEvents = asyncHandler(async (req: Request, res: Response) => {
  const delivery = await loadDelivery(deliveryId(req), req.user!);
  res.json({ events: serializeDelivery(delivery).events ?? [] });
});

export const getPayment = asyncHandler(async (req: Request, res: Response) => {
  const delivery = await loadDelivery(deliveryId(req), req.user!);
  res.json({ payment: serializeDelivery(delivery).payment ?? null });
});

// ---------------------------------------------------------------------------
// Assignment (admin) / claiming (rider)
// ---------------------------------------------------------------------------

export const assign = asyncHandler(async (req: Request, res: Response) => {
  const admin = req.user!;
  const riderId = String(req.body.riderId ?? '');
  if (!UUID_RE.test(riderId)) throw ApiError.validation(['riderId must be a valid UUID']);

  const id = deliveryId(req);
  await loadDelivery(id, admin);

  const rider = await db.orm.public.User.first({ id: riderId });
  if (!rider) throw ApiError.notFound('Rider not found');
  if (rider.role !== 'RIDER') throw ApiError.badRequest('riderId must reference a rider account');

  const updated = await assignRider(id, rider, admin);
  const full = await loadDelivery(id, admin);
  res.json({ delivery: serializeDelivery(full), assignedRiderId: updated.riderId });
});

export const unassign = asyncHandler(async (req: Request, res: Response) => {
  const admin = req.user!;
  const id = deliveryId(req);
  await loadDelivery(id, admin);
  await unassignRider(id, admin);
  res.json({ delivery: serializeDelivery(await loadDelivery(id, admin)) });
});

export const accept = asyncHandler(async (req: Request, res: Response) => {
  const rider = req.user!;
  const id = deliveryId(req);
  await loadDelivery(id, rider, { offer: true });
  await acceptDelivery(id, rider);
  res.json({ delivery: serializeDelivery(await loadDelivery(id, rider)) });
});

// ---------------------------------------------------------------------------
// Progress / cancellation
// ---------------------------------------------------------------------------

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const id = deliveryId(req);
  const to = String(req.body.status ?? '') as DeliveryStatus;
  const note = req.body.note as string | undefined;

  const delivery = await loadDelivery(id, user);
  if (!DELIVERY_STATUSES.includes(to)) {
    throw ApiError.badRequest(`status must be one of: ${DELIVERY_STATUSES.join(', ')}`);
  }
  if (user.role === 'CUSTOMER') {
    throw ApiError.forbidden('Customers cannot update delivery progress');
  }

  if (user.role === 'RIDER') {
    await advanceAsRider(delivery, user, to, note);
  } else {
    // Administrators may move a delivery through any legal transition.
    await transitionDelivery({
      deliveryId: id,
      from: [delivery.status],
      to,
      actor: user,
      note: note ?? `Status set to ${to} by administrator`,
    });
  }

  res.json({ delivery: serializeDelivery(await loadDelivery(id, user)) });
});

export const cancel = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const id = deliveryId(req);
  const reason = String(req.body.reason ?? '').trim();
  if (!reason) throw ApiError.validation(['reason is required']);

  const delivery = await loadDelivery(id, user);
  await cancelDelivery(delivery.id, user, reason);
  res.json({ delivery: serializeDelivery(await loadDelivery(id, user)) });
});
