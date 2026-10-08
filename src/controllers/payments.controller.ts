import type { Request, Response } from 'express';
import { ApiError, asyncHandler } from '../lib/errors.js';
import { getPagination, getStringQuery, paged } from '../lib/pagination.js';
import { db } from '../prisma/db.js';
import { serializePayment } from '../serializers/delivery.serializer.js';
import { payDelivery, refundPayment } from '../services/payment.service.js';
import type { PaymentMethod, PaymentRow, PaymentStatus, UserRow } from '../types/db.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAY_STATUSES = ['PENDING', 'SUCCESSFUL', 'FAILED', 'REFUNDED'] as const;

type PaymentWithDelivery = PaymentRow & {
  delivery?: { id: string; customerId: string; status: string; trackingCode: string } | null;
};

/** Admins see every payment, customers only payments for their own deliveries. */
async function loadPayment(id: string, user: UserRow): Promise<PaymentWithDelivery> {
  if (!UUID_RE.test(id)) throw ApiError.notFound('Payment not found');
  const payment = await db.orm.public.Payment
    .where((p) => p.id.eq(id))
    .include('delivery', (d) => d.select('id', 'customerId', 'status', 'trackingCode'))
    .first();
  if (!payment) throw ApiError.notFound('Payment not found');
  if (user.role === 'ADMIN') return payment;
  if (user.role === 'CUSTOMER' && payment.delivery?.customerId === user.id) return payment;
  throw ApiError.notFound('Payment not found');
}

export const pay = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const deliveryId = String(req.body.deliveryId ?? '');
  if (!UUID_RE.test(deliveryId)) throw ApiError.validation(['deliveryId must be a valid UUID']);

  const result = await payDelivery(deliveryId, user, {
    method: String(req.body.method) as PaymentMethod,
    cardNumber: req.body.cardNumber,
    transferReference: req.body.transferReference,
  });

  res.json({
    payment: serializePayment(result.payment),
    delivery: { id: result.delivery.id, status: result.delivery.status, trackingCode: result.delivery.trackingCode },
    message: result.message,
  });
});

export const refund = asyncHandler(async (req: Request, res: Response) => {
  const admin = req.user!;
  const payment = await loadPayment(String(req.params.id), admin);
  const refunded = await refundPayment(payment, admin);
  res.json({ payment: serializePayment(refunded) });
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const payment = await loadPayment(String(req.params.id), req.user!);
  res.json({ payment: serializePayment(payment) });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const user = req.user!;
  const pagination = getPagination(req);

  if (user.role === 'RIDER') throw ApiError.forbidden('Riders do not have access to payment records');

  let q = db.orm.public.Payment.where((p) => p.id.isNotNull());

  if (user.role === 'CUSTOMER') q = q.where((p) => p.delivery.some((d) => d.customerId.eq(user.id)));

  const status = getStringQuery(req, 'status');
  if (status) {
    if (!(PAY_STATUSES as readonly string[]).includes(status)) {
      throw ApiError.badRequest(`status must be one of: ${PAY_STATUSES.join(', ')}`);
    }
    q = q.where((p) => p.status.eq(status as PaymentStatus));
  }

  const [rows, countResult] = await Promise.all([
    q.orderBy([(p) => p.createdAt.desc(), (p) => p.id.desc()])
      .offset(pagination.offset)
      .limit(pagination.limit)
      .all(),
    q.aggregate((a) => ({ total: a.count() })),
  ]);

  res.json(paged(rows.map(serializePayment), countResult.total, pagination));
});
