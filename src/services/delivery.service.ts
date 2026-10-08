import { randomUUID } from 'node:crypto';
import { and } from '@prisma/orm-postgres/orm-client';
import { ApiError } from '../lib/errors.js';
import { calculateFee } from '../lib/pricing.js';
import { paymentReference, trackingCode } from '../lib/tracking.js';
import { db } from '../prisma/db.js';
import type {
  DeliveryRow,
  DeliveryStatus,
  PaymentRow,
  RiderProfileRow,
  UserRow,
} from '../types/db.js';

export const DELIVERY_STATUSES: DeliveryStatus[] = [
  'PENDING',
  'CONFIRMED',
  'ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
];

/** Statuses in which a rider is committed to a delivery. */
export const RIDER_ACTIVE_STATUSES: DeliveryStatus[] = ['ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'];

/** Allowed transitions — the single source of truth for the delivery lifecycle. */
export const TRANSITIONS: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['PICKED_UP', 'CONFIRMED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function assertTransition(from: DeliveryStatus, to: DeliveryStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw ApiError.invalidState(`A delivery cannot move from ${from} to ${to}`);
  }
}

const nowIso = (): string => new Date().toISOString();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function recordEvent(
  tx: Tx,
  input: {
    deliveryId: string;
    fromStatus: DeliveryStatus | null;
    toStatus: DeliveryStatus;
    actorId?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await tx.orm.public.DeliveryEvent.create({
    id: randomUUID(),
    deliveryId: input.deliveryId,
    actorId: input.actorId ?? null,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    note: input.note ?? null,
    createdAt: nowIso(),
  });
}

/** Keeps a rider's availability in sync with their active workload. */
async function refreshRiderAvailability(tx: Tx, riderUserId: string): Promise<void> {
  const profile = await tx.orm.public.RiderProfile.first({ userId: riderUserId });
  if (!profile) return;

  const active = await tx.orm.public.Delivery
    .where((d) => and(d.riderId.eq(riderUserId), d.status.in(RIDER_ACTIVE_STATUSES)))
    .select('id')
    .limit(1)
    .all();

  const next = active.length > 0
    ? 'BUSY'
    : profile.availability === 'OFFLINE'
      ? 'OFFLINE'
      : 'AVAILABLE';

  if (next !== profile.availability) {
    await tx.orm.public.RiderProfile.where({ userId: riderUserId }).update({ availability: next });
  }
}

export async function requireRiderProfile(riderUserId: string): Promise<RiderProfileRow> {
  const profile = await db.orm.public.RiderProfile.first({ userId: riderUserId });
  if (!profile) throw ApiError.notFound('Rider profile not found');
  return profile;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export type CreateDeliveryInput = {
  pickup: { name: string; address: string; city: string; phone: string; note?: string };
  dropoff: { recipientName: string; address: string; city: string; phone: string; note?: string };
  packageDescription: string;
  weightKg: number;
  distanceKm: number;
  scheduledFor?: string;
  paymentMethod: 'CASH' | 'CARD' | 'TRANSFER';
  currency?: string;
};

export async function createDelivery(
  customer: UserRow,
  input: CreateDeliveryInput,
): Promise<DeliveryRow & { payment: PaymentRow }> {
  const fee = calculateFee({ distanceKm: input.distanceKm, weightKg: input.weightKg });
  const currency = input.currency ?? 'USD';

  return db.transaction(async (tx) => {
    const delivery = await tx.orm.public.Delivery.create({
      id: randomUUID(),
      trackingCode: trackingCode(),
      status: 'PENDING',
      customerId: customer.id,
      pickupName: input.pickup.name,
      pickupAddress: input.pickup.address,
      pickupCity: input.pickup.city,
      pickupPhone: input.pickup.phone,
      pickupNote: input.pickup.note ?? null,
      recipientName: input.dropoff.recipientName,
      deliveryAddress: input.dropoff.address,
      deliveryCity: input.dropoff.city,
      deliveryPhone: input.dropoff.phone,
      deliveryNote: input.dropoff.note ?? null,
      packageDescription: input.packageDescription,
      weightKg: String(input.weightKg),
      distanceKm: String(input.distanceKm),
      fee: fee.toFixed(2),
      currency,
      scheduledFor: input.scheduledFor ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    const payment = await tx.orm.public.Payment.create({
      id: randomUUID(),
      reference: paymentReference(),
      deliveryId: delivery.id,
      amount: fee.toFixed(2),
      currency,
      method: input.paymentMethod,
      status: 'PENDING',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });

    await recordEvent(tx, {
      deliveryId: delivery.id,
      fromStatus: null,
      toStatus: 'PENDING',
      actorId: customer.id,
      note: 'Delivery request created',
    });

    return { ...delivery, payment };
  });
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export type TransitionInput = {
  deliveryId: string;
  from: DeliveryStatus[];
  to: DeliveryStatus;
  actor: UserRow;
  note?: string;
  patch?: Partial<{
    riderId: string | null;
    assignedAt: string | null;
    cancelReason: string | null;
    cancellationActorId: string | null;
  }>;
};

/**
 * Applies a lifecycle transition atomically: the status is guarded by a
 * conditional UPDATE, so two concurrent actors cannot both win. Side effects
 * (timestamps, rider availability, payment settlement) run in the same
 * transaction and roll back if the transition is rejected.
 */
export async function transitionDelivery(input: TransitionInput): Promise<DeliveryRow> {
  const { deliveryId, from, to, actor } = input;

  return db.transaction(async (tx) => {
    const current = await tx.orm.public.Delivery.first({ id: deliveryId });
    if (!current) throw ApiError.notFound('Delivery not found');
    if (!from.includes(current.status)) {
      throw ApiError.invalidState(
        `This action requires the delivery to be ${from.join(' or ')} (current status: ${current.status})`,
      );
    }
    assertTransition(current.status, to);

    const timestamp = nowIso();
    const patch: Record<string, unknown> = { status: to, ...input.patch };

    if (to === 'PICKED_UP') patch.pickedUpAt = timestamp;
    if (to === 'DELIVERED') patch.deliveredAt = timestamp;
    if (to === 'CANCELLED') patch.cancelledAt = timestamp;

    const updated = await tx.orm.public.Delivery
      .where((d) => and(d.id.eq(deliveryId), d.status.in(from)))
      .update(patch);

    if (!updated) {
      throw ApiError.invalidState('The delivery status changed while this action was in flight, please retry');
    }

    await recordEvent(tx, {
      deliveryId,
      fromStatus: current.status,
      toStatus: to,
      actorId: actor.id,
      note: input.note ?? null,
    });

    // ---- side effects -----------------------------------------------------
    if (to === 'ASSIGNED' && input.patch?.riderId) {
      await tx.orm.public.RiderProfile.where({ userId: input.patch.riderId }).update({
        availability: 'BUSY',
      });
    }

    if (to === 'CONFIRMED' && current.riderId) {
      // Unassign path: the rider is released back into the pool.
      await refreshRiderAvailability(tx, current.riderId);
    }

    if (to === 'DELIVERED') {
      if (current.riderId) {
        const profile = await tx.orm.public.RiderProfile.first({ userId: current.riderId });
        if (profile) {
          await tx.orm.public.RiderProfile.where({ id: profile.id }).update({
            completedRuns: profile.completedRuns + 1,
          });
        }
        await refreshRiderAvailability(tx, current.riderId);
      }

      // Cash on delivery: the rider collects the money, so the payment
      // settles at hand-over.
      const payment = await tx.orm.public.Payment.first({ deliveryId });
      if (payment && payment.status === 'PENDING' && payment.method === 'CASH') {
        await tx.orm.public.Payment.where({ id: payment.id }).update({
          status: 'SUCCESSFUL',
          paidAt: timestamp,
          gatewayRef: `cash_${deliveryId.slice(0, 8)}`,
        });
      }
    }

    if (to === 'CANCELLED') {
      if (current.riderId) await refreshRiderAvailability(tx, current.riderId);

      const payment = await tx.orm.public.Payment.first({ deliveryId });
      if (payment && payment.status === 'SUCCESSFUL') {
        await tx.orm.public.Payment.where({ id: payment.id }).update({
          status: 'REFUNDED',
          refundedAt: timestamp,
        });
        await recordEvent(tx, {
          deliveryId,
          fromStatus: null,
          toStatus: 'CANCELLED',
          actorId: actor.id,
          note: 'Payment refunded automatically',
        });
      }
    }

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

export async function assignRider(
  deliveryId: string,
  rider: UserRow,
  admin: UserRow,
): Promise<DeliveryRow> {
  const profile = await requireRiderProfile(rider.id);

  if (rider.status !== 'ACTIVE') throw ApiError.invalidState('Only active riders can be assigned');
  if (!profile.isVerified) throw ApiError.invalidState('This rider has not been verified by an administrator');
  if (profile.availability !== 'AVAILABLE') {
    throw ApiError.invalidState(`Rider is not available (current availability: ${profile.availability})`);
  }

  return transitionDelivery({
    deliveryId,
    from: ['CONFIRMED'],
    to: 'ASSIGNED',
    actor: admin,
    note: `Rider assigned by ${admin.firstName} ${admin.lastName}`,
    patch: { riderId: rider.id, assignedAt: nowIso() },
  });
}

export async function acceptDelivery(deliveryId: string, rider: UserRow): Promise<DeliveryRow> {
  const profile = await requireRiderProfile(rider.id);
  if (rider.status !== 'ACTIVE') throw ApiError.invalidState('Your account is not active');
  if (!profile.isVerified) throw ApiError.invalidState('Your rider profile has not been verified yet');
  if (profile.availability !== 'AVAILABLE') {
    throw ApiError.invalidState(`You must be AVAILABLE to accept jobs (current: ${profile.availability})`);
  }

  return db.transaction(async (tx) => {
    const claimed = await tx.orm.public.Delivery
      .where((d) => and(d.id.eq(deliveryId), d.status.eq('CONFIRMED'), d.riderId.isNull()))
      .update({ status: 'ASSIGNED', riderId: rider.id, assignedAt: nowIso() });

    if (!claimed) {
      const current = await tx.orm.public.Delivery.first({ id: deliveryId });
      if (!current) throw ApiError.notFound('Delivery not found');
      if (current.riderId) throw ApiError.conflict('Another rider has already claimed this delivery');
      throw ApiError.invalidState(`A delivery with status ${current.status} cannot be accepted`);
    }

    await recordEvent(tx, {
      deliveryId,
      fromStatus: 'CONFIRMED',
      toStatus: 'ASSIGNED',
      actorId: rider.id,
      note: 'Rider accepted the delivery',
    });
    await tx.orm.public.RiderProfile.where({ userId: rider.id }).update({ availability: 'BUSY' });

    return claimed;
  });
}

export async function unassignRider(deliveryId: string, admin: UserRow): Promise<DeliveryRow> {
  return transitionDelivery({
    deliveryId,
    from: ['ASSIGNED'],
    to: 'CONFIRMED',
    actor: admin,
    note: 'Rider unassigned by administrator',
    patch: { riderId: null, assignedAt: null },
  });
}

export async function cancelDelivery(
  deliveryId: string,
  actor: UserRow,
  reason: string,
): Promise<DeliveryRow> {
  const isAdmin = actor.role === 'ADMIN';
  const allowed: DeliveryStatus[] = isAdmin
    ? ['PENDING', 'CONFIRMED', 'ASSIGNED']
    : ['PENDING', 'CONFIRMED'];

  return transitionDelivery({
    deliveryId,
    from: allowed,
    to: 'CANCELLED',
    actor,
    note: `Cancelled by ${actor.role.toLowerCase()}: ${reason}`,
    patch: {
      cancelReason: reason,
      cancellationActorId: actor.id,
      riderId: null,
      assignedAt: null,
    },
  });
}

/** Rider-driven progress update: PICKED_UP → IN_TRANSIT → DELIVERED. */
export async function advanceAsRider(
  delivery: DeliveryRow,
  rider: UserRow,
  to: DeliveryStatus,
  note?: string,
): Promise<DeliveryRow> {
  if (delivery.riderId !== rider.id) {
    throw ApiError.forbidden('This delivery is not assigned to you');
  }
  if (!TRANSITIONS[delivery.status].includes(to)) {
    throw ApiError.invalidState(
      `A delivery cannot move from ${delivery.status} to ${to}`,
    );
  }
  return transitionDelivery({
    deliveryId: delivery.id,
    from: [delivery.status],
    to,
    actor: rider,
    note: note ?? `Updated to ${to} by rider`,
  });
}
