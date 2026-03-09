import { Response } from 'express';
import redis from '../config/redis';
import logger from '../config/logger';

interface SSEConnection {
  driverId: number;
  response: Response;
  connectedAt: Date;
}

class SSEManager {
  private connections: Map<number, SSEConnection> = new Map();

  /**
   * Register new SSE connection for a driver
   */
  async connect(driverId: number, res: Response): Promise<void> {
    // Close existing connection if any
    const existing = this.connections.get(driverId);
    if (existing) {
      logger.info(`🔌 Closing existing SSE connection for driver ${driverId}`);
      existing.response.end();
    }

    // Store new connection
    this.connections.set(driverId, {
      driverId,
      response: res,
      connectedAt: new Date(),
    });

    // Store in Redis for tracking across server instances
    await redis.hset('sse:connections', driverId.toString(), Date.now().toString());

    logger.info(
      `🔌 SSE connected: driver=${driverId} (${this.connections.size} total connections)`
    );
  }

  /**
   * Disconnect SSE for a driver
   */
  async disconnect(driverId: number): Promise<void> {
    const connection = this.connections.get(driverId);
    if (connection) {
      connection.response.end();
      this.connections.delete(driverId);
      await redis.hdel('sse:connections', driverId.toString());

      logger.info(
        `🔌 SSE disconnected: driver=${driverId} (${this.connections.size} remaining)`
      );
    }
  }

  /**
   * Check if driver has active SSE connection
   */
  isConnected(driverId: number): boolean {
    return this.connections.has(driverId);
  }

  /**
   * Send event to a specific driver via SSE
   */
  async sendToDriver(
    driverId: number,
    eventType: string,
    data: any
  ): Promise<boolean> {
    const connection = this.connections.get(driverId);

    if (!connection) {
      logger.warn(`⚠️  No SSE connection for driver ${driverId}`);
      return false;
    }

    try {
      const payload = JSON.stringify(data);

      connection.response.write(`event: ${eventType}\n`);
      connection.response.write(`data: ${payload}\n\n`);

      logger.info(`📤 SSE sent to driver ${driverId}: ${eventType}`);
      return true;
    } catch (error) {
      logger.error(`❌ SSE send failed for driver ${driverId}:`, error);

      // Remove dead connection
      await this.disconnect(driverId);
      return false;
    }
  }

  /**
   * Broadcast event to all connected drivers
   */
  async broadcast(eventType: string, data: any): Promise<number> {
    let successCount = 0;

    for (const [driverId] of this.connections) {
      const sent = await this.sendToDriver(driverId, eventType, data);
      if (sent) successCount++;
    }

    logger.info(`📡 Broadcast to ${successCount}/${this.connections.size} drivers`);
    return successCount;
  }

  /**
   * Get connection stats
   */
  getStats() {
    return {
      totalConnections: this.connections.size,
      drivers: Array.from(this.connections.keys()),
    };
  }

  /**
   * Cleanup dead connections (run periodically)
   */
  async cleanupDeadConnections(): Promise<void> {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [driverId, connection] of this.connections) {
      const age = now - connection.connectedAt.getTime();
      if (age > timeout) {
        logger.warn(`⚠️  Cleaning up stale connection for driver ${driverId}`);
        await this.disconnect(driverId);
      }
    }
  }
}

export default new SSEManager();