import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import * as stats from '../controllers/stats.controller.js';

const router = Router();

router.use(authenticate);

router.get('/platform', authorize('ADMIN'), stats.platformStats);
router.get('/rider', authorize('RIDER'), stats.riderStats);
router.get('/customer', authorize('CUSTOMER'), stats.customerStats);

export default router;
