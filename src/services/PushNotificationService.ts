import { getFirebaseAdmin, isFirebaseInitialized } from '../config/firebase';
import logger from '../config/logger';
import prisma from '../config/database';

export interface PushNotificationPayload {
  type: string;
  commandId?: string;
  action?: 'block' | 'unblock';
  sessionId?: number;
  dutyStatus?: string;
  shouldBlock?: boolean;
  companyId?: number;
  message?: string;
  [key: string]: any;
}

class PushNotificationService {
  private createCommandId(driverId: number) {
    return `cmd-${Date.now()}-${driverId}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async sendRawApnsBackgroundPush(
    fcmToken: string,
    payload: {
      type: string;
      action: 'block' | 'unblock';
      dutyStatus: string;
      commandId: string;
      apnsTopic?: string;
    }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!isFirebaseInitialized()) {
      logger.info(`📱 [MOCK] Would send raw APNs background push: ${JSON.stringify(payload)}`);
      return { success: true };
    }

    try {
      const admin = getFirebaseAdmin();
      const apnsTopic = payload.apnsTopic || process.env.IOS_BUNDLE_ID || process.env.APNS_TOPIC;

      if (!apnsTopic) {
        logger.error(
          '❌ Silent push blocked: missing APNS topic. Set IOS_BUNDLE_ID or APNS_TOPIC to your iOS app bundle id.'
        );
        return { success: false, error: 'Missing APNS topic' };
      }

      const headers: Record<string, string> = {
        'apns-priority': '5',
        'apns-push-type': 'background',
        'apns-topic': apnsTopic,
      };

      const data = {
        type: payload.type,
        action: payload.action,
        duty_status: payload.dutyStatus,
        commandId: payload.commandId,
      };

      const message = {
        token: fcmToken,
        data,
        apns: {
          headers,
          payload: {
            aps: {
              contentAvailable: true,
            },
            ...data,
          },
        },
      };

      const messageId = await admin.messaging().send(message);
      logger.info(
        `📱 Raw APNs background push sent successfully to ${fcmToken.substring(0, 20)}... topic=${apnsTopic} messageId=${messageId}`
      );

      return { success: true, messageId };
    } catch (error: any) {
      if (
        error.code === 'messaging/invalid-registration-token' ||
        error.code === 'messaging/registration-token-not-registered'
      ) {
        logger.warn(`⚠️  Invalid FCM token, marking for cleanup: ${error.code}`);
        return { success: false, error: error.code };
      }

      logger.error(
        `❌ Raw APNs background push failed: code=${error?.code || 'unknown'} message=${error?.message || 'unknown'}`,
        error
      );
      return { success: false, error: error?.message || 'Unknown silent push error' };
    }
  }

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
            'apns-priority': '5',
            'apns-push-type': 'background',
          },
          payload: {
            aps: {
              'content-available': 1,
            },
          },
        },
        android: {
          priority: 'high' as const,
        },
      };

      const messageId = await admin.messaging().send(message);

      logger.info(
        `📱 Silent push sent successfully to ${fcmToken.substring(0, 20)}... messageId=${messageId}`
      );
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

      logger.error(
        `❌ Silent push send failed: code=${error?.code || 'unknown'} message=${error?.message || 'unknown'}`,
        error
      );
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

      const messageId = await admin.messaging().send(message);

      logger.info(`📱 Notification sent: ${title} messageId=${messageId}`);
      return true;
    } catch (error) {
      logger.error('❌ Notification send failed:', error);
      return false;
    }
  }

  /**
   * Send block/unblock command to app and persist command state for ACK tracking.
   */
  async sendBlockingCommand(
    driverId: number,
    shouldBlock: boolean,
    dutyStatus?: string,
    sessionId?: number,
    companyId?: number,
    source: string = 'webhook',
    message?: string,
    apnsTopic?: string
  ): Promise<{
    method: 'sse' | 'push' | 'both' | 'failed';
    success: boolean;
    sseSent: boolean;
    pushSent: boolean;
    commandId: string;
    messageId?: string;
    pushError?: string;
  }> {
    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
    });

    const commandId = this.createCommandId(driverId);
    const action: 'block' | 'unblock' = shouldBlock ? 'block' : 'unblock';
    const resolvedSessionId =
      sessionId ||
      (
        await prisma.drivingSession.findFirst({
          where: {
            driverId,
            endedAt: null,
          },
          orderBy: {
            startedAt: 'desc',
          },
          select: {
            id: true,
          },
        })
      )?.id;

    if (!driver) {
      logger.error(`❌ Driver ${driverId} not found`);
      return {
        method: 'failed',
        success: false,
        sseSent: false,
        pushSent: false,
        commandId,
        pushError: 'Driver not found',
      };
    }

    await prisma.pushCommand.create({
      data: {
        commandId,
        driverId,
        sessionId: resolvedSessionId,
        requestedAction: action,
        shouldBlock,
        dutyStatus,
        source,
      },
    });

    // Try SSE first
    // const SSEManager = (await import('./SSEManager')).default;
    // const sseSent = await SSEManager.sendToDriver(driverId, 'blocking_command', payload);
    // if (sseSent) {
    //   logger.info(`✅ Blocking command sent via SSE to driver ${driverId} commandId=${commandId}`);
    // }

    // Always send the silent APNs-compatible payload for block/unblock commands.
    let pushSent = false;
    let messageId: string | undefined;
    let pushError: string | undefined;
    if (driver.fcmToken) {
      const apnsResult = await this.sendRawApnsBackgroundPush(driver.fcmToken, {
        type: 'blocking_command',
        action,
        dutyStatus: dutyStatus || (shouldBlock ? 'driving' : 'off_duty'),
        commandId,
        apnsTopic,
      });
      pushSent = apnsResult.success;
      messageId = apnsResult.messageId;
      pushError = apnsResult.error;
      //print full obejct of apnsResult, its showing object object in logs, we need to see the full details for debugging
      logger.info(`APNs push result: ${JSON.stringify(apnsResult)}`);
      if (pushSent) {
        logger.info(
          `✅ Blocking command sent via APNs background payload to driver ${driverId} commandId=${commandId} sessionId=${resolvedSessionId || 'none'}`
        );
      }
    } else {
      logger.warn(`⚠️  No FCM token for driver ${driverId} - cannot send push`);
    }

    await prisma.pushCommand.update({
      where: { commandId },
      data: {
        // sseSent,
        pushSent,
        sentAt: new Date(),
      },
    });

    if (resolvedSessionId) {
      await prisma.drivingSession.update({
        where: { id: resolvedSessionId },
        data: {
          requestedBlockingState: shouldBlock,
          lastCommandId: commandId,
        },
      });
    }

    // if (sseSent && pushSent) {
    //   return { method: 'both', success: true, sseSent: true, pushSent: true, commandId };
    // }
    // if (sseSent) {
    //   return { method: 'sse', success: true, sseSent: true, pushSent: false, commandId };
    // }
    if (pushSent) {
      return {
        method: 'push',
        success: true,
        sseSent: false,
        pushSent: true,
        commandId,
        messageId,
      };
    }

    logger.error(`❌ Failed to send blocking command to driver ${driverId} commandId=${commandId}`);
    return {
      method: 'failed',
      success: false,
      sseSent: false,
      pushSent: false,
      commandId,
      messageId,
      pushError,
    };
  }

  /**
   * Duty-status wrapper for block/unblock commands.
   */
  async sendDutyStatusChange(
    driverId: number,
    dutyStatus: string,
    sessionId?: number,
    companyId?: number
  ) {
    return this.sendBlockingCommand(
      driverId,
      dutyStatus === 'driving',
      dutyStatus,
      sessionId,
      companyId,
      'duty_status_change'
    );
  }
}

export default new PushNotificationService();
