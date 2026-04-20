import prisma from '../config/database';
import { fleetSafetyCutoff, sessionsRelevantToWindow } from '../utils/fleetSessionWindow';
import { safetyScoreFromBlockAttempts } from '../utils/safetyScoreFromBlockAttempts';
import { tamperMessageFromReason } from '../utils/tamperMessageFromReason';

const FLEET_ACTIVITY_LIMIT = 40;

export type FleetDashboardActivityItem = {
  id: string;
  at: string;
  vehicleLabel: string;
  type: 'phone_unlock' | 'tamper';
  message: string;
};

export type FleetDashboardPayload = {
  stats: {
    /** Same field name as legacy dashboard API — UI label is "Total drivers". */
    activeVehicles: number;
    /** Open sessions with blocking requested and acknowledged (`requested_blocking_state` + `applied_blocking_state`), matching live-map "Phone Locked" when both are true. */
    currentlyLocked: number;
    bypassMode: number;
    tamperAlertsToday: number;
  };
  safety: { score: number; maxScore: number };
  activity: FleetDashboardActivityItem[];
};

class FleetDashboardService {
  /**
   * Average of per-session scores (100 − 2×`total_block_attempts`, min 50) over
   * driving sessions that fall in the 30-day relevance window above.
   * If none match → 100.
   */
  private static async fleetSafetyScoreLast30Days(): Promise<number> {
    const cutoff = fleetSafetyCutoff();
    const sessions = await prisma.drivingSession.findMany({
      where: sessionsRelevantToWindow(cutoff),
      select: { totalBlockAttempts: true },
    });
    if (sessions.length === 0) return 100;
    const sum = sessions.reduce(
      (acc, s) => acc + safetyScoreFromBlockAttempts(s.totalBlockAttempts),
      0
    );
    return Math.round(sum / sessions.length);
  }

  /**
   * Count of sessions flagged tampered today (calendar day US Eastern).
   */
  private static async tamperAlertsTodayCount(): Promise<number> {
    const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
      SELECT COUNT(*)::bigint AS c
      FROM driving_sessions
      WHERE is_tampered = true
        AND tampered_at IS NOT NULL
        AND tampered_at >= (
          date_trunc('day', (now() AT TIME ZONE 'America/New_York'))
          AT TIME ZONE 'America/New_York'
        )
        AND tampered_at < (
          date_trunc('day', (now() AT TIME ZONE 'America/New_York'))
          AT TIME ZONE 'America/New_York'
        ) + interval '1 day'
    `;
    return Number(rows[0]?.c ?? 0);
  }

  /**
   * Recent sessions with at least one phone unlock attempt (`total_block_attempts` > 0),
   * same 30-day relevance window, newest `updated_at` first.
   */
  private static async fleetUnlockActivity(cutoff: Date): Promise<FleetDashboardActivityItem[]> {
    const rows = await prisma.drivingSession.findMany({
      where: {
        totalBlockAttempts: { gt: 0 },
        ...sessionsRelevantToWindow(cutoff),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: FLEET_ACTIVITY_LIMIT,
      select: {
        id: true,
        updatedAt: true,
        totalBlockAttempts: true,
        driverId: true,
        driver: { select: { name: true } },
      },
    });

    return rows.map((r) => {
      const name = r.driver.name?.trim() || `Driver ${r.driverId}`;
      const n = r.totalBlockAttempts;
      const message =
        n === 1 ? 'Tried to unlock phone.' : `Tried to unlock phone (${n} attempts).`;
      return {
        id: String(r.id),
        at: r.updatedAt.toISOString(),
        vehicleLabel: name,
        type: 'phone_unlock' as const,
        message,
      };
    });
  }

  /** Tamper events from `tampered_at` / `tampered_reason` (newest first). */
  private static async fleetTamperActivity(limit: number): Promise<FleetDashboardActivityItem[]> {
    const rows = await prisma.drivingSession.findMany({
      where: { isTampered: true, tamperedAt: { not: null } },
      orderBy: [{ tamperedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        tamperedAt: true,
        tamperedReason: true,
        driverId: true,
        driver: { select: { name: true } },
      },
    });

    return rows.map((r) => ({
      id: `tamper-${r.id}`,
      at: r.tamperedAt!.toISOString(),
      vehicleLabel: r.driver.name?.trim() || `Driver ${r.driverId}`,
      type: 'tamper' as const,
      message: tamperMessageFromReason(r.tamperedReason),
    }));
  }

  private static mergeActivity(
    tamper: FleetDashboardActivityItem[],
    unlock: FleetDashboardActivityItem[],
    limit: number
  ): FleetDashboardActivityItem[] {
    const merged = [...tamper, ...unlock];
    merged.sort((a, b) => {
      const ta = new Date(a.at).getTime();
      const tb = new Date(b.at).getTime();
      if (tb !== ta) return tb - ta;
      if (a.type === 'tamper' && b.type !== 'tamper') return -1;
      if (a.type !== 'tamper' && b.type === 'tamper') return 1;
      return 0;
    });
    return merged.slice(0, limit);
  }

  static async getPayload(): Promise<FleetDashboardPayload> {
    const cutoff = fleetSafetyCutoff();

    const [totalDrivers, lockedSessionRows, fleetSafetyScore, tamperToday, unlockActivity, tamperActivity] =
      await Promise.all([
        prisma.driver.count({ where: { isActive: true } }),
        prisma.drivingSession.findMany({
          where: {
            endedAt: null,
            requestedBlockingState: true,
            appliedBlockingState: true,
          },
          select: { driverId: true },
        }),
        FleetDashboardService.fleetSafetyScoreLast30Days(),
        FleetDashboardService.tamperAlertsTodayCount(),
        FleetDashboardService.fleetUnlockActivity(cutoff),
        FleetDashboardService.fleetTamperActivity(30),
      ]);

    const phoneLockedDrivers = new Set(lockedSessionRows.map((r) => r.driverId)).size;

    const activity = FleetDashboardService.mergeActivity(
      tamperActivity,
      unlockActivity,
      FLEET_ACTIVITY_LIMIT
    );

    return {
      stats: {
        activeVehicles: totalDrivers,
        currentlyLocked: phoneLockedDrivers,
        bypassMode: 0,
        tamperAlertsToday: tamperToday,
      },
      safety: { score: fleetSafetyScore, maxScore: 100 },
      activity,
    };
  }
}

export default FleetDashboardService;
