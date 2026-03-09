import { Request, Response } from 'express';
import { z } from 'zod';
import logger from '../config/logger';
import { WebhookService } from '../services/WebhookService';
import { MotiveWebhookSchema, ApiResponse } from '../types';
import prisma from '../config/database';

export class WebhookController {
  /**
   * POST /api/v1/webhooks/motive
   * Receive Motive webhook for duty status updates
   */
  static async handleMotiveWebhook(req: Request, res: Response) {
    try {
      // Validate webhook payload
      const payload = MotiveWebhookSchema.parse(req.body);

      const signature = req.headers['x-motive-signature'] as string;

      logger.info(
        `📬 Motive webhook received: ${payload.event_type} - driver=${payload.driver_id} - company=${payload.company_id}`
      );

      // Process webhook
      const result = await WebhookService.processMotiveWebhook(payload, signature);

      if (result.success) {
        logger.info(
          `✅ Webhook processed successfully: ${result.webhookId} - ${result.message}`
        );

        return res.json({
          success: true,
          data: {
            webhookId: result.webhookId.toString(),
            sessionId: result.sessionId,
          },
          message: result.message,
        } as ApiResponse);
      } else {
        logger.error(`❌ Webhook processing failed: ${result.error}`);

        return res.status(400).json({
          success: false,
          error: result.error,
          data: {
            webhookId: result.webhookId.toString(),
          },
        } as ApiResponse);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.error('❌ Webhook validation error:', error.issues);
        return res.status(400).json({
          success: false,
          error: 'Invalid webhook payload',
          data: error.issues,
        } as ApiResponse);
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`❌ Webhook handler error: ${errorMessage}`);

      res.status(500).json({
        success: false,
        error: 'Failed to process webhook',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/webhooks/logs
   * Get recent webhook logs (for debugging)
   */
  static async getWebhookLogs(req: Request, res: Response) {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const status = req.query.status as string;

      const webhooks = await prisma.motiveWebhook.findMany({
        where: status ? { processingStatus: status } : undefined,
        orderBy: { receivedAt: 'desc' },
        take: limit,
      });

      res.json({
        success: true,
        data: webhooks.map((w:any) => ({
          ...w,
          id: w.id.toString(), // Convert BigInt to string for JSON
        })),
      } as ApiResponse);
    } catch (error) {
      logger.error('Webhook logs error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch webhook logs',
      } as ApiResponse);
    }
  }
}