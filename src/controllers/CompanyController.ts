import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import logger from '../config/logger';
import { CreateCompanySchema, ApiResponse } from '../types';

export class CompanyController {
  /**
   * POST /api/v1/companies
   * Create a new company
   */
  static async create(req: Request, res: Response) {
    try {
      const data = CreateCompanySchema.parse(req.body);

      // Check if motive company ID already exists
      if (data.motiveCompanyId) {
        const existing = await prisma.company.findUnique({
          where: { motiveCompanyId: data.motiveCompanyId },
        });

        if (existing) {
          return res.status(400).json({
            success: false,
            error: 'Company with this Motive ID already exists',
          } as ApiResponse);
        }
      }

      const company = await prisma.company.create({
        data: {
          name: data.name,
          motiveCompanyId: data.motiveCompanyId,
        },
      });

      logger.info(`✅ Company created: ${company.id} - ${company.name}`);

      res.status(201).json({
        success: true,
        data: company,
        message: 'Company created successfully',
      } as ApiResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          data: error.issues, // changed from error.errors to error.issues to match Zod's structure
        } as ApiResponse);
      }

      logger.error('Company creation error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create company',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/companies/:id
   * Get company by ID
   */
  static async getById(req: Request, res: Response) {
    try {
      const id = parseInt(req.params.id as string);

      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid company ID',
        } as ApiResponse);
      }

      const company = await prisma.company.findUnique({
        where: { id },
        include: {
          drivers: {
            include: {
              driver: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              drivers: true,
              sessions: true,
            },
          },
        },
      });

      if (!company) {
        return res.status(404).json({
          success: false,
          error: 'Company not found',
        } as ApiResponse);
      }

      res.json({
        success: true,
        data: company,
      } as ApiResponse);
    } catch (error) {
      logger.error('Company fetch error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch company',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/companies
   * List all companies
   */
  static async list(req: Request, res: Response) {
    try {
      const companies = await prisma.company.findMany({
        where: { isActive: true },
        include: {
          _count: {
            select: {
              drivers: true,
              sessions: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.json({
        success: true,
        data: companies,
      } as ApiResponse);
    } catch (error) {
      logger.error('Companies list error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch companies',
      } as ApiResponse);
    }
  }
}
