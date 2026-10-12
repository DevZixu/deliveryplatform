import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import * as staff from '../controllers/staff.controller.js';

const router = Router();

router.use(authenticate);
router.use(authorize('STAFF'));

/**
 * POST /api/staff/deliveries
 * Staff creates a delivery for any customer (auto-creating if needed).
 */
router.post(
  '/deliveries',
  validateBody({
    customerEmail: { required: true, type: 'string', maxLength: 255 },
    customerFirstName: { type: 'string', maxLength: 80 },
    customerLastName: { type: 'string', maxLength: 80 },
    customerPhone: { type: 'string', maxLength: 20 },
    packageDescription: { required: true, type: 'string', minLength: 1, maxLength: 500 },
    weightKg: { required: true, type: 'number' },
    distanceKm: { required: true, type: 'number' },
    paymentMethod: { required: true, type: 'string', enum: ['CASH', 'CARD', 'TRANSFER'] },
    scheduledFor: { type: 'string' },
    currency: { type: 'string' },
  }),
  staff.staffCreateDelivery,
);

export default router;
