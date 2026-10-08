import { and } from '@prisma/orm-postgres/orm-client';
import { ApiError } from '../lib/errors.js';
import { gatewayReference } from '../lib/tracking.js';
import { db } from '../prisma/db.js';
import type { DeliveryRow, PaymentMethod, PaymentRow, UserRow } from '../types/db.js';

const nowIso = (): string => new Date().toISOString();

export type PayInput = {
  method: PaymentMethod;
  cardNumber?: string;
  transferReference?: string;
};

export type PayResult = {
  payment: PaymentRow;
  delivery: DeliveryRow;
  /** True when the mock gateway accepted the charge. */
  settled: boolean;
  message: string;
};

/**
 * Mock payment gateway. No real processor is involved; the outcome is
 * deterministic so the flow can be demonstrated end to end:
 *   - CARD  : declined when the card number ends in `0000`, otherwise approved
 *   - TRANSFER: always approved (bank transfer reference recorded)
 *   - CASH  : never settles here — it is collected on delivery
 */
function gatewayOutcome(input: PayInput): {
  status: PaymentRow['status'];
  gatewayRef: string | null;
  failureReason: string | null;
} {
  if (input.method === 'CASH') {
    return { status: 'PENDING', gatewayRef: null, failureReason: null };
  }

  if (input.method === 'CARD') {
    const digits = (input.cardNumber ?? '').replace(/\D/g, '');
    if (digits.endsWith('0000')) {
      return {
        status: 'FAILED',
        gatewayRef: null,
        failureReason: 'Card declined by the payment gateway',
      };
    }
    return { status: 'SUCCESSFUL', gatewayRef: gatewayReference(), failureReason: null };
  }

  return { status: 'SUCCESSFUL', gatewayRef: gatewayReference(), failureReason: null };
}

export async function payDelivery(
  deliveryId: string,
  customer: UserRow,
  input: PayInput,
): Promise<PayResult> {
  return db.transaction(async (tx) => {
    const delivery = await tx.orm.public.Delivery.first({ id: deliveryId });
    if (!delivery) throw ApiError.notFound('Delivery not found');
    if (delivery.customerId !== customer.id && customer.role !== 'ADMIN') {
      throw ApiError.notFound('Delivery not found');
    }

    const payment = await tx.orm.public.Payment.first({ deliveryId });
    if (!payment) throw ApiError.notFound('Payment record not found');

    if (payment.status === 'SUCCESSFUL') throw ApiError.conflict('This delivery has already been paid');
    if (payment.status === 'REFUNDED') {
      throw ApiError.invalidState('This payment was refunded and cannot be charged again');
    }
    if (delivery.status !== 'PENDING') {
      throw ApiError.invalidState(
        `Payment can only be taken while the delivery is PENDING (current status: ${delivery.status})`,
      );
    }

    const outcome = gatewayOutcome(input);
    const timestamp = nowIso();

    const updated = await tx.orm.public.Payment.where({ id: payment.id }).update({
      method: input.method,
      status: outcome.status,
      gatewayRef: outcome.gatewayRef,
      failureReason: outcome.failureReason,
      paidAt: outcome.status === 'SUCCESSFUL' ? timestamp : null,
      updatedAt: timestamp,
    });

    const settled = outcome.status === 'SUCCESSFUL';
    const isCash = input.method === 'CASH';

    // A settled charge (or a cash-on-delivery agreement) confirms the order.
    if (settled || isCash) {
      const confirmed = await tx.orm.public.Delivery
        .where((d) => and(d.id.eq(deliveryId), d.status.eq('PENDING')))
        .update({ status: 'CONFIRMED' });
      if (!confirmed) {
        throw ApiError.invalidState('The delivery is no longer pending, please refresh and retry');
      }

      await tx.orm.public.DeliveryEvent.create({
        deliveryId,
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
        actorId: customer.id,
        note: isCash
          ? 'Cash-on-delivery agreement recorded'
          : `Payment ${paymentReferenceNote(input.method)} received`,
        createdAt: timestamp,
      });

      return {
        payment: updated ?? payment,
        delivery: confirmed,
        settled: isCash ? false : settled,
        message: isCash
          ? 'Cash payment recorded. Pay the rider on delivery.'
          : settled
            ? 'Payment successful. Your delivery is confirmed.'
            : 'Payment failed. You can retry with another method.',
      };
    }

    return {
      payment: updated ?? payment,
      delivery,
      settled: false,
      message: 'Payment failed. You can retry with another method.',
    };
  });
}

function paymentReferenceNote(method: PaymentMethod): string {
  if (method === 'CARD') return 'Card';
  if (method === 'TRANSFER') return 'Bank transfer';
  return 'Cash';
}

export async function refundPayment(payment: PaymentRow, admin: UserRow): Promise<PaymentRow> {
  if (payment.status !== 'SUCCESSFUL') {
    throw ApiError.invalidState(
      `Only a SUCCESSFUL payment can be refunded (current status: ${payment.status})`,
    );
  }

  const delivery = await db.orm.public.Delivery.first({ id: payment.deliveryId });
  if (!delivery) throw ApiError.notFound('Delivery not found');
  if (delivery.status !== 'CANCELLED' && delivery.status !== 'DELIVERED') {
    throw ApiError.invalidState(
      'Refunds are only allowed once the delivery has been cancelled or delivered — cancel the delivery first',
    );
  }

  const timestamp = nowIso();
  const updated = await db.orm.public.Payment.where({ id: payment.id }).update({
    status: 'REFUNDED',
    refundedAt: timestamp,
    updatedAt: timestamp,
  });

  await db.orm.public.DeliveryEvent.create({
    deliveryId: payment.deliveryId,
    fromStatus: null,
    toStatus: delivery.status,
    actorId: admin.id,
    note: `Payment ${payment.reference} refunded by administrator`,
    createdAt: timestamp,
  });

  if (!updated) throw ApiError.notFound('Payment not found');
  return updated;
}
