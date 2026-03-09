import { Request, Response } from 'express';
import SessionService from '../services/SessionService';
import logger from '../config/logger';
import { ApiResponse } from '../types';

export class SessionController {
  /**
   * GET /api/v1/sessions/active
   * Get all active sessions
   */
  static async getActiveSessions(req: Request, res: Response) {
    try {
      const sessions = await SessionService.getAllActiveSessions();

      res.json({
        success: true,
        data: sessions,
      } as ApiResponse);
    } catch (error) {
      logger.error('Get active sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch active sessions',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/sessions/:id
   * Get session by ID
   */
  static async getSessionById(req: Request, res: Response) {
    try {
      const sessionId = parseInt(req.params.id as string);

      if (isNaN(sessionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid session ID',
        } as ApiResponse);
      }

      const session = await SessionService.getSessionById(sessionId);

      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found',
        } as ApiResponse);
      }

      res.json({
        success: true,
        data: session,
      } as ApiResponse);
    } catch (error) {
      logger.error('Get session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch session',
      } as ApiResponse);
    }
  }

  /**
   * GET /api/v1/sessions/driver/:driverId
   * Get sessions for a driver
   */
  static async getDriverSessions(req: Request, res: Response) {
    try {
      const driverId = parseInt(req.params.driverId as string);
      const limit = parseInt(req.query.limit as string) || 50;

      if (isNaN(driverId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid driver ID',
        } as ApiResponse);
      }

      const sessions = await SessionService.getDriverSessions(driverId, limit);

      res.json({
        success: true,
        data: sessions,
      } as ApiResponse);
    } catch (error) {
      logger.error('Get driver sessions error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch driver sessions',
      } as ApiResponse);
    }
  }

  /**
   * POST /api/v1/sessions/:id/end
   * Manually end a session (admin override)
   */
  static async endSession(req: Request, res: Response) {
    try {
      const sessionId = parseInt(req.params.id as string);
      const { reason } = req.body;

      if (isNaN(sessionId)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid session ID',
        } as ApiResponse);
      }

      const session = await SessionService.endSession(
        sessionId,
        reason || 'admin_override'
      );

      logger.info(`✅ Session ${sessionId} ended manually`);

      res.json({
        success: true,
        data: session,
        message: 'Session ended successfully',
      } as ApiResponse);
    } catch (error) {
      logger.error('End session error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to end session',
      } as ApiResponse);
    }
  }
}