import { Router } from 'express';
import authRoutes from './authRoutes';
import companyRoutes from './companyRoutes';
import driverRoutes from './driverRoutes';
import webhookRoutes from './webhookRoutes';
import sseRoutes from './sseRoutes';
import sessionRoutes from './sessionRoutes';
import fleetRoutes from './fleetRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/fleet', fleetRoutes);
router.use('/companies', companyRoutes);
router.use('/drivers', driverRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/sse', sseRoutes);
router.use('/sessions', sessionRoutes);

export default router;
