import prisma from '../config/database';
import logger from '../config/logger';
import PushNotificationService from './PushNotificationService';

const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000;
const HEARTBEAT_POLL_MS = 60 * 1000;

class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.processDueHeartbeats();
    }, HEARTBEAT_POLL_MS);

    void this.processDueHeartbeats();
    logger.info('Heartbeat service started');
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async processDueHeartbeats() {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const dueAt = new Date(Date.now() - HEARTBEAT_INTERVAL_MS);
      const sessions = await prisma.drivingSession.findMany({
        where: {
          endedAt: null,
          OR: [
            { lastHeartbeatSentAt: null },
            { lastHeartbeatSentAt: { lte: dueAt } },
          ],
        },
        select: {
          id: true,
          sessionId: true,
          driverId: true,
          blockingActive: true,
          dutyStatus: true,
          isTampered: true,
          lastHeartbeatSentAt: true,
          lastHeartbeatAckAt: true,
          missedHeartbeatCount: true,
          driver: {
            select: {
              fcmToken: true,
            },
          },
        },
      });

      for (const session of sessions) {
        await this.processSessionHeartbeat(session);
      }
    } catch (error) {
      logger.error('Heartbeat processing failed:', error);
    } finally {
      this.running = false;
    }
  }

  private async processSessionHeartbeat(session: {
    id: number;
    sessionId: string;
    driverId: number;
    blockingActive: boolean;
    dutyStatus: string;
    isTampered: boolean | null;
    lastHeartbeatSentAt: Date | null;
    lastHeartbeatAckAt: Date | null;
    missedHeartbeatCount: number;
    driver: {
      fcmToken: string | null;
    };
  }) {
    let missedHeartbeatCount = session.missedHeartbeatCount;
    const previousHeartbeatMissed =
      !!session.lastHeartbeatSentAt &&
      (!session.lastHeartbeatAckAt || session.lastHeartbeatAckAt < session.lastHeartbeatSentAt);

    if (previousHeartbeatMissed) {
      missedHeartbeatCount += 1;
    }

    const tamperTriggered = missedHeartbeatCount >= 2 && !session.isTampered;
    if (tamperTriggered) {
      await prisma.drivingSession.update({
        where: { id: session.id },
        data: {
          isTampered: true,
          tamperedAt: new Date(),
          tamperedReason: 'missed_heartbeat_ack_2x',
          missedHeartbeatCount,
        },
      });

      logger.warn(
        `Tamper flagged for session ${session.sessionId} after ${missedHeartbeatCount} missed heartbeat acknowledgements`
      );
    }

    if (!session.driver.fcmToken) {
      if (missedHeartbeatCount !== session.missedHeartbeatCount && !tamperTriggered) {
        await prisma.drivingSession.update({
          where: { id: session.id },
          data: {
            missedHeartbeatCount,
          },
        });
      }

      logger.warn(`Skipping heartbeat for session ${session.sessionId}: driver has no FCM token`);
      return;
    }

    const result = await PushNotificationService.sendHeartbeat(
      session.driverId,
      session.id,
      session.sessionId,
      session.blockingActive,
      session.dutyStatus
    );

    if (!result.pushSent) {
      if (missedHeartbeatCount !== session.missedHeartbeatCount && !tamperTriggered) {
        await prisma.drivingSession.update({
          where: { id: session.id },
          data: {
            missedHeartbeatCount,
          },
        });
      }

      logger.warn(
        `Heartbeat push failed for session ${session.sessionId}: ${result.pushError || 'unknown error'}`
      );
      return;
    }

    await prisma.drivingSession.update({
      where: { id: session.id },
      data: {
        lastHeartbeatSentAt: new Date(),
        heartbeatCommandId: result.commandId,
        missedHeartbeatCount,
      },
    });
  }
}

export default new HeartbeatService();
