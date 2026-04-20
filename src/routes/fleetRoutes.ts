import { Router, Request, Response } from 'express';
import { FleetController } from '../controllers/FleetController';
import { requireFleetManager } from '../middleware/requireFleetManager';
import { ApiResponse } from '../types';
import { buildFleetMePayload } from '../utils/fleetMePayload';

const router = Router();

/** All `/fleet/*` routes require `Authorization: Bearer <Firebase ID token>` (fleet manager). */
router.use(requireFleetManager);

/**
 * GET /api/v1/fleet/me
 */
router.get('/me', (req: Request, res: Response) => {
  const fm = req.fleetManager!;
  return res.json({
    success: true,
    data: buildFleetMePayload(fm),
  } as ApiResponse);
});

/**
 * PATCH /api/v1/fleet/me/profile — name, companyName, contactNumber (strings or null to clear).
 */
router.patch('/me/profile', FleetController.patchMeProfile);

router.get('/live-locations', FleetController.liveLocations);

router.get('/dashboard', FleetController.dashboard);

router.get('/violations', FleetController.violations);

router.get('/drivers', FleetController.listDrivers);
router.get('/drivers/:driverId', FleetController.driverDetail);

export default router;
