import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import * as deliveries from '../controllers/deliveries.controller.js';

const router = Router();

router.use(authenticate);

const locationRules = {
  address: { required: true, type: 'string', minLength: 1, maxLength: 200 },
  city: { required: true, type: 'string', minLength: 1, maxLength: 80 },
  phone: { required: true, type: 'string', minLength: 7, maxLength: 20 },
  note: { type: 'string', maxLength: 300 },
} as const;

router.post(
  '/quote',
  validateBody({
    distanceKm: { required: true, type: 'number', min: 0.1, max: 5000 },
    weightKg: { type: 'number', min: 0.1, max: 500, default: 1 },
  }),
  deliveries.quote,
);

router.post(
  '/',
  authorize('CUSTOMER'),
  validateBody({
    pickup: {
      required: true,
      type: 'object',
      fields: {
        name: { required: true, type: 'string', minLength: 1, maxLength: 120 },
        ...locationRules,
      },
    },
    dropoff: {
      required: true,
      type: 'object',
      fields: {
        recipientName: { required: true, type: 'string', minLength: 1, maxLength: 120 },
        ...locationRules,
      },
    },
    packageDescription: { required: true, type: 'string', minLength: 1, maxLength: 500 },
    weightKg: { required: true, type: 'number', min: 0.1, max: 500 },
    distanceKm: { required: true, type: 'number', min: 0.1, max: 5000 },
    scheduledFor: {
      type: 'string',
      maxLength: 40,
      message: 'scheduledFor must be an ISO-8601 timestamp',
      validate: (value) => Number.isFinite(Date.parse(String(value))),
    },
    paymentMethod: { required: true, type: 'string', enum: ['CASH', 'CARD', 'TRANSFER'] },
    currency: { type: 'string', enum: ['USD'], default: 'USD' },
  }),
  deliveries.create,
);

router.get('/', deliveries.list);

router.get('/:id', deliveries.getOne);
router.get('/:id/events', deliveries.getEvents);
router.get('/:id/payment', deliveries.getPayment);

router.post(
  '/:id/assign',
  authorize('ADMIN'),
  validateBody({ riderId: { required: true, type: 'string', maxLength: 40 } }),
  deliveries.assign,
);
router.post('/:id/unassign', authorize('ADMIN'), deliveries.unassign);
router.post('/:id/accept', authorize('RIDER'), deliveries.accept);
router.post(
  '/:id/cancel',
  validateBody({ reason: { required: true, type: 'string', minLength: 1, maxLength: 500 } }),
  deliveries.cancel,
);

router.patch(
  '/:id/status',
  validateBody({
    status: {
      required: true,
      type: 'string',
      enum: ['PENDING', 'CONFIRMED', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
    },
    note: { type: 'string', maxLength: 300 },
  }),
  deliveries.updateStatus,
);

export default router;
