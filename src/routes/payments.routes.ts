import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import * as payments from '../controllers/payments.controller.js';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  authorize('CUSTOMER'),
  validateBody({
    deliveryId: { required: true, type: 'string', maxLength: 40 },
    method: { required: true, type: 'string', enum: ['CASH', 'CARD', 'TRANSFER'] },
    cardNumber: { type: 'string', maxLength: 25 },
    transferReference: { type: 'string', maxLength: 60 },
  }),
  payments.pay,
);

router.get('/', authorize('CUSTOMER', 'ADMIN'), payments.list);
router.get('/:id', authorize('CUSTOMER', 'ADMIN'), payments.getOne);
router.post('/:id/refund', authorize('ADMIN'), payments.refund);

export default router;
