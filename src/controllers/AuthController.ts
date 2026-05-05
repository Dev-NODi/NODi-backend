import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import logger from '../config/logger';
import AuthService from '../services/AuthService';
import { ApiResponse, AuthLoginSchema, AuthRegisterSchema } from '../types';

type DriverAuthRecord = {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  passwordHash: string | null;
};

export class AuthController {
  /**
   * POST /api/v1/auth/register
   * Register a driver account for mobile login
   */
  static async register(req: Request, res: Response) {
    try {
      const data = AuthRegisterSchema.parse(req.body);
      const email = data.email.trim().toLowerCase();

      const existingDriver = await prisma.$queryRaw<Array<{ id: number }>>`
        SELECT id
        FROM drivers
        WHERE email = ${email}
        LIMIT 1
      `;

      if (existingDriver.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'Driver with this email already exists',
        } as ApiResponse);
      }

      const driver = await prisma.$queryRaw<Array<Omit<DriverAuthRecord, 'passwordHash'>>>`
        INSERT INTO drivers (name, email, password_hash, last_seen_at, is_active, created_at, updated_at)
        VALUES (
          ${data.name.trim()},
          ${email},
          ${AuthService.hashPassword(data.password)},
          NOW(),
          true,
          NOW(),
          NOW()
        )
        RETURNING
          id,
          name,
          email,
          phone,
          is_active AS "isActive",
          created_at AS "createdAt"
      `;

      const createdDriver = driver[0];
      if (!createdDriver) {
        throw new Error('Failed to create driver auth account');
      }

      const token = AuthService.createDriverToken(createdDriver.id, email);

      logger.info(`✅ Driver auth registered: ${createdDriver.id} - ${email}`);

      return res.status(201).json({
        success: true,
        data: {
          driver: createdDriver,
          token,
        },
        message: 'Driver registered successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues,
        } as ApiResponse);
      }

      logger.error('Driver auth registration error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to register driver',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/auth/login
   * Login driver account for mobile app
   */
  static async login(req: Request, res: Response) {
    try {
      const data = AuthLoginSchema.parse(req.body);
      console.log('Login request data:', data);
      const email = data.email.trim().toLowerCase();

      const driverRows = await prisma.$queryRaw<Array<DriverAuthRecord>>`
        SELECT
          id,
          name,
          email,
          phone,
          is_active AS "isActive",
          created_at AS "createdAt",
          password_hash AS "passwordHash"
        FROM drivers
        WHERE email = ${email}
        LIMIT 1
      `;
      const driver = driverRows[0];

      if (!driver || !driver.passwordHash) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password',
        } as ApiResponse);
      }

      if (!driver.isActive) {
        return res.status(403).json({
          success: false,
          error: 'Driver account is inactive',
        } as ApiResponse);
      }

      const passwordMatches = AuthService.verifyPassword(data.password, driver.passwordHash);
      if (!passwordMatches) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password',
        } as ApiResponse);
      }

      await prisma.$executeRaw`
        UPDATE drivers
        SET last_seen_at = NOW(), updated_at = NOW()
        WHERE id = ${driver.id}
      `;

      const token = AuthService.createDriverToken(driver.id, email);

      logger.info(`✅ Driver auth login: ${driver.id} - ${email}`);

      return res.json({
        success: true,
        data: {
          driver: {
            id: driver.id,
            name: driver.name,
            email: driver.email,
            phone: driver.phone,
            isActive: driver.isActive,
            createdAt: driver.createdAt,
          },
          token,
        },
        message: 'Login successful',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues,
        } as ApiResponse);
      }

      logger.error('Driver auth login error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to login driver',
      } as ApiResponse);
    }
  }
}
