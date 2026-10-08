import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import * as riders from '../controllers/riders.controller.js';

const router = Router();

router.use(authenticate);

router.get('/me', authorize('RIDER'), riders.me);
router.patch(
  '/me',
  authorize('RIDER'),
  validateBody({
    vehicleType: { type: 'string', maxLength: 40 },
    vehiclePlate: { type: 'string', maxLength: 20 },
    licenseNumber: { type: 'string', maxLength: 40 },
    city: { type: 'string', maxLength: 80 },
  }),
  riders.updateMe,
);
router.patch(
  '/me/availability',
  authorize('RIDER'),
  validateBody({
    availability: { required: true, type: 'string', enum: ['AVAILABLE', 'OFFLINE'] },
  }),
  riders.setMyAvailability,
);

router.get('/', authorize('ADMIN'), riders.list);
router.get('/:id', authorize('ADMIN'), riders.getOne);
router.post(
  '/:id/verify',
  authorize('ADMIN'),
  validateBody({ isVerified: { type: 'boolean', default: true } }),
  riders.verify,
);
router.patch(
  '/:id/availability',
  authorize('ADMIN'),
  validateBody({
    availability: { required: true, type: 'string', enum: ['AVAILABLE', 'OFFLINE'] },
  }),
  riders.adminSetAvailability,
);

export default router;
