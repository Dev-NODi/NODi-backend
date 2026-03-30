import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import logger from '../config/logger';
import PushNotificationService from '../services/PushNotificationService';
import {
  RegisterDriverSchema,
  AssignDriverSchema,
  UpdatePushTokenSchema,
  ApiResponse,
} from '../types';

export class DriverController {
  private static maskToken(token: string) {
    if (!token || token.length < 10) return '***';
    return `${token.slice(0, 8)}...${token.slice(-6)}`;
  }

  private static normalizeRequestedAction(input: {
    requestedAction?: string;
    action?: string;
    shouldBlock?: boolean;
    dutyStatus?: string;
    duty_status?: string;
  }): 'block' | 'unblock' {
    const normalizedAction = (input.requestedAction || input.action || '').toLowerCase();
    const blockValues = new Set(['block', 'start', 'enable']);
    const unblockValues = new Set(['unblock', 'stop', 'disable']);

    if (blockValues.has(normalizedAction)) return 'block';
    if (unblockValues.has(normalizedAction)) return 'unblock';

    if (typeof input.shouldBlock === 'boolean') {
      return input.shouldBlock ? 'block' : 'unblock';
    }

    const duty = (input.dutyStatus || input.duty_status || '').toLowerCase();
    if (duty === 'driving') return 'block';

    return 'unblock';
  }

  /**
   * GET /api/v1/drivers/:id/duty-status
   * Get driver's current duty status for the mobile app
   */
  static async getCurrentDutyStatus(req: Request, res: Response) {
    try {
      const driverId = parseInt(req.params.id as string);

      if (isNaN(driverId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid driver ID',
        } as ApiResponse);
      }

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: {
          id: true,
          name: true,
          email: true,
          lastSeenAt: true,
        },
      });

      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }

      const activeSession = await prisma.drivingSession.findFirst({
        where: {
          driverId,
          endedAt: null,
        },
        orderBy: {
          startedAt: 'desc',
        },
        select: {
          id: true,
          sessionId: true,
          companyId: true,
          dutyStatus: true,
          blockingActive: true,
          requestedBlockingState: true,
          appliedBlockingState: true,
          lastCommandId: true,
          lastAckAt: true,
          lastAckReason: true,
          startedAt: true,
          updatedAt: true,
        },
      });

      const latestWebhook = await prisma.motiveWebhook.findFirst({
        where: {
          ourDriverId: driverId,
        },
        orderBy: {
          receivedAt: 'desc',
        },
        select: {
          dutyStatus: true,
          receivedAt: true,
        },
      });

      const currentDutyStatus =
        activeSession?.dutyStatus ||
        latestWebhook?.dutyStatus ||
        'off_duty';

      const expectedBlocking =
        activeSession?.requestedBlockingState ??
        (currentDutyStatus === 'driving');
      const appliedBlocking = activeSession?.appliedBlockingState ?? null;

      let syncState: 'synced' | 'out_of_sync' | 'pending_ack' | 'unknown' = 'unknown';
      if (!activeSession?.lastCommandId) {
        syncState = activeSession ? 'unknown' : 'synced';
      } else if (appliedBlocking === null) {
        syncState = 'pending_ack';
      } else if (appliedBlocking === expectedBlocking) {
        syncState = 'synced';
      } else {
        syncState = 'out_of_sync';
      }

      return res.json({
        success: true,
        data: {
          driver: {
            id: driver.id,
            name: driver.name,
            email: driver.email,
            lastSeenAt: driver.lastSeenAt,
          },
          dutyStatus: {
            current: currentDutyStatus,
            source: activeSession ? 'active_session' : latestWebhook ? 'latest_webhook' : 'default',
            updatedAt: activeSession?.updatedAt || latestWebhook?.receivedAt || null,
          },
          session: activeSession
            ? {
                id: activeSession.id,
                sessionId: activeSession.sessionId,
                companyId: activeSession.companyId,
                startedAt: activeSession.startedAt,
                blockingActive: activeSession.blockingActive,
                requestedBlockingState: activeSession.requestedBlockingState,
                appliedBlockingState: activeSession.appliedBlockingState,
                lastCommandId: activeSession.lastCommandId,
                lastAckAt: activeSession.lastAckAt,
                lastAckReason: activeSession.lastAckReason,
              }
            : null,
          sync: {
            motiveExpectedBlocking: expectedBlocking,
            appAppliedBlocking: appliedBlocking,
            inSync: syncState === 'synced',
            syncState,
          },
        },
      } as ApiResponse);
    } catch (error) {
      logger.error('Driver duty status fetch error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch current duty status',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/drivers/register
   * Register a driver (phone-based, no OAuth)
   */
  static async register(req: Request, res: Response) {
    try {
      const data = RegisterDriverSchema.parse(req.body);

      // Check if driver already exists by phone
      let driver = await prisma.driver.findUnique({
        where: { phone: data.phone },
        include: {
          companies: {
            include: {
              company: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (driver) {
        // Driver exists - update device info
        driver = await prisma.driver.update({
          where: { id: driver.id },
          data: {
            deviceId: data.deviceId,
            devicePlatform: data.devicePlatform,
            fcmToken: data.fcmToken,
            fcmTokenUpdatedAt: data.fcmToken ? new Date() : undefined,
            lastSeenAt: new Date(),
          },
          include: {
            companies: {
              include: {
                company: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        });

        logger.info(`✅ Driver updated: ${driver.id} - ${driver.phone}`);

        return res.json({
          success: true,
          data: {
            driver,
            isNew: false,
          },
          message: 'Driver device info updated',
        } as ApiResponse);
      }

      // Create new driver
      driver = await prisma.driver.create({
        data: {
          phone: data.phone,
          name: data.name,
          email: data.email,
          deviceId: data.deviceId,
          devicePlatform: data.devicePlatform,
          fcmToken: data.fcmToken,
          fcmTokenUpdatedAt: data.fcmToken ? new Date() : undefined,
          lastSeenAt: new Date(),
        },
        include: {
          companies: {
            include: {
              company: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!driver) {
        throw new Error('Failed to create driver');
      }

      logger.info(`✅ Driver registered: ${driver.id} - ${driver.phone}`);

      res.status(201).json({
        success: true,
        data: {
          driver,
          isNew: true,
        },
        message: 'Driver registered successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues, // changed from error.errors to error.issues to match Zod's structure
        } as ApiResponse);
      }

      logger.error('Driver registration error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to register driver',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/drivers/:id/assign
   * Assign driver to company with role
   */
  static async assignToCompany(req: Request, res: Response) {
    try {
      const driverId = parseInt(req.params.id as string);

      if (isNaN(driverId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid driver ID',
        } as ApiResponse);
      }

      const data = AssignDriverSchema.parse(req.body);

      // Verify driver exists
      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
      });

      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }

      // Verify company exists
      const company = await prisma.company.findUnique({
        where: { id: data.companyId },
      });

      if (!company) {
        return res.status(404).json({
          success: false,
          error: 'Company not found',
        } as ApiResponse);
      }

      // Check if already assigned
      const existing = await prisma.driverCompanyAssignment.findUnique({
        where: {
          driverId_companyId: {
            driverId,
            companyId: data.companyId,
          },
        },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          error: 'Driver already assigned to this company',
        } as ApiResponse);
      }

      // Create assignment
      const assignment = await prisma.driverCompanyAssignment.create({
        data: {
          driverId,
          companyId: data.companyId,
          role: data.role,
          motiveDriverIdInCompany: data.motiveDriverId,
        },
        include: {
          driver: {
            select: {
              id: true,
              name: true,
            },
          },
          company: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      logger.info(
        `✅ Driver assigned: ${driver.name} (${driverId}) → ${company.name} (${data.companyId}) as ${data.role}`
      );

      res.status(201).json({
        success: true,
        data: assignment,
        message: 'Driver assigned to company successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues, // changed from error.errors to error.issues to match Zod's structure
        } as ApiResponse);
      }

      logger.error('Driver assignment error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to assign driver',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/drivers/push-token
   * Update driver's FCM push token
   */
  static async updatePushToken(req: Request, res: Response) {
    try {
      const data = UpdatePushTokenSchema.parse(req.body);
      const maskedToken = DriverController.maskToken(data.fcmToken);

      logger.info(
        `📲 Push token received: driver=${data.driverId} platform=${data.devicePlatform || 'unknown'} token=${maskedToken}`
      );

      const existingDriver = await prisma.driver.findUnique({
        where: { id: data.driverId },
        select: { id: true, fcmToken: true },
      });

      if (!existingDriver) {
        logger.warn(`⚠️ Push token update failed: driver ${data.driverId} not found`);
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }

      const tokenChanged = existingDriver.fcmToken !== data.fcmToken;
      const updatedDriver = await prisma.driver.update({
        where: { id: data.driverId },
        data: {
          fcmToken: data.fcmToken,
          fcmTokenUpdatedAt: new Date(),
          deviceId: data.deviceId,
          devicePlatform: data.devicePlatform,
          lastSeenAt: new Date(),
        },
        select: {
          id: true,
          deviceId: true,
          devicePlatform: true,
          fcmTokenUpdatedAt: true,
        },
      });

      logger.info(
        `✅ Push token stored: driver=${updatedDriver.id} changed=${tokenChanged} updatedAt=${updatedDriver.fcmTokenUpdatedAt?.toISOString()}`
      );

      return res.json({
        success: true,
        data: {
          ...updatedDriver,
          tokenChanged,
        },
        message: tokenChanged ? 'Push token updated' : 'Push token already up to date',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        logger.warn('⚠️ Push token validation failed', error.issues);
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues,
        } as ApiResponse);
      }

      logger.error('Push token update error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update push token',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/drivers/:id/test-push
   * Send test silent push to validate FCM delivery for a driver
   */
  static async testPush(req: Request, res: Response) {
    try {
      const driverId = parseInt(req.params.id as string);
      if (isNaN(driverId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid driver ID',
        } as ApiResponse);
      }

      const bodySchema = z.object({
        shouldBlock: z.boolean().optional(),
        dutyStatus: z.string().optional(),
        message: z.string().optional(),
        mode: z.enum(['silent', 'visible', 'both']).optional(),
        apnsTopic: z.string().optional(),
      });
      const body = bodySchema.parse(req.body || {});

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, fcmToken: true },
      });

      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }

      if (!driver.fcmToken) {
        return res.status(400).json({
          success: false,
          error: 'Driver has no FCM token',
        } as ApiResponse);
      }

      const payload = {
        shouldBlock: body.shouldBlock ?? true,
        dutyStatus: body.dutyStatus || 'driving',
        message: body.message || 'NODi push test',
        mode: body.mode || 'both',
      };

      logger.info(
        `🧪 Sending test push to driver=${driverId} mode=${payload.mode} shouldBlock=${payload.shouldBlock} topic=${body.apnsTopic || process.env.IOS_BUNDLE_ID || process.env.APNS_TOPIC || 'none'}`
      );

      let result: {
        method: 'sse' | 'push' | 'both' | 'failed';
        success: boolean;
        sseSent: boolean;
        pushSent: boolean;
        commandId: string;
        messageId?: string;
        pushError?: string;
      } = {
        method: 'failed' as const,
        success: false,
        sseSent: false,
        pushSent: false,
        commandId: `cmd-test-${Date.now()}`,
        messageId: undefined as string | undefined,
        pushError: undefined as string | undefined,
      };

      if (payload.mode === 'silent' || payload.mode === 'both') {
        result = await PushNotificationService.sendBlockingCommand(
          driverId,
          payload.shouldBlock,
          payload.dutyStatus,
          undefined,
          undefined,
          'manual_test',
          payload.message,
          body.apnsTopic
        );
      }

      let visibleSent = false;
      let visibleCommandId = result.commandId;
      if (payload.mode === 'visible' || payload.mode === 'both') {
        if (!visibleCommandId) {
          visibleCommandId = `cmd-visible-${Date.now()}`;
        }

        visibleSent = await PushNotificationService.sendVisibleNotification(
          driver.fcmToken,
          payload.shouldBlock ? 'NODi: Block Enabled' : 'NODi: Block Disabled',
          payload.message,
          {
            type: 'blocking_command',
            commandId: visibleCommandId,
            action: payload.shouldBlock ? 'block' : 'unblock',
          }
        );
      }

      const silentRequested = payload.mode === 'silent' || payload.mode === 'both';
      const visibleRequested = payload.mode === 'visible' || payload.mode === 'both';
      const success =
        (!silentRequested || result.pushSent) &&
        (!visibleRequested || visibleSent);

      return res.json({
        success,
        data: {
          driverId,
          commandId: payload.mode === 'visible' ? visibleCommandId : result.commandId,
          delivery: {
            method: payload.mode,
            sseSent: result.sseSent,
            silentPushSent: result.pushSent,
            silentMessageId: result.messageId,
            silentPushError: result.pushError,
            visiblePushSent: visibleSent,
          },
        },
        message: success ? 'Test push sent' : 'Test push failed',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues,
        } as ApiResponse);
      }

      logger.error('Test push error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send test push',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/drivers/:id/test-silent-apns
   * Send exact APNs background push shape via FCM for iOS testing
   */
  static async testSilentApnsPush(req: Request, res: Response) {
    try {
      const driverId = parseInt(req.params.id as string);
      if (isNaN(driverId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid driver ID',
        } as ApiResponse);
      }

      const bodySchema = z.object({
        action: z.enum(['block', 'unblock']),
        dutyStatus: z.string().min(1),
        commandId: z.string().min(1).optional(),
        apnsTopic: z.string().min(1).optional(),
      });
      const body = bodySchema.parse(req.body || {});

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { id: true, fcmToken: true },
      });

      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }

      if (!driver.fcmToken) {
        return res.status(400).json({
          success: false,
          error: 'Driver has no FCM token',
        } as ApiResponse);
      }

      const commandId =
        body.commandId ||
        `cmd_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${body.action}_${driverId}`;
      const apnsTopic =
        body.apnsTopic ||
        process.env.IOS_BUNDLE_ID ||
        process.env.APNS_TOPIC;

      logger.info(
        `🧪 Sending raw APNs background push to driver=${driverId} action=${body.action} dutyStatus=${body.dutyStatus} topic=${apnsTopic || 'none'}`
      );

      const result = await PushNotificationService.sendRawApnsBackgroundPush(driver.fcmToken, {
        type: 'blocking_command',
        action: body.action,
        dutyStatus: body.dutyStatus,
        commandId,
        apnsTopic,
      });

      return res.json({
        success: result.success,
        data: {
          driverId,
          commandId,
          action: body.action,
          dutyStatus: body.dutyStatus,
          apnsTopic: apnsTopic || null,
          messageId: result.messageId,
        },
        message: result.success ? 'Silent APNs push sent' : 'Silent APNs push failed',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues,
        } as ApiResponse);
      }

      logger.error('Silent APNs push test error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to send silent APNs push',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/drivers/push-command-ack
   * Receive app ACK for block/unblock command application
   */
  static async pushCommandAck(req: Request, res: Response) {
    try {
      const ackSchema = z.object({
        commandId: z.string().min(1),
        driverId: z.number().int().positive(),
        deviceId: z.string().optional(),
        requestedAction: z.string().optional(),
        action: z.string().optional(),
        shouldBlock: z.boolean().optional(),
        dutyStatus: z.string().optional(),
        duty_status: z.string().optional(),
        applied: z.boolean(),
        source: z.string().optional(),
        timestamp: z.string().optional(),
        reason: z.string().optional(),
      });

      const ack = ackSchema.parse(req.body);
      const requestedAction = DriverController.normalizeRequestedAction(ack);
      const shouldBlock = requestedAction === 'block';
      const ackTimestamp = ack.timestamp ? new Date(ack.timestamp) : new Date();

      const driver = await prisma.driver.findUnique({
        where: { id: ack.driverId },
        select: { id: true },
      });
      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }

      logger.info(
        `📩 Push ACK received: commandId=${ack.commandId} driver=${ack.driverId} action=${requestedAction} applied=${ack.applied}`
      );

      const command = await prisma.pushCommand.upsert({
        where: { commandId: ack.commandId },
        create: {
          commandId: ack.commandId,
          driverId: ack.driverId,
          requestedAction,
          shouldBlock,
          dutyStatus: ack.dutyStatus || ack.duty_status,
          source: ack.source || 'mobile_ack_only',
          ackApplied: ack.applied,
          ackSource: ack.source || 'app',
          ackTimestamp,
          ackReason: ack.reason,
          ackDeviceId: ack.deviceId,
          rawAck: ack as any,
        },
        update: {
          ackApplied: ack.applied,
          ackSource: ack.source || 'app',
          ackTimestamp,
          ackReason: ack.reason,
          ackDeviceId: ack.deviceId,
          rawAck: ack as any,
        },
        select: {
          commandId: true,
          sessionId: true,
          shouldBlock: true,
        },
      });

      if (command.sessionId) {
        await prisma.drivingSession.update({
          where: { id: command.sessionId },
          data: {
            requestedBlockingState: command.shouldBlock,
            appliedBlockingState: ack.applied ? command.shouldBlock : null,
            blockingActive: ack.applied ? command.shouldBlock : undefined,
            lastCommandId: command.commandId,
            lastAckAt: ackTimestamp,
            lastAckReason: ack.reason,
          },
        });
      }

      if (ack.deviceId) {
        await prisma.driver.update({
          where: { id: ack.driverId },
          data: {
            deviceId: ack.deviceId,
            lastSeenAt: new Date(),
          },
        });
      }

      return res.json({
        success: true,
        data: {
          commandId: ack.commandId,
          driverId: ack.driverId,
          requestedAction,
          applied: ack.applied,
          shouldBlock,
        },
        message: 'ACK stored',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues,
        } as ApiResponse);
      }

      logger.error('Push command ACK error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to store push command ACK',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/drivers/:id
   * Get driver by ID
   */
  static async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);

      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid driver ID',
        } as ApiResponse);
      }

      const driver = await prisma.driver.findUnique({
        where: { id },
        include: {
          companies: {
            include: {
              company: true,
            },
          },
        },
      });

      if (!driver) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }

      res.json({
        success: true,
        data: driver,
      } as ApiResponse);
    } catch (error) {
      logger.error('Driver fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch driver',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/drivers
   * List all drivers
   */
  static async list(req: Request, res: Response) {
    try {
      const drivers = await prisma.driver.findMany({
        where: { isActive: true },
        include: {
          companies: {
            include: {
              company: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        data: drivers,
      } as ApiResponse);
    } catch (error) {
      logger.error('Drivers list error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch drivers',
      } as ApiResponse);
    }
  }
}
