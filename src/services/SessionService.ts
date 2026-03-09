import prisma from '../config/database';
import logger from '../config/logger';

export interface SessionStateTransition {
  action: 'start' | 'continue' | 'end' | 'none';
  session?: any;
  shouldBlock: boolean;
  previousDutyStatus: string | null;
  newDutyStatus: string;
}

class SessionService {
  /**
   * Determine what to do with session based on duty status change
   * 
   * Rules:
   * - OFF_DUTY → ON_DUTY/DRIVING  = Start session
   * - ON_DUTY → DRIVING           = Continue session (activate blocking)
   * - DRIVING → ON_DUTY           = Continue session (deactivate blocking)
   * - ANY → OFF_DUTY              = End session
   */
  async handleDutyStatusChange(
    driverId: number,
    companyId: number | null,
    motiveDriverId: number,
    newDutyStatus: string,
    previousDutyStatus: string | null
  ): Promise<SessionStateTransition> {
    logger.info(
      `🔄 Session state machine: ${previousDutyStatus || 'null'} → ${newDutyStatus} ` +
      `(driver=${driverId}, company=${companyId})`
    );

    // Get active session (if any)
    const activeSession = await this.getActiveSession(driverId);

    // Rule 1: OFF_DUTY → (ON_DUTY or DRIVING) = Start new session
    if (
      (!previousDutyStatus || previousDutyStatus === 'off_duty') &&
      (newDutyStatus === 'on_duty' || newDutyStatus === 'driving')
    ) {
      logger.info('📝 Rule 1: Starting new session (duty ON)');

      // End any existing active session first (shouldn't happen, but safety check)
      if (activeSession) {
        await this.endSession(activeSession.id, 'status_change_override');
      }

      const session = await this.startSession(
        driverId,
        companyId,
        motiveDriverId,
        newDutyStatus
      );

      return {
        action: 'start',
        session,
        shouldBlock: newDutyStatus === 'driving',
        previousDutyStatus,
        newDutyStatus,
      };
    }

    // Rule 2: (ON_DUTY or DRIVING) → DRIVING = Activate blocking
    if (newDutyStatus === 'driving') {
      logger.info('📝 Rule 2: Activating blocking (now driving)');

      if (!activeSession) {
        // No active session - create one
        const session = await this.startSession(
          driverId,
          companyId,
          motiveDriverId,
          newDutyStatus
        );

        return {
          action: 'start',
          session,
          shouldBlock: true,
          previousDutyStatus,
          newDutyStatus,
        };
      }

      // Update existing session to driving
      const session = await this.updateSessionStatus(
        activeSession.id,
        'driving',
        true // blocking active
      );

      return {
        action: 'continue',
        session,
        shouldBlock: true,
        previousDutyStatus,
        newDutyStatus,
      };
    }

    // Rule 3: DRIVING → ON_DUTY = Deactivate blocking (but continue session)
    if (previousDutyStatus === 'driving' && newDutyStatus === 'on_duty') {
      logger.info('📝 Rule 3: Deactivating blocking (no longer driving)');

      if (activeSession) {
        const session = await this.updateSessionStatus(
          activeSession.id,
          'on_duty',
          false // blocking inactive
        );

        return {
          action: 'continue',
          session,
          shouldBlock: false,
          previousDutyStatus,
          newDutyStatus,
        };
      }
    }

    // Rule 4: ANY → OFF_DUTY = End session
    if (newDutyStatus === 'off_duty') {
      logger.info('📝 Rule 4: Ending session (duty OFF)');

      if (activeSession) {
        await this.endSession(activeSession.id, 'duty_off');

        return {
          action: 'end',
          session: activeSession,
          shouldBlock: false,
          previousDutyStatus,
          newDutyStatus,
        };
      }

      return {
        action: 'none',
        shouldBlock: false,
        previousDutyStatus,
        newDutyStatus,
      };
    }

    // Default: Continue existing session or do nothing
    if (activeSession) {
      logger.info('📝 Default: Continuing session with same status');
      return {
        action: 'continue',
        session: activeSession,
        shouldBlock: activeSession.blockingActive,
        previousDutyStatus,
        newDutyStatus,
      };
    }

    logger.info('📝 No action needed');
    return {
      action: 'none',
      shouldBlock: false,
      previousDutyStatus,
      newDutyStatus,
    };
  }

  /**
   * Start a new session
   */
  private async startSession(
    driverId: number,
    companyId: number | null,
    motiveDriverId: number,
    dutyStatus: string
  ) {
    const sessionId = `session_${Date.now()}_${driverId}`;

    const session = await prisma.drivingSession.create({
      data: {
        sessionId,
        driverId,
        companyId: companyId || 0, // Use 0 as placeholder if no company
        motiveDriverId,
        startedAt: new Date(),
        dutyStatus,
        blockingActive: dutyStatus === 'driving',
      },
    });

    logger.info(
      `✅ Session started: ${session.id} (${sessionId}) - ` +
      `driver=${driverId} - status=${dutyStatus} - blocking=${session.blockingActive}`
    );

    return session;
  }

  /**
   * Update session status and blocking state
   */
  private async updateSessionStatus(
    sessionId: number,
    dutyStatus: string,
    blockingActive: boolean
  ) {
    const session = await prisma.drivingSession.update({
      where: { id: sessionId },
      data: {
        dutyStatus,
        blockingActive,
        updatedAt: new Date(),
      },
    });

    logger.info(
      `✅ Session updated: ${sessionId} - status=${dutyStatus} - blocking=${blockingActive}`
    );

    return session;
  }

  /**
   * End a session
   */
  async endSession(sessionId: number, reason: string) {
    const session = await prisma.drivingSession.update({
      where: { id: sessionId },
      data: {
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    const duration = session.endedAt && session.startedAt
      ? Math.floor((session.endedAt.getTime() - session.startedAt.getTime()) / 1000)
      : 0;

    logger.info(
      `✅ Session ended: ${sessionId} - reason=${reason} - ` +
      `duration=${Math.floor(duration / 60)}min - attempts=${session.totalBlockAttempts}`
    );

    return session;
  }

  /**
   * Get active session for driver
   */
  async getActiveSession(driverId: number) {
    return await prisma.drivingSession.findFirst({
      where: {
        driverId,
        endedAt: null,
      },
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  /**
   * Get session by ID
   */
  async getSessionById(sessionId: number) {
    return await prisma.drivingSession.findUnique({
      where: { id: sessionId },
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
  }

  /**
   * Get all active sessions
   */
  async getAllActiveSessions() {
    return await prisma.drivingSession.findMany({
      where: {
        endedAt: null,
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
      orderBy: {
        startedAt: 'desc',
      },
    });
  }

  /**
   * Get sessions for a driver
   */
  async getDriverSessions(driverId: number, limit: number = 50) {
    return await prisma.drivingSession.findMany({
      where: { driverId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: {
        company: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  /**
   * Update session blocking state from heartbeat
   */
  async updateBlockingState(
    sessionId: number,
    isBlockingActive: boolean
  ) {
    return await prisma.drivingSession.update({
      where: { id: sessionId },
      data: {
        blockingActive: isBlockingActive,
        updatedAt: new Date(),
      },
    });
  }
}

export default new SessionService();