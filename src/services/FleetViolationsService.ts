import prisma from '../config/database';
import { Prisma } from '../generated/prisma/client';
import LiveFleetLocationService from './LiveFleetLocationService';

export type FleetViolationSessionRow = {
  id: string;
  sessionPublicId: string;
  /** ISO 8601 UTC — session start. */
  startedAtUtc: string;
  /** ISO 8601 UTC — session end, or null if still open. */
  endedAtUtc: string | null;
  driverId: number;
  driverName: string;
  motiveDriverId: number;
  totalBlockAttempts: number;
  dutyStatus: string;
  vehicleId: number | null;
  /**
   * Motive `vehicle.number`: from live driver-locations when the driver appears there; else from
   * `GET /v1/vehicle_locations/:vehicleId` using this session’s `vehicleId` (same Motive API as speed).
   */
  vehicleNumber: string | null;
  deviceId: string | null;
  blockingActive: boolean;
  blockingRequested: boolean | null;
  blockingApplied: boolean | null;
  lastAckReason: string | null;
  isTampered: boolean;
  tamperedReason: string | null;
  /** When tamper was flagged (ISO UTC), from `tampered_at`. */
  tamperedAtUtc: string | null;
  /** Short text derived from `blocked_apps` JSON when present. */
  blockedAppsSummary: string | null;
  /** Exact blocked unlock attempt instants (ISO UTC) used by driver detail red spikes. */
  blockedAttemptAtUtc: string[];
};

function blockedTimestampsJson(
  fromColumn: unknown | null | undefined,
  blockedApps: unknown | null | undefined,
): unknown {
  if (fromColumn != null) return fromColumn;
  if (blockedApps && typeof blockedApps === 'object' && !Array.isArray(blockedApps)) {
    const o = blockedApps as Record<string, unknown>;
    if ('blocked_attempt_timestamps' in o) return o.blocked_attempt_timestamps;
  }
  return null;
}

async function loadBlockedAttemptTimestampsBySessionId(
  sessionIds: number[],
): Promise<Map<number, unknown>> {
  const map = new Map<number, unknown>();
  const unique = [...new Set(sessionIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (unique.length === 0) return map;

  const rows = await prisma.$queryRaw<Array<{ id: number; blocked_attempt_timestamps: unknown }>>`
    SELECT id, blocked_attempt_timestamps
    FROM driving_sessions
    WHERE id IN (${Prisma.join(unique)})
  `;

  for (const r of rows) {
    map.set(r.id, r.blocked_attempt_timestamps);
  }
  return map;
}

function parseBlockedAttemptTimestamps(raw: unknown): number[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => {
        if (typeof x === 'number' && Number.isFinite(x)) return x;
        if (typeof x === 'string') {
          const n = Number(x);
          return Number.isFinite(n) ? n : Number.NaN;
        }
        return Number.NaN;
      })
      .filter((n) => Number.isFinite(n));
  }
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    if ('blocked_attempt_timestamps' in o) {
      return parseBlockedAttemptTimestamps(o.blocked_attempt_timestamps);
    }
    if ('timestamps' in o) {
      return parseBlockedAttemptTimestamps(o.timestamps);
    }
  }
  return [];
}

function instantFromBlockedUnix(unix: number): Date {
  const ms = unix > 1e12 ? unix : unix * 1000;
  return new Date(ms);
}

function collectBlockedAttemptIsosInSessionWindow(
  startedAt: Date,
  endedAt: Date | null,
  blockedJson: unknown,
  now: Date,
): string[] {
  const startMs = startedAt.getTime();
  const endMs = (endedAt ?? now).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

  return parseBlockedAttemptTimestamps(blockedJson)
    .map((unix) => instantFromBlockedUnix(unix))
    .filter((d) => {
      const t = d.getTime();
      return Number.isFinite(t) && t >= startMs && t <= endMs;
    })
    .sort((a, b) => a.getTime() - b.getTime())
    .map((d) => d.toISOString());
}

function summarizeBlockedApps(raw: unknown): string | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const parts = raw.map((x) =>
      typeof x === 'string' ? x : typeof x === 'object' && x && 'name' in (x as object) ? String((x as { name: unknown }).name) : JSON.stringify(x)
    );
    const s = parts.join(', ');
    return s.length > 240 ? `${s.slice(0, 237)}…` : s;
  }
  if (typeof raw === 'object') {
    const s = JSON.stringify(raw);
    return s.length > 240 ? `${s.slice(0, 237)}…` : s;
  }
  return String(raw).slice(0, 240);
}

class FleetViolationsService {
  /**
   * Sessions with app-open / block attempts or tamper flags (any company), newest first.
   */
  static async listBlockingSessions(limit = 200): Promise<FleetViolationSessionRow[]> {
    const [rows, vehicleByMotiveDriverId] = await Promise.all([
      prisma.drivingSession.findMany({
        where: {
          OR: [{ totalBlockAttempts: { gt: 0 } }, { isTampered: true }],
        },
        select: {
          id: true,
          sessionId: true,
          startedAt: true,
          endedAt: true,
          motiveDriverId: true,
          driverId: true,
          totalBlockAttempts: true,
          dutyStatus: true,
          vehicleId: true,
          deviceId: true,
          blockingActive: true,
          requestedBlockingState: true,
          appliedBlockingState: true,
          lastAckReason: true,
          blockedApps: true,
          isTampered: true,
          tamperedReason: true,
          tamperedAt: true,
          driver: { select: { name: true } },
        },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      LiveFleetLocationService.getVehicleNumberByMotiveDriverIdMap(),
    ]);
    const blockedTimestampsBySessionId = await loadBlockedAttemptTimestampsBySessionId(
      rows.map((r) => r.id),
    );
    const now = new Date();

    const vehicleIdsForNumberFallback = new Set<number>();
    for (const r of rows) {
      const fromLive =
        r.motiveDriverId > 0 ? vehicleByMotiveDriverId.get(r.motiveDriverId) : undefined;
      if (fromLive?.trim()) continue;
      const vid = r.vehicleId;
      if (vid != null && vid > 0) vehicleIdsForNumberFallback.add(vid);
    }
    const numberByVehicleId = await LiveFleetLocationService.getVehicleDisplayNumbersByVehicleIds([
      ...vehicleIdsForNumberFallback,
    ]);

    return rows.map((r) => {
      let vehicleNumber: string | null = null;
      if (r.motiveDriverId > 0) {
        const live = vehicleByMotiveDriverId.get(r.motiveDriverId);
        if (live?.trim()) vehicleNumber = live.trim();
      }
      if (!vehicleNumber && r.vehicleId != null && r.vehicleId > 0) {
        const fromVehicle = numberByVehicleId.get(r.vehicleId);
        if (fromVehicle?.trim()) vehicleNumber = fromVehicle.trim();
      }
      const blockedAttemptAtUtc = collectBlockedAttemptIsosInSessionWindow(
        r.startedAt,
        r.endedAt,
        blockedTimestampsJson(blockedTimestampsBySessionId.get(r.id), r.blockedApps),
        now,
      );
      return {
        id: String(r.id),
        sessionPublicId: r.sessionId,
        startedAtUtc: r.startedAt.toISOString(),
        endedAtUtc: r.endedAt?.toISOString() ?? null,
        driverId: r.driverId,
        driverName: r.driver.name?.trim() || `Driver ${r.driverId}`,
        motiveDriverId: r.motiveDriverId,
        totalBlockAttempts: r.totalBlockAttempts,
        dutyStatus: r.dutyStatus,
        vehicleId: r.vehicleId,
        vehicleNumber,
        deviceId: r.deviceId,
        blockingActive: r.blockingActive,
        blockingRequested: r.requestedBlockingState,
        blockingApplied: r.appliedBlockingState,
        lastAckReason: r.lastAckReason,
        isTampered: r.isTampered === true,
        tamperedReason: r.tamperedReason,
        tamperedAtUtc: r.tamperedAt ? r.tamperedAt.toISOString() : null,
        blockedAppsSummary: summarizeBlockedApps(r.blockedApps),
        blockedAttemptAtUtc,
      };
    });
  }
}

export default FleetViolationsService;
