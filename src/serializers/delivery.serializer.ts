import type {
  DeliveryEventRow,
  DeliveryWithRelations,
  PaymentRow,
} from '../types/db.js';

const num = (value: string | number | null | undefined): number | null =>
  value === null || value === undefined ? null : Number(value);

export function serializePayment(payment: PaymentRow) {
  return {
    id: payment.id,
    reference: payment.reference,
    deliveryId: payment.deliveryId,
    amount: num(payment.amount),
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    gatewayRef: payment.gatewayRef,
    failureReason: payment.failureReason,
    paidAt: payment.paidAt,
    refundedAt: payment.refundedAt,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export function serializeEvent(event: DeliveryEventRow) {
  return {
    id: event.id,
    deliveryId: event.deliveryId,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorId: event.actorId,
    note: event.note,
    createdAt: event.createdAt,
  };
}

const compactUser = (user: { id: string; firstName: string; lastName: string; email?: string; phone?: string | null }) => ({
  id: user.id,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: `${user.firstName} ${user.lastName}`,
  ...(user.email !== undefined ? { email: user.email } : {}),
});

export function serializeDelivery(delivery: DeliveryWithRelations) {
  const result: Record<string, unknown> = {
    id: delivery.id,
    trackingCode: delivery.trackingCode,
    status: delivery.status,
    customerId: delivery.customerId,
    riderId: delivery.riderId,
    pickup: {
      name: delivery.pickupName,
      address: delivery.pickupAddress,
      city: delivery.pickupCity,
      phone: delivery.pickupPhone,
      note: delivery.pickupNote,
    },
    dropoff: {
      recipientName: delivery.recipientName,
      address: delivery.deliveryAddress,
      city: delivery.deliveryCity,
      phone: delivery.deliveryPhone,
      note: delivery.deliveryNote,
    },
    package: {
      description: delivery.packageDescription,
      weightKg: num(delivery.weightKg),
      distanceKm: num(delivery.distanceKm),
    },
    fee: num(delivery.fee),
    currency: delivery.currency,
    scheduledFor: delivery.scheduledFor,
    assignedAt: delivery.assignedAt,
    pickedUpAt: delivery.pickedUpAt,
    deliveredAt: delivery.deliveredAt,
    cancelledAt: delivery.cancelledAt,
    cancelReason: delivery.cancelReason,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  };

  if (delivery.customer) result.customer = compactUser(delivery.customer);
  if (delivery.rider) result.rider = compactUser(delivery.rider);
  if ('payment' in delivery) {
    result.payment = delivery.payment ? serializePayment(delivery.payment) : null;
  }
  if (delivery.events) result.events = delivery.events.map(serializeEvent);

  return result;
}
