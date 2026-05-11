import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { getFirebaseAdmin, isFirebaseInitialized } from '../config/firebase';
import logger from '../config/logger';
import { Prisma } from '../generated/prisma/client';
import { ApiResponse } from '../types';

/** DB missing columns Prisma expects (migrations not applied). */
function isFleetManagerSchemaMismatch(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2022') {
    return true;
  }
  const msg = err instanceof Error ? err.message : '';
  return msg.includes('does not exist in the current database');
}

/**
 * Verifies Firebase ID token and loads an active FleetManager with company assignments.
 */
export async function requireFleetManager(req: Request, res: Response, next: NextFunction) {
  if (!isFirebaseInitialized()) {
    return res.status(503).json({
      success: false,
      error: 'Authentication is not configured (Firebase)',
    } as ApiResponse);
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Missing Authorization header (expected Bearer token)',
    } as ApiResponse);
  }

  const idToken = authHeader.slice(7).trim();
  if (!idToken) {
    return res.status(401).json({
      success: false,
      error: 'Empty bearer token',
    } as ApiResponse);
  }

  let decoded: { uid: string };
  try {
    decoded = await getFirebaseAdmin().auth().verifyIdToken(idToken);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.warn(`Fleet manager Firebase verify failed: ${message}`);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
    } as ApiResponse);
  }

  try {
    const fleetManager = await prisma.fleetManager.findFirst({
      where: { firebaseUid: decoded.uid, isActive: true },
      include: {
        companies: {
          where: { isActive: true },
          include: {
            company: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!fleetManager) {
      return res.status(403).json({
        success: false,
        error: 'No fleet manager account for this user',
      } as ApiResponse);
    }

    req.fleetManager = fleetManager;
    next();
  } catch (err) {
    if (isFleetManagerSchemaMismatch(err)) {
      logger.error('Fleet manager load failed (database schema):', err);
      return res.status(503).json({
        success: false,
        error:
          'Database schema is out of sync with the API (missing column or table). Apply Prisma migrations on this database.',
      } as ApiResponse);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error(`Fleet manager load failed: ${message}`);
    return res.status(500).json({
      success: false,
      error: 'Could not load fleet manager profile',
    } as ApiResponse);
  }
}
