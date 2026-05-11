import prisma from '../config/database';
import { fleetSafetyCutoff, sessionsRelevantToWindow } from '../utils/fleetSessionWindow';
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
   * Fleet score = average of active-driver 30-day scores.
   * Driver 30-day score = average of session scores in window, where each session score is
   * max(0, 100 - 2*total_block_attempts - 5*(is_tampered ? 1 : 0)).
   * If a driver has no sessions in window, that driver contributes 100.
   */
  private static async fleetSafetyScoreLast30Days(): Promise<number> {
    const cutoff = fleetSafetyCutoff();
    const rows = await prisma.$queryRaw<Array<{ score: number | null }>>`
      WITH active_drivers AS (
        SELECT id
        FROM drivers
        WHERE is_active = true
      ),
      session_scores AS (
        SELECT
          ds.driver_id,
          GREATEST(0, 100 - 2 * ds.total_block_attempts - CASE WHEN ds.is_tampered THEN 5 ELSE 0 END) AS session_score
        FROM driving_sessions ds
        WHERE ds.started_at >= ${cutoff}
           OR ds.ended_at >= ${cutoff}
           OR ds.ended_at IS NULL
      ),
      driver_scores AS (
        SELECT
          ad.id AS driver_id,
          COALESCE(ROUND(AVG(ss.session_score)), 100)::int AS driver_score
        FROM active_drivers ad
        LEFT JOIN session_scores ss ON ss.driver_id = ad.id
        GROUP BY ad.id
      )
      SELECT ROUND(AVG(driver_score))::int AS score
      FROM driver_scores
    `;
    const score = rows[0]?.score;
    if (typeof score === 'number' && Number.isFinite(score)) {
      return score;
    }
    return 100;
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
    const merged = [...tamper, ...unlock].map((e) => ({
      ...e,
      _atMs: Date.parse(e.at),
    }));
    merged.sort((a, b) => {
      if (b._atMs !== a._atMs) return b._atMs - a._atMs;
      if (a.type === 'tamper' && b.type !== 'tamper') return -1;
      if (a.type !== 'tamper' && b.type === 'tamper') return 1;
      return 0;
    });
    return merged.slice(0, limit).map(({ _atMs: _ignored, ...e }) => e);
  }

  static async getPayload(): Promise<FleetDashboardPayload> {
    const cutoff = fleetSafetyCutoff();

    const [totalDrivers, lockedDriversCountRows, fleetSafetyScore, tamperToday, unlockActivity, tamperActivity] =
      await Promise.all([
        prisma.driver.count({ where: { isActive: true } }),
        prisma.$queryRaw<Array<{ c: bigint }>>`
          SELECT COUNT(DISTINCT driver_id)::bigint AS c
          FROM driving_sessions
          WHERE ended_at IS NULL
            AND requested_blocking_state = true
            AND applied_blocking_state = true
        `,
        FleetDashboardService.fleetSafetyScoreLast30Days(),
        FleetDashboardService.tamperAlertsTodayCount(),
        FleetDashboardService.fleetUnlockActivity(cutoff),
        FleetDashboardService.fleetTamperActivity(30),
      ]);

    const phoneLockedDrivers = Number(lockedDriversCountRows[0]?.c ?? 0);

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
