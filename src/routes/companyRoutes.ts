import { Router } from 'express';
import { CompanyController } from '../controllers/CompanyController';

const router = Router();

router.post('/', CompanyController.create);
router.get('/', CompanyController.list);
router.get('/:id', CompanyController.getById);

export default router;