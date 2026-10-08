import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import * as users from '../controllers/users.controller.js';

const router = Router();

router.use(authenticate);

router.get('/me', users.me);
router.patch(
  '/me',
  validateBody({
    firstName: { type: 'string', minLength: 1, maxLength: 80 },
    lastName: { type: 'string', minLength: 1, maxLength: 80 },
    phone: { type: 'string', maxLength: 20, pattern: /^[+0-9()\-\s]*$/ },
    password: { type: 'string', minLength: 8, maxLength: 100 },
    currentPassword: { type: 'string', maxLength: 100 },
  }),
  users.updateMe,
);

router.get('/', authorize('ADMIN'), users.list);
router.get('/:id', authorize('ADMIN'), users.getOne);
router.patch(
  '/:id/status',
  authorize('ADMIN'),
  validateBody({ status: { required: true, type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] } }),
  users.changeStatus,
);

export default router;
