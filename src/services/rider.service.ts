import { and } from '@prisma/orm-postgres/orm-client';
import { ApiError } from '../lib/errors.js';
import { db } from '../prisma/db.js';
import { RIDER_ACTIVE_STATUSES, requireRiderProfile } from './delivery.service.js';
import type { RiderProfileRow, UserRow } from '../types/db.js';

/**
 * A rider may only go AVAILABLE when they carry no active deliveries, and
 * BUSY is system-managed — it is derived from the workload, never set by hand.
 */
export async function setAvailability(
  rider: UserRow,
  target: 'AVAILABLE' | 'OFFLINE',
): Promise<RiderProfileRow> {
  const profile = await requireRiderProfile(rider.id);

  if (target === 'AVAILABLE') {
    const active = await db.orm.public.Delivery
      .where((d) => and(d.riderId.eq(rider.id), d.status.in(RIDER_ACTIVE_STATUSES)))
      .select('id')
      .limit(1)
      .all();
    if (active.length > 0) {
      throw ApiError.invalidState(
        'You still have active deliveries — finish or release them before going available',
      );
    }
    if (!profile.isVerified) {
      throw ApiError.invalidState('Your rider profile must be verified by an administrator first');
    }
  }

  const updated = await db.orm.public.RiderProfile.where({ id: profile.id }).update({
    availability: target,
  });
  if (!updated) throw ApiError.notFound('Rider profile not found');
  return updated;
}

export type RiderProfilePatch = {
  vehicleType?: string;
  vehiclePlate?: string;
  licenseNumber?: string;
  city?: string;
};

export async function updateRiderProfile(
  rider: UserRow,
  patch: RiderProfilePatch,
): Promise<RiderProfileRow> {
  const profile = await requireRiderProfile(rider.id);
  const changes: Record<string, string> = {};
  if (patch.vehicleType !== undefined) changes.vehicleType = patch.vehicleType;
  if (patch.vehiclePlate !== undefined) changes.vehiclePlate = patch.vehiclePlate;
  if (patch.licenseNumber !== undefined) changes.licenseNumber = patch.licenseNumber;
  if (patch.city !== undefined) changes.city = patch.city;
  if (Object.keys(changes).length === 0) return profile;

  const updated = await db.orm.public.RiderProfile.where({ id: profile.id }).update(changes);
  if (!updated) throw ApiError.notFound('Rider profile not found');
  return updated;
}
