import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../config/database';
import logger from '../config/logger';
import FleetDashboardService from '../services/FleetDashboardService';
import FleetDriverDetailService from '../services/FleetDriverDetailService';
import FleetDriversListService from '../services/FleetDriversListService';
import FleetViolationsService from '../services/FleetViolationsService';
import LiveFleetLocationService from '../services/LiveFleetLocationService';
import type { LiveLocationsEnrichOptions } from '../services/LiveFleetLocationService';
import type { FleetManagerWithCompanies } from '../types/express';
import { ApiResponse } from '../types';
import { buildFleetMePayload } from '../utils/fleetMePayload';

const fleetManagerMeInclude = {
  companies: {
    where: { isActive: true },
    include: {
      company: { select: { id: true, name: true } as const },
    },
  },
} as const;

const patchFleetProfileBody = z
  .object({
    name: z.union([z.string().max(200), z.null()]).optional(),
    companyName: z.union([z.string().max(200), z.null()]).optional(),
    contactNumber: z.union([z.string().max(64), z.null()]).optional(),
  })
  .strict()
  .refine(
    (b) =>
      b.name !== undefined || b.companyName !== undefined || b.contactNumber !== undefined,
    { message: 'Provide at least one of name, companyName, contactNumber' }
  );

function trimOrNull(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function parseLiveLocationsQuery(req: Request): LiveLocationsEnrichOptions {
  const q = req.query;
  const truthy = (v: unknown) => v === '1' || v === 'true';
  const falsy = (v: unknown) => v === '0' || v === 'false';

  if (truthy(q.lean)) {
    return { includeDuty: false, includeSpeed: false };
  }

  return {
    includeDuty: !falsy(q.duty),
    includeSpeed: !falsy(q.speed),
  };
}

export class FleetController {
  /**
   * GET /api/v1/fleet/live-locations
   * Motive driver locations; fleet managers only (Firebase Bearer).
   * Query: lean=1 → locations only (fastest). duty=0 / speed=0 to skip one enrich step.
   */
  static async liveLocations(req: Request, res: Response) {
    try {
      const enrich = parseLiveLocationsQuery(req);
      const raw = await LiveFleetLocationService.getDriverLocationsWithDuty(enrich);
      // JSON.stringify drops `undefined`; expose a stable key when we ran speed enrichment.
      const locations =
        enrich.includeSpeed !== false
          ? raw.map((loc) => ({
              ...loc,
              speedMph: loc.speedMph ?? null,
            }))
          : raw;
      return res.json({
        success: true,
        data: { locations },
      } as ApiResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Fleet live locations error:', error);

      if (message.includes('MOTIVE_API_KEY')) {
        return res.status(503).json({
          success: false,
          error: 'Live locations unavailable (Motive API not configured)',
        } as ApiResponse);
      }

      return res.status(502).json({
        success: false,
        error: 'Failed to fetch live locations from Motive',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/fleet/drivers
   * Roster for dashboard; `id` is Motive id when known so links align with live-locations.
   */
  /**
   * GET /api/v1/fleet/violations
   * Driving sessions with block attempts or tamper (Firebase Bearer).
   */
  static async violations(req: Request, res: Response) {
    try {
      const violations = await FleetViolationsService.listBlockingSessions();
      return res.json({
        success: true,
        data: { violations },
      } as ApiResponse);
    } catch (error) {
      logger.error('Fleet violations list error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load violations',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/fleet/dashboard
   * Stats: active driver count, open sessions with blocking requested+applied,
   * tamper count for today (ET) from `driving_sessions.tampered_at`, plus merged activity.
   */
  static async dashboard(req: Request, res: Response) {
    try {
      const data = await FleetDashboardService.getPayload();
      return res.json({
        success: true,
        data,
      } as ApiResponse);
    } catch (error) {
      logger.error('Fleet dashboard error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load dashboard',
      } as ApiResponse);
    }
  }

  static async listDrivers(req: Request, res: Response) {
    try {
      const drivers = await FleetDriversListService.listAllActive();
      return res.json({
        success: true,
        data: { drivers },
      } as ApiResponse);
    } catch (error) {
      logger.error('Fleet drivers list error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load fleet drivers',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/fleet/drivers/:driverId
   * Driver row + 30-day safety stats + current/latest driving_session + push-command spikes on that session.
   */
  static async driverDetail(req: Request, res: Response) {
    const raw = req.params.driverId;
    const driverId = Number(raw);
    if (!Number.isInteger(driverId) || driverId <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid driver id',
      } as ApiResponse);
    }

    try {
      const data = await FleetDriverDetailService.getDetail(driverId);
      if (!data) {
        return res.status(404).json({
          success: false,
          error: 'Driver not found',
        } as ApiResponse);
      }
      return res.json({ success: true, data } as ApiResponse);
    } catch (error) {
      logger.error('Fleet driver detail error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to load driver detail',
      } as ApiResponse);
    }
  }

  /** PATCH /api/v1/fleet/me/profile */
  static async patchMeProfile(req: Request, res: Response) {
    const parsed = patchFleetProfileBody.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({
        success: false,
        error: first?.message ?? 'Invalid request body',
      } as ApiResponse);
    }

    const fm = req.fleetManager!;
    const b = parsed.data;
    const data: {
      name?: string | null;
      companyName?: string | null;
      contactNumber?: string | null;
    } = {};

    if (b.name !== undefined) {
      data.name = b.name === null ? null : trimOrNull(b.name);
    }
    if (b.companyName !== undefined) {
      data.companyName = b.companyName === null ? null : trimOrNull(b.companyName);
    }
    if (b.contactNumber !== undefined) {
      data.contactNumber = b.contactNumber === null ? null : trimOrNull(b.contactNumber);
    }

    try {
      await prisma.fleetManager.update({
        where: { id: fm.id },
        data,
      });

      const updated = await prisma.fleetManager.findFirst({
        where: { id: fm.id, isActive: true },
        include: fleetManagerMeInclude,
      });

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: 'Fleet manager not found',
        } as ApiResponse);
      }

      return res.json({
        success: true,
        data: buildFleetMePayload(updated as FleetManagerWithCompanies),
      } as ApiResponse);
    } catch (error) {
      logger.error('Fleet profile patch error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update profile',
      } as ApiResponse);
    }
  }
}
