import { Request, Response } from 'express';
import SSEManager from '../services/SSEManager';
import logger from '../config/logger';

export class SSEController {
  /**
   * GET /api/v1/sse/stream?driver_id=123
   * Establish SSE connection for a driver
   */
  static async stream(req: Request, res: Response) {
    const driverId = parseInt(req.query.user_id as string);
    console.log('Received SSE connection request for driver_id:', req.query);
    if (!driverId || isNaN(driverId)) {
      return res.status(400).json({
        success: false,
        error: 'Valid driver_id query parameter required',
      });
    }

    logger.info(`🔌 SSE connection request from driver ${driverId}`);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in nginx
    res.flushHeaders();

    // Register connection
    await SSEManager.connect(driverId, res);

    // Send initial connected event
    res.write(`event: connected\n`);
    res.write(
      `data: ${JSON.stringify({
        driverId,
        serverTime: new Date().toISOString(),
        message: 'SSE connection established',
      })}\n\n`
    );

    // Send periodic heartbeat (every 30 seconds)
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(`: heartbeat\n\n`);
      } catch (error) {
        clearInterval(heartbeatInterval);
      }
    }, 30000);

    // Handle client disconnect
    req.on('close', async () => {
      clearInterval(heartbeatInterval);
      await SSEManager.disconnect(driverId);
    });

    req.on('error', async (error) => {
      logger.error(`SSE connection error for driver ${driverId}:`, error);
      clearInterval(heartbeatInterval);
      await SSEManager.disconnect(driverId);
    });
  }

  /**
   * GET /api/v1/sse/stats
   * Get SSE connection statistics
   */
  static getStats(req: Request, res: Response) {
    const stats = SSEManager.getStats();
    res.json({
      success: true,
      data: stats,
    });
  }
}