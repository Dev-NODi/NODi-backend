import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import logger from '../config/logger';
import { RegisterDriverSchema, AssignDriverSchema, ApiResponse } from '../types';

export class DriverController {
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
              phone: true,
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