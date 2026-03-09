import { Router } from 'express';
import { SessionController } from '../controllers/SessionController';

const router = Router();

// Get all active sessions
router.get('/active', SessionController.getActiveSessions);

// Get sessions for a driver
router.get('/driver/:driverId', SessionController.getDriverSessions);

// Get session by ID
router.get('/:id', SessionController.getSessionById);

// End session (admin override)
router.post('/:id/end', SessionController.endSession);

export default router;