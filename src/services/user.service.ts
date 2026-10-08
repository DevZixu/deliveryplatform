import { and } from '@prisma/orm-postgres/orm-client';
import { ApiError } from '../lib/errors.js';
import { db } from '../prisma/db.js';
import { RIDER_ACTIVE_STATUSES } from './delivery.service.js';
import type { AccountStatus, UserRow } from '../types/db.js';

/**
 * Account lifecycle rules:
 *  - an administrator cannot lock themselves out;
 *  - administrators cannot change the status of other administrators;
 *  - a rider carrying active deliveries cannot be suspended (work must be
 *    reassigned first).
 */
export async function setAccountStatus(
  target: UserRow,
  status: AccountStatus,
  actor: UserRow,
): Promise<UserRow> {
  if (target.id === actor.id) {
    throw ApiError.invalidState('You cannot change the status of your own account');
  }
  if (target.role === 'ADMIN' && actor.role === 'ADMIN') {
    throw ApiError.forbidden('Administrators cannot change the status of other administrators');
  }

  if (status === 'SUSPENDED' && target.role === 'RIDER') {
    const active = await db.orm.public.Delivery
      .where((d) => and(d.riderId.eq(target.id), d.status.in(RIDER_ACTIVE_STATUSES)))
      .select('id')
      .limit(1)
      .all();
    if (active.length > 0) {
      throw ApiError.invalidState(
        'This rider has active deliveries — reassign them before suspending the account',
      );
    }
  }

  const updated = await db.orm.public.User.where({ id: target.id }).update({ status });
  if (!updated) throw ApiError.notFound('User not found');
  return updated;
}
