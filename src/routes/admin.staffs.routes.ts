import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import * as staff from '../controllers/staff.controller.js';

const router = Router();

router.use(authenticate);

// Admin-only: CRUD for staff accounts
router.get('/', authorize('ADMIN'), staff.listStaffs);
router.post(
  '/',
  authorize('ADMIN'),
  validateBody({
    email: { required: true, type: 'string', maxLength: 255 },
    password: { required: true, type: 'string', minLength: 8, maxLength: 100 },
    firstName: { required: true, type: 'string', minLength: 1, maxLength: 80 },
    lastName: { required: true, type: 'string', minLength: 1, maxLength: 80 },
    phone: { type: 'string', maxLength: 20 },
  }),
  staff.createStaff,
);
router.get('/:id', authorize('ADMIN'), staff.getStaff);
router.patch(
  '/:id/status',
  authorize('ADMIN'),
  validateBody({ status: { required: true, type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] } }),
  staff.changeStaffStatus,
);

export default router;
