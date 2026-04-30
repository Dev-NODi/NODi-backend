import { Router } from 'express';
import { DriverController } from '../controllers/DriverController';

const router = Router();

router.post('/register', DriverController.register);
router.post('/push-token', DriverController.updatePushToken);
router.post('/push-command-ack', DriverController.pushCommandAck);
router.post('/heartbeat-ack', DriverController.heartbeatAck);
router.post('/:driverId/sessions/current/blocked-attempts/sync', DriverController.syncCurrentSessionBlockedAttempts);
router.post('/:id/test-push', DriverController.testPush);
router.post('/:id/test-silent-apns', DriverController.testSilentApnsPush);
router.post('/:id/assign', DriverController.assignToCompany);
router.patch('/:driverId/allowlist-selection-access', DriverController.updateAllowlistSelectionAccess);
router.put('/:driverId/allowlist', DriverController.updateAllowlist);
router.get('/:driverId/allowlist-selection-access', DriverController.getAllowlistSelectionAccess);
router.get('/:driverId/allowlist/:deviceId', DriverController.getAllowlist);
router.get('/:id/duty-status', DriverController.getCurrentDutyStatus);
router.get('/:driverId/sessions/current/blocked-attempts', DriverController.getCurrentSessionBlockedAttempts);
router.get('/', DriverController.list);
router.get('/:id', DriverController.getById);

export default router;
