import { Router } from 'express';
import { WebhookController } from '../controllers/WebhookController';

const router = Router();

// Motive webhook receiver
router.post('/motive', WebhookController.handleMotiveWebhook);

// Webhook logs (for debugging)
router.get('/logs', WebhookController.getWebhookLogs);

export default router;