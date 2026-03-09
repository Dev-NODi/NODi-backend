import prisma from '../config/database';
import logger from '../config/logger';
import { MotiveWebhookPayload, WebhookProcessingResult } from '../types';
import PushNotificationService from './PushNotificationService';

export class WebhookService {
    /**
     * Process incoming Motive webhook
     */
    static async processMotiveWebhook(
        payload: MotiveWebhookPayload,
        signature: string
    ): Promise<WebhookProcessingResult> {
        try {
            // 1. Log webhook to database immediately
            const webhook = await prisma.motiveWebhook.create({
                data: {
                    action: payload.action,
                    trigger: payload.trigger,
                    motiveDriverId: payload.id,
                    driverRole: payload.role,
                    firstName: payload.first_name,
                    lastName: payload.last_name,
                    username: payload.username,
                    driverCompanyId: payload.driver_company_id,
                    payload: payload as any,
                    dutyStatus: payload.duty_status,
                    processingStatus: 'pending',
                },
            });

            logger.info(
                `📥 Webhook logged: ${webhook.id} - ${payload.action} - ` +
                `driver=${payload.id} (${payload.first_name} ${payload.last_name}) - ` +
                `status=${payload.duty_status}`
            );

            // 2. Handle duty status update
            if (payload.action === 'user_duty_status_updated') {
                const result = await this.handleDutyStatusUpdate(webhook.id, payload);

                // Update webhook status
                await prisma.motiveWebhook.update({
                    where: { id: webhook.id },
                    data: {
                        processingStatus: result.success ? 'processed' : 'failed',
                        processedAt: new Date(),
                        errorMessage: result.error,
                        sessionId: result.sessionId,
                        ourDriverId: result.driverId,
                    },
                });

                return {
                    success: result.success,
                    webhookId: webhook.id,
                    sessionId: result.sessionId,
                    driverId: result.driverId,
                    message: result.message,
                    error: result.error,
                };
            }

            // Unknown action type
            await prisma.motiveWebhook.update({
                where: { id: webhook.id },
                data: {
                    processingStatus: 'processed',
                    processedAt: new Date(),
                },
            });

            return {
                success: true,
                webhookId: webhook.id,
                message: `Webhook action ${payload.action} logged but not processed`,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`❌ Webhook processing error: ${errorMessage}`, error);

            return {
                success: false,
                webhookId: BigInt(0),
                error: errorMessage,
            };
        }
    }

    /**
     * Handle duty status update webhook
     */
    private static async handleDutyStatusUpdate(
        webhookId: bigint,
        payload: MotiveWebhookPayload
    ): Promise<{
        success: boolean;
        sessionId?: number;
        driverId?: number;
        message?: string;
        error?: string;
    }> {
        try {
            const motiveDriverId = payload.id;
            const motiveCompanyId = payload.driver_company_id;
            const dutyStatus = payload.duty_status;

            logger.info(
                `📊 Processing duty status: ${dutyStatus} - ` +
                `driver=${motiveDriverId} (${payload.first_name} ${payload.last_name}) - ` +
                `company=${motiveCompanyId || 'none'}`
            );

            // Strategy 1: Find by motive_driver_id
            let driver = await prisma.driver.findFirst({
                where: { motiveDriverId },
                include: {
                    companies: {
                        include: {
                            company: true,
                        },
                    },
                },
            });

            // Strategy 2: If not found, try to find by phone
            if (!driver && payload.phone) {
                logger.info(`🔍 Driver ${motiveDriverId} not found, trying phone: ${payload.phone}`);
                driver = await prisma.driver.findFirst({
                    where: { phone: payload.phone },
                    include: {
                        companies: {
                            include: {
                                company: true,
                            },
                        },
                    },
                });

                // If found by phone, update their motive_driver_id
                if (driver) {
                    await prisma.driver.update({
                        where: { id: driver.id },
                        data: { motiveDriverId },
                    });
                    logger.info(`✅ Updated driver ${driver.id} with Motive ID ${motiveDriverId}`);
                }
            }

            // Strategy 3: Auto-register driver if not found
            if (!driver) {
                logger.info(
                    `🆕 Auto-registering driver: ${payload.first_name} ${payload.last_name} (${motiveDriverId})`
                );

                // Use username as phone if phone not provided
                const phone = payload.phone || `+motive${motiveDriverId}`;

                driver = await prisma.driver.create({
                    data: {
                        phone,
                        name: `${payload.first_name} ${payload.last_name}`,
                        email: payload.email,
                        motiveDriverId,
                    },
                    include: {
                        companies: {
                            include: {
                                company: true,
                            },
                        },
                    },
                });

                logger.info(`✅ Auto-registered driver ${driver.id}: ${driver.name}`);
            }

            // Find or create company assignment
            let company = null;
            if (motiveCompanyId) {
                company = await prisma.company.findUnique({
                    where: { motiveCompanyId },
                });

                if (!company) {
                    logger.warn(
                        `⚠️  Company not found for Motive ID ${motiveCompanyId} - driver operating without company assignment`
                    );
                } else {
                    // Check if driver assigned to this company
                    const assignment = await prisma.driverCompanyAssignment.findUnique({
                        where: {
                            driverId_companyId: {
                                driverId: driver.id,
                                companyId: company.id,
                            },
                        },
                    });

                    if (!assignment) {
                        // Auto-assign driver to company
                        await prisma.driverCompanyAssignment.create({
                            data: {
                                driverId: driver.id,
                                companyId: company.id,
                                role: payload.role === 'driver' ? 'driver' : 'co_passenger',
                                motiveDriverIdInCompany: motiveDriverId,
                            },
                        });
                        logger.info(
                            `✅ Auto-assigned driver ${driver.id} to company ${company.id}`
                        );
                    }
                }
            }

            // Get previous duty status from last webhook
            // ... existing code to find/create driver ...

            // Get previous duty status from last webhook
            const previousWebhook = await prisma.motiveWebhook.findFirst({
                where: {
                    motiveDriverId,
                    id: { not: webhookId },
                    dutyStatus: { not: null },
                },
                orderBy: { receivedAt: 'desc' },
                take: 1,
            });

            const previousDutyStatus = previousWebhook?.dutyStatus || null;

            logger.info(
                `📊 Duty status transition: ${previousDutyStatus || 'null'} → ${dutyStatus} for ${driver.name}`
            );

            // Import SessionService at the top of the file
            const SessionService = (await import('./SessionService')).default;

            // Handle session state machine
            const sessionTransition = await SessionService.handleDutyStatusChange(
                driver.id,
                company?.id || null,
                motiveDriverId,
                dutyStatus,
                previousDutyStatus
            );

            logger.info(
                `🔄 Session action: ${sessionTransition.action} - ` +
                `shouldBlock=${sessionTransition.shouldBlock} - ` +
                `sessionId=${sessionTransition.session?.id || 'none'}`
            );

            // Send blocking trigger to app (SSE or Push)
            const notification = await PushNotificationService.sendDutyStatusChange(
                driver.id,
                dutyStatus,
                sessionTransition.session?.id,
                company?.id || undefined
            );

            logger.info(
                `📲 Notification sent via ${notification.method}: ${notification.success ? 'success' : 'failed'}`
            );

            return {
                success: true,
                driverId: driver.id,
                sessionId: sessionTransition.session?.id,
                message: `Duty status ${dutyStatus} processed - session ${sessionTransition.action} - notification via ${notification.method}`,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error(`❌ handleDutyStatusUpdate error: ${errorMessage}`);
            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Get previous duty status for a driver
     */
    static async getPreviousDutyStatus(
        motiveDriverId: number,
        beforeWebhookId: bigint
    ): Promise<string | null> {
        const previousWebhook = await prisma.motiveWebhook.findFirst({
            where: {
                motiveDriverId,
                id: { lt: beforeWebhookId },
                dutyStatus: { not: null },
            },
            orderBy: { receivedAt: 'desc' },
            take: 1,
        });

        return previousWebhook?.dutyStatus || null;
    }
}