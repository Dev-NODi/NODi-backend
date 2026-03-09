import { getFirebaseAdmin, isFirebaseInitialized } from '../config/firebase';
import logger from '../config/logger';
import prisma from '../config/database';

export interface PushNotificationPayload {
  type: string;
  sessionId?: number;
  dutyStatus?: string;
  shouldBlock?: boolean;
  companyId?: number;
  message?: string;
  [key: string]: any;
}

class PushNotificationService {
  /**
   * Send silent push notification (content-available)
   * This wakes the app in background for up to 30 seconds
   */
  async sendSilentPush(
    fcmToken: string,
    payload: PushNotificationPayload
  ): Promise<boolean> {
    // Mock mode if Firebase not initialized
    if (!isFirebaseInitialized()) {
      logger.info(`📱 [MOCK] Would send silent push: ${JSON.stringify(payload)}`);
      return true;
    }

    try {
      const admin = getFirebaseAdmin();

      // Convert all payload values to strings (FCM requirement)
      const data: { [key: string]: string } = {};
      for (const [key, value] of Object.entries(payload)) {
        data[key] = value !== null && value !== undefined ? String(value) : '';
      }

      const message = {
        token: fcmToken,
        data,
        apns: {
          headers: {
            'apns-priority': '10', // High priority
            'apns-push-type': 'background',
          },
          payload: {
            aps: {
              'content-available': 1, // Silent push - wakes app
            },
          },
        },
        android: {
          priority: 'high' as const,
        },
      };

      await admin.messaging().send(message);

      logger.info(`📱 Silent push sent successfully to ${fcmToken.substring(0, 20)}...`);
      return true;
    } catch (error: any) {
      // Handle invalid token
      if (
        error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered'
      ) {
        logger.warn(`⚠️  Invalid FCM token, marking for cleanup: ${error.code}`);
        // TODO: Mark token as invalid in database
        return false;
      }

      logger.error('❌ Silent push send failed:', error);
      return false;
    }
  }

  /**
   * Send visible notification (with alert)
   */
  async sendVisibleNotification(
    fcmToken: string,
    title: string,
    body: string,
    data?: any
  ): Promise<boolean> {
    if (!isFirebaseInitialized()) {
      logger.info(`📱 [MOCK] Would send notification: ${title} - ${body}`);
      return true;
    }

    try {
      const admin = getFirebaseAdmin();

      const message = {
        token: fcmToken,
        notification: {
          title,
          body,
        },
        data: data || {},
        apns: {
          payload: {
            aps: {
              alert: {
                title,
                body,
              },
              sound: 'default',
            },
          },
        },
        android: {
          notification: {
            title,
            body,
            sound: 'default',
          },
        },
      };

      await admin.messaging().send(message);

      logger.info(`📱 Notification sent: ${title}`);
      return true;
    } catch (error) {
      logger.error('❌ Notification send failed:', error);
      return false;
    }
  }

  /**
   * Send duty status change notification
   * Uses SSE if connected, otherwise silent push
   */
  async sendDutyStatusChange(
    driverId: number,
    dutyStatus: string,
    sessionId?: number,
    companyId?: number
  ): Promise<{ method: 'sse' | 'push' | 'failed'; success: boolean }> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    });

    if (!driver) {
      logger.error(`❌ Driver ${driverId} not found`);
      return { method: 'failed', success: false };
    }

    const payload: PushNotificationPayload = {
      type: 'duty_status_change',
      dutyStatus,
      sessionId,
      companyId,
      shouldBlock: dutyStatus === 'driving',
      timestamp: new Date().toISOString(),
    };

    // Try SSE first
    const SSEManager = (await import('./SSEManager')).default;
    const sseSent = await SSEManager.sendToDriver(driverId, 'duty_status_change', payload);

    if (sseSent) {
      logger.info(`✅ Duty status change sent via SSE to driver ${driverId}`);
      return { method: 'sse', success: true };
    }

    // Fallback to push notification
    if (!driver.fcmToken) {
      logger.warn(`⚠️  No FCM token for driver ${driverId} - cannot send push`);
      return { method: 'failed', success: false };
    }

    const pushSent = await this.sendSilentPush(driver.fcmToken, payload);

    if (pushSent) {
      logger.info(`✅ Duty status change sent via PUSH to driver ${driverId}`);
      return { method: 'push', success: true };
    }

    logger.error(`❌ Failed to send duty status change to driver ${driverId}`);
    return { method: 'failed', success: false };
  }
}

export default new PushNotificationService();