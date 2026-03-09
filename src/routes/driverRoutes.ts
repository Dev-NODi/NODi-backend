import { Router } from 'express';
import { DriverController } from '../controllers/DriverController';

const router = Router();

router.post('/register', DriverController.register);
router.post('/:id/assign', DriverController.assignToCompany);
router.get('/', DriverController.list);
router.get('/:id', DriverController.getById);

export default router;