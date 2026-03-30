import { Router } from 'express';
import { DriverController } from '../controllers/DriverController';

const router = Router();

router.post('/register', DriverController.register);
router.post('/push-token', DriverController.updatePushToken);
router.post('/push-command-ack', DriverController.pushCommandAck);
router.post('/:id/test-push', DriverController.testPush);
router.post('/:id/test-silent-apns', DriverController.testSilentApnsPush);
router.post('/:id/assign', DriverController.assignToCompany);
router.get('/:id/duty-status', DriverController.getCurrentDutyStatus);
router.get('/', DriverController.list);
router.get('/:id', DriverController.getById);

export default router;
