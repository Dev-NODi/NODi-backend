import { Router } from 'express';
import { WebhookController } from '../controllers/WebhookController';
import { validateMotiveHMAC } from '../middleware/validateHMAC';

const router = Router();

// Motive webhook receiver (with HMAC validation)
router.post('/motive', validateMotiveHMAC, WebhookController.handleMotiveWebhook);

// Webhook logs (for debugging)
router.get('/logs', WebhookController.getWebhookLogs);

export default router;