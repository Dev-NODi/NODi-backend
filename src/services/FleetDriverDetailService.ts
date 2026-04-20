import prisma from '../config/database';
import { Prisma } from '../generated/prisma/client';
import { fleetSafetyCutoff, sessionsRelevantToWindow } from '../utils/fleetSessionWindow';
import { tamperMessageFromReason } from '../utils/tamperMessageFromReason';
import FleetDriverSafety30dService from './FleetDriverSafety30dService';
import LiveFleetLocationService from './LiveFleetLocationService';

/** Driver detail only: subtract from rolling 30-day average score (same floor as per-session scores). */
const TAMPER_SAFETY_PENALTY_PER_SESSION = 5;

function safetyScoreWithTamperPenalty(baseScore: number, tamperSessionCount: number): number {
  const n = Math.max(0, Math.floor(tamperSessionCount));
  return Math.max(50, Math.round(baseScore - TAMPER_SAFETY_PENALTY_PER_SESSION * n));
}

export type FleetDriverDistractionAttempt = {
  /** Minutes after session `startedAt` (for timeline bars). */
  offsetMinutes: number;
  /** When the device/server recorded the event (ISO 8601). */
  at: string;
  /** Human-readable label (blocked unlock or tamper summary). */
  label: string | null;
  commandId: string;
  /** Distinct spike styling in the fleet session timeline when `tamper`. */
  kind?: 'phone_unlock' | 'tamper';
};

export type FleetDriverSessionDetail = {
  id: number;
  sessionId: string;
  companyId: number;
  motiveDriverId: number;
  startedAt: string;
  endedAt: string | null;
  dutyStatus: string;
  totalBlockAttempts: number;
  /** ISO UTC from `blocked_attempt_timestamps` (device-reported app-open attempts). */
  blockedAttemptAtUtc: string[];
  vehicleId: number | null;
  blockingActive: boolean;
  requestedBlockingState: boolean | null;
  appliedBlockingState: boolean | null;
};

/** One row per `driving_sessions` for equal-width session bars in the fleet UI. */
export type FleetDriverSessionTimelineRow = {
  id: number;
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  /** Minutes from start to end (or now if ongoing), at least 1. */
  durationMinutes: number;
  totalBlockAttempts: number;
  /** 0–1 along the trip for each timeline point (blocked unlock and/or tamper in window). */
  attemptPositions: number[];
  distractionAttempts: FleetDriverDistractionAttempt[];
  /** Same instants as device `blocked_attempt_timestamps`, as ISO UTC (subset in session window). */
  blockedAttemptAtUtc: string[];
};

export type FleetDriverDetailPayload = {
  id: string;
  name: string;
  motiveDriverId: number | null;
  /** Motive-style vehicle id from session when present; UI can label as truck. */
  truckId: string;
  /**
   * 0–100: 30-day average session score (block attempts), then minus 5 per tampered session
   * in that window; minimum 50.
   */
  safetyScore: number;
  /** `HH:mm` in UTC (same instant as `tripStartedAt` ISO). */
  tripStart: string;
  /** `HH:mm` in UTC; for an active session uses current time (trip still open). */
  tripEnd: string;
  tripStartedAt: string;
  tripEndedAt: string | null;
  /** Trip length in minutes (>= 1) for timeline math. */
  tripDurationMinutes: number;
  /** Single safe segment covering the trip window (UI bar fallback). */
  segments: { startMin: number; endMin: number; safe: boolean }[];
  /** Blocked phone-unlock instants on the latest session (same source as session timelines). */
  spikes: { atMin: number; label?: string }[];
  session: FleetDriverSessionDetail | null;
  /** Sum of `total_block_attempts` across sessions in that same 30-day window. */
  totalBlockAttempts: number;
  /** Device-reported blocked unlock attempts on the latest session (not push commands). */
  distractionAttempts: FleetDriverDistractionAttempt[];
  /** Recent sessions (newest first) for per-session timeline strips. */
  sessionTimelines: FleetDriverSessionTimelineRow[];
};

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Wall-clock `HH:mm` in UTC for stable API output (document in Swagger). */
function formatUtcHHmm(d: Date): string {
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

function minutesBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  const m = Math.floor(ms / 60_000);
  return Math.max(1, m);
}

/**
 * Column `blocked_attempt_timestamps` is read via raw SQL (not in Prisma schema).
 * Fallback: nested under `blocked_apps` when the column is null.
 */
function blockedTimestampsJson(
  fromColumn: unknown | null | undefined,
  blockedApps: unknown | null | undefined,
): unknown {
  if (fromColumn != null) return fromColumn;
  const apps = blockedApps;
  if (apps && typeof apps === 'object' && !Array.isArray(apps)) {
    const o = apps as Record<string, unknown>;
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

/** JSON may be a bare array of numbers or a wrapper object from some writers. */
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

/** Values are Unix seconds with optional fraction; treat very large numbers as ms. */
function instantFromBlockedUnix(unix: number): Date {
  const ms = unix > 1e12 ? unix : unix * 1000;
  return new Date(ms);
}

/**
 * Distraction timeline: device `blocked_attempt_timestamps` plus server/session tamper
 * (`is_tampered` + `tampered_at` in the trip window). Push command acks stay excluded.
 */
function collectSessionDistractions(
  session: {
    startedAt: Date;
    endedAt: Date | null;
    isTampered?: boolean | null;
    tamperedAt?: Date | null;
    tamperedReason?: string | null;
  },
  blockedJson: unknown,
  now: Date,
): {
  distractionAttempts: FleetDriverDistractionAttempt[];
  spikes: { atMin: number; label?: string }[];
  attemptPositions: number[];
  blockedAttemptAtUtc: string[];
} {
  const startedAt = session.startedAt;
  const endedAt = session.endedAt ?? now;
  const startMs = startedAt.getTime();
  const endMs = endedAt.getTime();
  const durationMs = Math.max(60_000, endMs - startMs);

  const positionInSession = (at: Date): number => {
    const p = (at.getTime() - startMs) / durationMs;
    return Math.min(1, Math.max(0, p));
  };

  const blockedUnixList = parseBlockedAttemptTimestamps(blockedJson);
  const timelineAttempts: FleetDriverDistractionAttempt[] = [];
  const blockedAtUtc: string[] = [];

  for (let i = 0; i < blockedUnixList.length; i++) {
    const unix = blockedUnixList[i]!;
    const at = instantFromBlockedUnix(unix);
    const t = at.getTime();
    if (t < startMs || t > endMs) continue;
    const offsetMinutes = Math.floor((t - startMs) / 60_000);
    const iso = at.toISOString();
    blockedAtUtc.push(iso);
    timelineAttempts.push({
      offsetMinutes,
      at: iso,
      label: 'Phone unlock blocked',
      commandId: `blocked:${i}`,
      kind: 'phone_unlock',
    });
  }
  blockedAtUtc.sort();

  if (session.isTampered === true && session.tamperedAt) {
    const tMs = session.tamperedAt.getTime();
    if (tMs >= startMs && tMs <= endMs) {
      const offsetMinutes = Math.floor((tMs - startMs) / 60_000);
      const iso = session.tamperedAt.toISOString();
      timelineAttempts.push({
        offsetMinutes,
        at: iso,
        label: tamperMessageFromReason(session.tamperedReason ?? null),
        commandId: 'tamper:0',
        kind: 'tamper',
      });
    }
  }

  timelineAttempts.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const distractionAttempts: FleetDriverDistractionAttempt[] = timelineAttempts;
  const spikes: { atMin: number; label?: string }[] = timelineAttempts.map((b) => ({
    atMin: b.offsetMinutes,
    label: b.kind === 'tamper' ? 'Tamper' : 'Phone touch',
  }));

  const attemptPositions: number[] = distractionAttempts.map((a) =>
    positionInSession(new Date(a.at)),
  );

  return { distractionAttempts, spikes, attemptPositions, blockedAttemptAtUtc: blockedAtUtc };
}

const RECENT_SESSION_TIMELINE_LIMIT = 35;

class FleetDriverDetailService {
  /**
   * `drivers` row + current/latest `driving_sessions` + device-reported blocked unlock times.
   * No company filter — any active driver; sessions matched by internal or Motive id.
   */
  static async getDetail(driverId: number): Promise<FleetDriverDetailPayload | null> {
    const driver = await prisma.driver.findFirst({
      where: {
        isActive: true,
        OR: [{ id: driverId }, { motiveDriverId: driverId }],
      },
      select: {
        id: true,
        name: true,
        motiveDriverId: true,
      },
    });

    if (!driver) return null;

    const internalDriverId = driver.id;
    /** Path param may be internal id or Motive id — match sessions either way. */
    const sessionScope = {
      OR: [{ driverId: internalDriverId }, { motiveDriverId: driverId }],
    };

    const cutoff = fleetSafetyCutoff();
    const [windowStatsMap, recentSessions, tamperSessionsInWindow] = await Promise.all([
      FleetDriverSafety30dService.mapByInternalDriverIds([internalDriverId]),
      prisma.drivingSession.findMany({
        where: sessionScope,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        take: RECENT_SESSION_TIMELINE_LIMIT,
      }),
      prisma.drivingSession.count({
        where: {
          driverId: internalDriverId,
          isTampered: true,
          ...sessionsRelevantToWindow(cutoff),
        },
      }),
    ]);

    const windowStats =
      windowStatsMap.get(internalDriverId) ?? {
        safetyScore: 100,
        totalBlockAttempts: 0,
      };
    const safetyScore = safetyScoreWithTamperPenalty(
      windowStats.safetyScore,
      tamperSessionsInWindow,
    );

    const session =
      (await prisma.drivingSession.findFirst({
        where: { ...sessionScope, endedAt: null },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      })) ||
      (await prisma.drivingSession.findFirst({
        where: sessionScope,
        orderBy: [{ endedAt: 'desc' }, { startedAt: 'desc' }, { id: 'desc' }],
      }));

    const now = new Date();
    const name = driver.name?.trim() || `Driver ${driver.id}`;

    const publicId =
      driver.motiveDriverId != null && driver.motiveDriverId > 0
        ? String(driver.motiveDriverId)
        : String(driver.id);

    if (!session) {
      return {
        id: publicId,
        name,
        motiveDriverId: driver.motiveDriverId ?? null,
        truckId: '—',
        safetyScore,
        tripStart: '—',
        tripEnd: '—',
        tripStartedAt: now.toISOString(),
        tripEndedAt: null,
        tripDurationMinutes: 1,
        segments: [{ startMin: 0, endMin: 1, safe: true }],
        spikes: [],
        session: null,
        totalBlockAttempts: windowStats.totalBlockAttempts,
        distractionAttempts: [],
        sessionTimelines: [],
      };
    }

    const sessionIdsForCommands = new Set(recentSessions.map((s) => s.id));
    sessionIdsForCommands.add(session.id);

    const blockedTimestampsBySessionId = await loadBlockedAttemptTimestampsBySessionId([
      ...sessionIdsForCommands,
    ]);

    const primaryBuilt = collectSessionDistractions(
      session,
      blockedTimestampsJson(
        blockedTimestampsBySessionId.get(session.id),
        session.blockedApps,
      ),
      now,
    );
    const { distractionAttempts, spikes } = primaryBuilt;

    const startedAt = session.startedAt;
    const endedAt = session.endedAt ?? now;
    const tripDurationMinutes = minutesBetween(startedAt, endedAt);

    const sessionTimelines: FleetDriverSessionTimelineRow[] = recentSessions.map((s) => {
      const built =
        s.id === session.id
          ? primaryBuilt
          : collectSessionDistractions(
              s,
              blockedTimestampsJson(blockedTimestampsBySessionId.get(s.id), s.blockedApps),
              now,
            );
      const ended = s.endedAt ?? now;
      const durationMinutes = minutesBetween(s.startedAt, ended);
      return {
        id: s.id,
        sessionId: s.sessionId,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        durationMinutes,
        totalBlockAttempts: s.totalBlockAttempts,
        attemptPositions: built.attemptPositions,
        distractionAttempts: built.distractionAttempts,
        blockedAttemptAtUtc: built.blockedAttemptAtUtc,
      };
    });

    const sessionPayload: FleetDriverSessionDetail = {
      id: session.id,
      sessionId: session.sessionId,
      companyId: session.companyId,
      motiveDriverId: session.motiveDriverId,
      startedAt: startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      dutyStatus: session.dutyStatus,
      totalBlockAttempts: session.totalBlockAttempts,
      blockedAttemptAtUtc: primaryBuilt.blockedAttemptAtUtc,
      vehicleId: session.vehicleId ?? null,
      blockingActive: session.blockingActive,
      requestedBlockingState: session.requestedBlockingState ?? null,
      appliedBlockingState: session.appliedBlockingState ?? null,
    };

    let truckId = '—';
    if (session.vehicleId != null && session.vehicleId > 0) {
      const label = await LiveFleetLocationService.getVehicleDisplayNumberByVehicleId(
        session.vehicleId
      );
      truckId = label?.trim() ? label.trim() : String(session.vehicleId);
    }

    return {
      id: publicId,
      name,
      motiveDriverId: driver.motiveDriverId ?? null,
      truckId,
      safetyScore,
      tripStart: formatUtcHHmm(startedAt),
      tripEnd: formatUtcHHmm(endedAt),
      tripStartedAt: startedAt.toISOString(),
      tripEndedAt: session.endedAt ? session.endedAt.toISOString() : null,
      tripDurationMinutes,
      segments: [{ startMin: 0, endMin: tripDurationMinutes, safe: true }],
      spikes,
      session: sessionPayload,
      totalBlockAttempts: windowStats.totalBlockAttempts,
      distractionAttempts,
      sessionTimelines,
    };
  }
}

export default FleetDriverDetailService;
