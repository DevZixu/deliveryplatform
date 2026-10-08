import { and } from '@prisma/orm-postgres/orm-client';
import type { Request, Response } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { db } from '../prisma/db.js';
import { serializeDelivery } from '../serializers/delivery.serializer.js';
import { RIDER_ACTIVE_STATUSES } from '../services/delivery.service.js';
import type { DeliveryStatus } from '../types/db.js';

const num = (value: string | number | null | undefined): number =>
  value === null || value === undefined ? 0 : Number(value);

export const platformStats = asyncHandler(async (_req: Request, res: Response) => {
  const [users, deliveries, payments, revenue, recentRows] = await Promise.all([
    db.orm.public.User.groupBy('role').aggregate((a) => ({ count: a.count() })),
    db.orm.public.Delivery.groupBy('status').aggregate((a) => ({ count: a.count() })),
    db.orm.public.Payment.groupBy('status').aggregate((a) => ({ count: a.count() })),
    db.orm.public.Payment
      .where((p) => p.status.eq('SUCCESSFUL'))
      .aggregate((a) => ({ total: a.sum('amount'), count: a.count() })),
    db.orm.public.Delivery
      .orderBy([(d) => d.createdAt.desc(), (d) => d.id.desc()])
      .limit(8)
      .include('customer', (c) => c.select('id', 'firstName', 'lastName'))
      .include('rider', (r) => r.select('id', 'firstName', 'lastName'))
      .all(),
  ]);

  res.json({
    usersByRole: Object.fromEntries(users.map((row) => [row.role, row.count])),
    deliveriesByStatus: Object.fromEntries(deliveries.map((row) => [row.status, row.count])),
    paymentsByStatus: Object.fromEntries(payments.map((row) => [row.status, row.count])),
    revenue: { total: num(revenue.total), successfulPayments: revenue.count },
    recentDeliveries: recentRows.map(serializeDelivery),
  });
});

export const riderStats = asyncHandler(async (req: Request, res: Response) => {
  const rider = req.user!;
  const profile = await db.orm.public.RiderProfile.first({ userId: rider.id });

  const [active, completed, earnings] = await Promise.all([
    db.orm.public.Delivery
      .where((d) => and(d.riderId.eq(rider.id), d.status.in(RIDER_ACTIVE_STATUSES)))
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Delivery
      .where((d) => and(d.riderId.eq(rider.id), d.status.eq('DELIVERED')))
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Delivery
      .where((d) => and(d.riderId.eq(rider.id), d.status.eq('DELIVERED')))
      .aggregate((a) => ({ total: a.sum('fee'), count: a.count() })),
  ]);

  res.json({
    availability: profile?.availability ?? 'OFFLINE',
    isVerified: profile?.isVerified ?? false,
    completedRuns: profile?.completedRuns ?? 0,
    activeDeliveries: active.count,
    deliveredDeliveries: completed.count,
    earnings: { total: num(earnings.total), paidDeliveries: earnings.count },
  });
});

export const customerStats = asyncHandler(async (req: Request, res: Response) => {
  const customer = req.user!;

  const [byStatus, completed, spend] = await Promise.all([
    db.orm.public.Delivery
      .where((d) => d.customerId.eq(customer.id))
      .groupBy('status')
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Delivery
      .where((d) => d.customerId.eq(customer.id))
      .aggregate((a) => ({ count: a.count() })),
    db.orm.public.Delivery
      .where((d) => and(d.customerId.eq(customer.id), d.status.eq('DELIVERED')))
      .aggregate((a) => ({ total: a.sum('fee'), count: a.count() })),
  ]);

  const statuses = Object.fromEntries(
    byStatus.map((row) => [row.status as DeliveryStatus, row.count]),
  ) as Record<DeliveryStatus, number>;

  res.json({
    totalDeliveries: completed.count,
    deliveriesByStatus: statuses,
    activeDeliveries:
      (statuses.PENDING ?? 0) +
      (statuses.CONFIRMED ?? 0) +
      (statuses.ASSIGNED ?? 0) +
      (statuses.PICKED_UP ?? 0) +
      (statuses.IN_TRANSIT ?? 0),
    spend: { total: num(spend.total), paidDeliveries: spend.count },
  });
});
