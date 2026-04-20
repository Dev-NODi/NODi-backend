import prisma from '../config/database';
import { safetyScoreFromBlockAttempts } from '../utils/safetyScoreFromBlockAttempts';
import { fleetSafetyCutoff, sessionsRelevantToWindow } from '../utils/fleetSessionWindow';

/**
 * Per-driver safety for list/detail: average of per-session scores
 * (100 − 2×`total_block_attempts`, min 50) over sessions in the 30-day relevance window.
 * No sessions in window → 100.
 */
class FleetDriverSafety30dService {
  static async averageForDriver(internalDriverId: number): Promise<number> {
    const cutoff = fleetSafetyCutoff();
    const sessions = await prisma.drivingSession.findMany({
      where: {
        driverId: internalDriverId,
        ...sessionsRelevantToWindow(cutoff),
      },
      select: { totalBlockAttempts: true },
    });
    if (sessions.length === 0) return 100;
    const sum = sessions.reduce(
      (acc, s) => acc + safetyScoreFromBlockAttempts(s.totalBlockAttempts),
      0,
    );
    return Math.round(sum / sessions.length);
  }

  /**
   * Batch for roster: `safetyScore` = average session score in window;
   * `totalBlockAttempts` = sum of `total_block_attempts` across those sessions.
   */
  static async mapByInternalDriverIds(
    internalDriverIds: number[],
  ): Promise<Map<number, { safetyScore: number; totalBlockAttempts: number }>> {
    const out = new Map<number, { safetyScore: number; totalBlockAttempts: number }>();
    for (const id of internalDriverIds) {
      out.set(id, { safetyScore: 100, totalBlockAttempts: 0 });
    }
    if (internalDriverIds.length === 0) return out;

    const cutoff = fleetSafetyCutoff();
    const rows = await prisma.drivingSession.findMany({
      where: {
        driverId: { in: internalDriverIds },
        ...sessionsRelevantToWindow(cutoff),
      },
      select: { driverId: true, totalBlockAttempts: true },
    });

    const grouped = new Map<number, number[]>();
    for (const r of rows) {
      const list = grouped.get(r.driverId) ?? [];
      list.push(r.totalBlockAttempts);
      grouped.set(r.driverId, list);
    }

    for (const id of internalDriverIds) {
      const attempts = grouped.get(id);
      if (!attempts?.length) continue;
      const sumScore = attempts.reduce(
        (a, n) => a + safetyScoreFromBlockAttempts(n),
        0,
      );
      const totalBlockAttempts = attempts.reduce((a, n) => a + n, 0);
      out.set(id, {
        safetyScore: Math.round(sumScore / attempts.length),
        totalBlockAttempts,
      });
    }
    return out;
  }
}

export default FleetDriverSafety30dService;
