import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config/env.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { authenticate } from '../middleware/auth.middleware.js';
import * as auth from '../controllers/auth.controller.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: config.authRateLimit.windowMs,
  limit: config.authRateLimit.limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
});

const registerRules = {
  email: {
    required: true,
    type: 'string',
    maxLength: 255,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'email must be a valid email address',
  },
  password: { required: true, type: 'string', minLength: 8, maxLength: 100 },
  firstName: { required: true, type: 'string', minLength: 1, maxLength: 80 },
  lastName: { required: true, type: 'string', minLength: 1, maxLength: 80 },
  phone: { type: 'string', maxLength: 20, pattern: /^[+0-9()\-\s]*$/ },
  role: { type: 'string', enum: ['CUSTOMER', 'RIDER'], default: 'CUSTOMER' },
  vehicleType: { type: 'string', maxLength: 40 },
  vehiclePlate: { type: 'string', maxLength: 20 },
  licenseNumber: { type: 'string', maxLength: 40 },
  city: { type: 'string', maxLength: 80 },
} as const;

router.post('/register', authLimiter, validateBody(registerRules), auth.register);
router.post(
  '/login',
  authLimiter,
  validateBody({
    email: { required: true, type: 'string', maxLength: 255 },
    password: { required: true, type: 'string', maxLength: 100 },
  }),
  auth.login,
);
router.post('/logout', auth.logout);
router.get('/me', authenticate, auth.me);

export default router;
