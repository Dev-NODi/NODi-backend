import { Router } from 'express';
import { SSEController } from '../controllers/SSEController';

const router = Router();

// SSE stream endpoint
router.get('/stream', SSEController.stream);

// SSE stats (for debugging)
router.get('/stats', SSEController.getStats);

export default router;