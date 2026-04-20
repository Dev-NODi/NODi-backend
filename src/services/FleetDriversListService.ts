import prisma from '../config/database';
import FleetDriverSafety30dService from './FleetDriverSafety30dService';
import LiveFleetLocationService from './LiveFleetLocationService';

export type FleetDriverListRow = {
  /** Prefer Motive id for URLs when present; else internal `drivers.id`. */
  id: string;
  motiveDriverId: number | null;
  /** Internal PK (optional for clients that need DB joins). */
  internalDriverId: number;
  name: string;
  truckId: string;
  /** 0–100: average per-session score over driving_sessions in the last 30-day window (same formula as fleet dashboard). */
  safetyScore: number;
  /** Sum of `total_block_attempts` across those same windowed sessions. */
  totalBlockAttempts: number;
  /**
   * Latest Motive duty from `motive_webhooks` (fallback when the client has no live-locations row).
   * Fleet UI merges duty from Motive live-locations when available; names always come from `drivers`.
   */
  dutyStatus: string | null;
};

function dutyUsesActiveSessionVehicle(duty: string | null): boolean {
  const d = (duty || '').toLowerCase();
  return d === 'driving' || d === 'on_duty';
}

class FleetDriversListService {
  /**
   * One query: latest non-null `duty_status` per active driver from webhook log (Motive source of truth).
   */
  private static async latestDutyStatusByDriverId(): Promise<Map<number, string>> {
    const rows = await prisma.$queryRaw<{ id: number; duty_status: string | null }[]>`
      SELECT d.id,
        (
          SELECT mw.duty_status
          FROM motive_webhooks mw
          WHERE mw.duty_status IS NOT NULL
            AND (
              mw.our_driver_id = d.id
              OR (
                d.motive_driver_id IS NOT NULL
                AND mw.motive_driver_id = d.motive_driver_id
              )
            )
          ORDER BY mw.received_at DESC
          LIMIT 1
        ) AS duty_status
      FROM drivers d
      WHERE d.is_active = true
    `;
    const map = new Map<number, string>();
    for (const row of rows) {
      if (row.duty_status) {
        map.set(row.id, row.duty_status);
      }
    }
    return map;
  }

  /**
   * All active rows in `drivers`, plus latest `driving_sessions` row per driver for `truckId`,
   * and 30-day-window `safetyScore` / `totalBlockAttempts` from `FleetDriverSafety30dService`.
   * `id` is Motive id when set so `/drivers/:id` matches live-locations links.
   */
  static async listAllActive(): Promise<FleetDriverListRow[]> {
    const [drivers, dutyByDriverId] = await Promise.all([
      prisma.driver.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          motiveDriverId: true,
          sessions: {
            orderBy: [{ startedAt: 'desc' }],
            take: 1,
            select: { vehicleId: true, totalBlockAttempts: true },
          },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      FleetDriversListService.latestDutyStatusByDriverId(),
    ]);

    const driverIds = drivers.map((d) => d.id);
    const [safetyByDriver, activeSessions, plateByMotiveDriverId] = await Promise.all([
      FleetDriverSafety30dService.mapByInternalDriverIds(driverIds),
      driverIds.length === 0
        ? Promise.resolve(
            [] as { driverId: number; vehicleId: number | null; startedAt: Date }[]
          )
        : prisma.drivingSession.findMany({
            where: { driverId: { in: driverIds }, endedAt: null },
            select: { driverId: true, vehicleId: true, startedAt: true },
            orderBy: [{ startedAt: 'desc' }],
          }),
      LiveFleetLocationService.getVehicleNumberByMotiveDriverIdMap(),
    ]);
    const activeVehicleByDriver = new Map<number, number | null>();
    for (const row of activeSessions) {
      if (!activeVehicleByDriver.has(row.driverId)) {
        activeVehicleByDriver.set(row.driverId, row.vehicleId ?? null);
      }
    }

    type Draft = FleetDriverListRow & { resolveVehicleId: number | null };
    const drafts: Draft[] = drivers.map((d) => {
      const latest = d.sessions[0];
      const latestVid = latest?.vehicleId;
      const linkId = d.motiveDriverId != null && d.motiveDriverId > 0 ? d.motiveDriverId : d.id;
      const windowStats = safetyByDriver.get(d.id) ?? {
        safetyScore: 100,
        totalBlockAttempts: 0,
      };
      const { safetyScore, totalBlockAttempts } = windowStats;
      const duty = dutyByDriverId.get(d.id) ?? null;
      const activeVid = activeVehicleByDriver.get(d.id);
      const motiveId = d.motiveDriverId != null && d.motiveDriverId > 0 ? d.motiveDriverId : null;
      const plateFromLive =
        motiveId != null ? plateByMotiveDriverId.get(motiveId) : undefined;

      let truckId = '—';
      let resolveVehicleId: number | null = null;
      if (plateFromLive?.trim()) {
        truckId = plateFromLive.trim();
      } else if (dutyUsesActiveSessionVehicle(duty) && activeVid != null && activeVid > 0) {
        truckId = String(activeVid);
        resolveVehicleId = activeVid;
      } else if (latestVid != null && latestVid > 0) {
        truckId = String(latestVid);
        resolveVehicleId = latestVid;
      }
      return {
        id: String(linkId),
        motiveDriverId: d.motiveDriverId ?? null,
        internalDriverId: d.id,
        name: d.name?.trim() || `Driver ${d.id}`,
        truckId,
        safetyScore,
        totalBlockAttempts,
        dutyStatus: duty,
        resolveVehicleId,
      };
    });

    const vehicleIdsToResolve = [
      ...new Set(
        drafts
          .map((row) => row.resolveVehicleId)
          .filter((id): id is number => id != null && id > 0)
      ),
    ];
    const numberByVehicleId =
      vehicleIdsToResolve.length > 0
        ? await LiveFleetLocationService.getVehicleDisplayNumbersByVehicleIds(vehicleIdsToResolve)
        : new Map<number, string>();

    return drafts.map(({ resolveVehicleId, ...row }) => {
      const pretty =
        resolveVehicleId != null && resolveVehicleId > 0
          ? numberByVehicleId.get(resolveVehicleId)
          : undefined;
      return {
        ...row,
        truckId: pretty?.trim() ? pretty.trim() : row.truckId,
      };
    });
  }
}

export default FleetDriversListService;
