import logger from '../config/logger';
import prisma from '../config/database';

const DEFAULT_MOTIVE_BASE_URL = 'https://api.gomotive.com';
const DEFAULT_DRIVER_LOCATIONS_PATH = '/v1/driver_locations';
const DEFAULT_AVAILABLE_TIME_PATH = '/v1/available_time';
const DEFAULT_VEHICLE_LOCATIONS_PATH = '/v1/vehicle_locations';

const DRIVER_IDS_CHUNK_SIZE = 40;
/** Single Motive request: Motive caps per_page at 100. */
const MOTIVE_LOCATIONS_PER_PAGE = 100;
/** Fetch this many Motive list pages at once (same latency as one round-trip when parallel). */
const MOTIVE_LIST_PAGE_PARALLELISM = 3;

/** Parsed row from Motive driver_locations (internal). */
export interface LiveFleetDriverLocation {
  motiveDriverId: number;
  firstName?: string;
  lastName?: string;
  /** HOS duty status from Motive `GET /v1/available_time` when enrichment succeeds (e.g. driving, on_duty, off_duty). */
  dutyStatus?: string;
  /** Latest active driving_session lock intent from backend state machine. */
  blockingRequested?: boolean | null;
  /** Latest active driving_session lock apply state from device ack. */
  blockingApplied?: boolean | null;
  /** True only when Motive duty is on_duty/driving and both lock flags are true. */
  isPhoneBlocked?: boolean | null;
  /** Internal driving_sessions row id used for blocking state. */
  blockingSessionId?: number | null;
  /** Last DB update timestamp (ISO) for the blocking session used. */
  blockingUpdatedAt?: string | null;
  /** Ground speed in mph when Motive reports it (fleet `vehicle_locations` list via `current_driver`, or per-vehicle endpoint / driver_locations). */
  speedMph?: number;
  latitude: number;
  longitude: number;
  locationDescription?: string;
  recordedAt?: string;
  vehicle?: {
    id?: number;
    number?: string;
    year?: string;
    make?: string;
    model?: string;
    vin?: string;
  } | null;
}

interface MotiveListResponseShape {
  users?: unknown;
  vehicles?: unknown;
  data?: unknown;
  driver_locations?: unknown;
  locations?: unknown;
}

type DriverBlockingSessionState = {
  sessionId: number;
  requestedBlockingState: boolean | null;
  appliedBlockingState: boolean | null;
  updatedAtIso: string;
};

/** Per-driver data from Motive `GET /v1/available_time` (duty + vehicle when Motive sends it). */
export type AvailableTimeDriverEnrichment = {
  dutyStatus?: string;
  /** Motive vehicle id for `vehicle_locations` speed lookup */
  motiveVehicleId?: number;
  vehicle?: LiveFleetDriverLocation['vehicle'];
};

export type LiveLocationsEnrichOptions = {
  /** When false, skips Motive `available_time` (faster). Default true. */
  includeDuty?: boolean;
  /** When false, skips per-vehicle `vehicle_locations` speed calls (faster). Default true. */
  includeSpeed?: boolean;
};

class LiveFleetLocationService {
  private static getApiKey(): string {
    const apiKey = process.env.MOTIVE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('MOTIVE_API_KEY is not configured');
    }
    return apiKey;
  }

  private static getBaseUrl(): string {
    return process.env.MOTIVE_API_BASE_URL || DEFAULT_MOTIVE_BASE_URL;
  }

  private static async fetchDriverLocationsPage(
    pageNo: number,
    apiKey: string,
    baseUrl: string,
    locationsPath: string
  ): Promise<LiveFleetDriverLocation[]> {
    const searchParams = new URLSearchParams();
    searchParams.set('per_page', String(MOTIVE_LOCATIONS_PER_PAGE));
    searchParams.set('page_no', String(pageNo));
    const url = `${baseUrl}${locationsPath}?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      logger.error(`Motive driver_locations error (${response.status}) page ${pageNo}: ${bodyText}`);
      throw new Error(`Motive API returned ${response.status}`);
    }

    const payload = (await response.json()) as MotiveListResponseShape | unknown;
    const rawLocations = LiveFleetLocationService.extractUsersArray(payload);

    return rawLocations
      .map((item) => LiveFleetLocationService.normalizeLocation(item))
      .filter((value): value is LiveFleetDriverLocation => value !== null);
  }

  static async getDriverLocations(): Promise<LiveFleetDriverLocation[]> {
    const apiKey = LiveFleetLocationService.getApiKey();
    const baseUrl = LiveFleetLocationService.getBaseUrl();
    const locationsPath =
      process.env.MOTIVE_DRIVER_LOCATIONS_PATH || DEFAULT_DRIVER_LOCATIONS_PATH;

    const merged: LiveFleetDriverLocation[] = [];
    let nextPage = 1;

    while (true) {
      const pageNos = Array.from(
        { length: MOTIVE_LIST_PAGE_PARALLELISM },
        (_, i) => nextPage + i
      );
      const batches = await Promise.all(
        pageNos.map((p) =>
          LiveFleetLocationService.fetchDriverLocationsPage(p, apiKey, baseUrl, locationsPath)
        )
      );

      let stop = false;
      for (const batch of batches) {
        merged.push(...batch);
        if (batch.length < MOTIVE_LOCATIONS_PER_PAGE) {
          stop = true;
          break;
        }
      }
      if (stop) break;
      nextPage += MOTIVE_LIST_PAGE_PARALLELISM;
    }

    return merged;
  }

  /**
   * {@link getDriverLocations} plus optional `dutyStatus` and `speedMph`.
   * Duty chunks and speed fetches run in parallel after locations are loaded.
   */
  static async getDriverLocationsWithDuty(
    options: LiveLocationsEnrichOptions = {}
  ): Promise<LiveFleetDriverLocation[]> {
    const includeDuty = options.includeDuty !== false;
    const includeSpeed = options.includeSpeed !== false;

    const locations = await LiveFleetLocationService.getDriverLocations();
    if (!includeDuty && !includeSpeed) {
      return locations;
    }

    const driverIds = [...new Set(locations.map((l) => l.motiveDriverId))];
    const needAvailableTime = includeDuty || includeSpeed;

    const [blockingByDriverId, byDriver, fleetByDriverId] = await Promise.all([
      LiveFleetLocationService.getActiveBlockingSessionStateByMotiveDriverId(driverIds),
      needAvailableTime
        ? LiveFleetLocationService.getAvailableTimeEnrichment(driverIds)
        : Promise.resolve(new Map<number, AvailableTimeDriverEnrichment>()),
      includeSpeed
        ? LiveFleetLocationService.fetchVehicleLocationsFleetByDriverId()
        : Promise.resolve(
            new Map<
              number,
              { speedMph?: number; vehicle: NonNullable<LiveFleetDriverLocation['vehicle']> }
            >()
          ),
    ]);

    const vehicleIdSet = new Set<number>();
    for (const loc of locations) {
      const v = loc.vehicle?.id;
      if (typeof v === 'number' && v > 0) vehicleIdSet.add(v);
    }
    if (includeSpeed) {
      for (const row of byDriver.values()) {
        const mv = row.motiveVehicleId;
        if (typeof mv === 'number' && mv > 0) vehicleIdSet.add(mv);
      }
      for (const fleet of fleetByDriverId.values()) {
        const vid = fleet.vehicle?.id;
        if (typeof vid === 'number' && vid > 0) vehicleIdSet.add(vid);
      }
    }

    const speedByVehicleId = includeSpeed
      ? await LiveFleetLocationService.getSpeedsForVehicleIds([...vehicleIdSet])
      : new Map<number, number>();

    return locations.map((loc) => {
      const next: LiveFleetDriverLocation = { ...loc };
      const at = byDriver.get(loc.motiveDriverId);

      if (includeDuty && at?.dutyStatus) {
        next.dutyStatus = at.dutyStatus;
      }

      if (at?.vehicle && !next.vehicle) {
        next.vehicle = at.vehicle;
      }

      if (includeSpeed) {
        const fleet = fleetByDriverId.get(loc.motiveDriverId);
        if (fleet?.vehicle && !next.vehicle) {
          next.vehicle = fleet.vehicle;
        }
        if (fleet?.speedMph !== undefined) {
          next.speedMph = fleet.speedMph;
        }
      }

      const vidForSpeed =
        (typeof next.vehicle?.id === 'number' && next.vehicle.id > 0 ? next.vehicle.id : undefined) ??
        (typeof loc.vehicle?.id === 'number' && loc.vehicle.id > 0 ? loc.vehicle.id : undefined) ??
        at?.motiveVehicleId;

      if (includeSpeed && next.speedMph === undefined && vidForSpeed != null) {
        const mph = speedByVehicleId.get(vidForSpeed);
        if (mph !== undefined) next.speedMph = mph;
      }

      const block = blockingByDriverId.get(loc.motiveDriverId);
      if (block) {
        next.blockingSessionId = block.sessionId;
        next.blockingRequested = block.requestedBlockingState;
        next.blockingApplied = block.appliedBlockingState;
        next.blockingUpdatedAt = block.updatedAtIso;
      } else {
        next.blockingSessionId = null;
        next.blockingRequested = null;
        next.blockingApplied = null;
        next.blockingUpdatedAt = null;
      }

      const duty = (next.dutyStatus || '').toLowerCase();
      if (!duty) {
        next.isPhoneBlocked = null;
      } else {
        const dutyRequiresBlocking = duty === 'on_duty' || duty === 'driving';
        next.isPhoneBlocked =
          dutyRequiresBlocking &&
          next.blockingRequested === true &&
          next.blockingApplied === true;
      }
      return next;
    });
  }

  private static async getActiveBlockingSessionStateByMotiveDriverId(
    motiveDriverIds: number[]
  ): Promise<Map<number, DriverBlockingSessionState>> {
    const map = new Map<number, DriverBlockingSessionState>();
    if (motiveDriverIds.length === 0) return map;

    try {
      const rows = await prisma.drivingSession.findMany({
        where: {
          motiveDriverId: { in: motiveDriverIds },
          endedAt: null,
        },
        select: {
          id: true,
          motiveDriverId: true,
          requestedBlockingState: true,
          appliedBlockingState: true,
          updatedAt: true,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      });

      for (const row of rows) {
        if (map.has(row.motiveDriverId)) continue;
        map.set(row.motiveDriverId, {
          sessionId: row.id,
          requestedBlockingState: row.requestedBlockingState ?? null,
          appliedBlockingState: row.appliedBlockingState ?? null,
          updatedAtIso: row.updatedAt.toISOString(),
        });
      }
    } catch (err) {
      logger.warn(
        `Live locations blocking state lookup failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return map;
  }

  /**
   * Pull speed from driver_locations row when Motive includes it (avoids extra API calls).
   */
  private static parseSpeedMphFromRecord(
    currentLocation: Record<string, unknown> | undefined,
    user: Record<string, unknown>,
    record: Record<string, unknown>
  ): number | undefined {
    const loc = currentLocation ?? {};
    const mphDirect =
      LiveFleetLocationService.toNumber(loc.speed) ??
      LiveFleetLocationService.toNumber(loc.speed_mph) ??
      LiveFleetLocationService.toNumber(loc.speed_in_mph) ??
      LiveFleetLocationService.toNumber(loc.ground_speed) ??
      LiveFleetLocationService.toNumber(user.speed) ??
      LiveFleetLocationService.toNumber(user.speed_mph) ??
      LiveFleetLocationService.toNumber(record.speed) ??
      LiveFleetLocationService.toNumber(record.speed_mph);
    if (mphDirect !== undefined) return mphDirect;

    const kph =
      LiveFleetLocationService.toNumber(loc.speed_kph) ??
      LiveFleetLocationService.toNumber(loc.kph) ??
      LiveFleetLocationService.toNumber(user.speed_kph) ??
      LiveFleetLocationService.toNumber(user.kph) ??
      LiveFleetLocationService.toNumber(record.speed_kph) ??
      LiveFleetLocationService.toNumber(record.kph);
    if (kph !== undefined) {
      return Number((kph * 0.621371).toFixed(2));
    }
    return undefined;
  }

  /**
   * Duty status + vehicle (for speed lookup) from Motive `GET /v1/available_time`.
   * Chunk requests run in parallel.
   */
  static async getAvailableTimeEnrichment(
    driverIds: number[]
  ): Promise<Map<number, AvailableTimeDriverEnrichment>> {
    const merged = new Map<number, AvailableTimeDriverEnrichment>();
    if (driverIds.length === 0) return merged;

    const chunks: number[][] = [];
    for (let i = 0; i < driverIds.length; i += DRIVER_IDS_CHUNK_SIZE) {
      chunks.push(driverIds.slice(i, i + DRIVER_IDS_CHUNK_SIZE));
    }

    const chunkMaps = await Promise.all(
      chunks.map((chunk) => LiveFleetLocationService.fetchAvailableTimeChunk(chunk))
    );
    for (const m of chunkMaps) {
      for (const [id, row] of m) merged.set(id, row);
    }
    return merged;
  }

  /**
   * @deprecated Prefer {@link getAvailableTimeEnrichment}; kept for a single-purpose duty map.
   */
  static async getDutyStatusesForDriverIds(driverIds: number[]): Promise<Map<number, string>> {
    const enriched = await LiveFleetLocationService.getAvailableTimeEnrichment(driverIds);
    const dutyOnly = new Map<number, string>();
    for (const [id, row] of enriched) {
      if (row.dutyStatus) dutyOnly.set(id, row.dutyStatus);
    }
    return dutyOnly;
  }

  private static parseVehicleFromAvailableTimeUser(
    user: Record<string, unknown>
  ): { motiveVehicleId?: number; vehicle?: LiveFleetDriverLocation['vehicle'] } {
    const currentVehicle =
      LiveFleetLocationService.toObject(user.current_vehicle) ??
      LiveFleetLocationService.toObject(user.currentVehicle);
    const vehicleIdFromUser =
      LiveFleetLocationService.toNumber(currentVehicle?.id) ??
      LiveFleetLocationService.toNumber(user.current_vehicle_id) ??
      LiveFleetLocationService.toNumber(user.currentVehicleId) ??
      LiveFleetLocationService.toNumber(user.vehicle_id) ??
      LiveFleetLocationService.toNumber(user.vehicleId);

    if (!currentVehicle && vehicleIdFromUser === undefined) {
      return {};
    }

    const vehicle: LiveFleetDriverLocation['vehicle'] = currentVehicle
      ? {
          id: LiveFleetLocationService.toNumber(currentVehicle.id) ?? vehicleIdFromUser,
          number: LiveFleetLocationService.toString(currentVehicle.number),
          year: LiveFleetLocationService.toString(currentVehicle.year),
          make: LiveFleetLocationService.toString(currentVehicle.make),
          model: LiveFleetLocationService.toString(currentVehicle.model),
          vin: LiveFleetLocationService.toString(currentVehicle.vin),
        }
      : vehicleIdFromUser != null
        ? { id: vehicleIdFromUser }
        : null;

    const motiveVehicleId =
      (typeof vehicle?.id === 'number' && vehicle.id > 0 ? vehicle.id : undefined) ??
      vehicleIdFromUser;

    return {
      motiveVehicleId: motiveVehicleId && motiveVehicleId > 0 ? motiveVehicleId : undefined,
      vehicle: vehicle && (vehicle.id != null || vehicle.number || vehicle.vin) ? vehicle : undefined,
    };
  }

  private static async fetchAvailableTimeChunk(
    chunk: number[]
  ): Promise<Map<number, AvailableTimeDriverEnrichment>> {
    const map = new Map<number, AvailableTimeDriverEnrichment>();
    if (chunk.length === 0) return map;

    const apiKey = LiveFleetLocationService.getApiKey();
    const baseUrl = LiveFleetLocationService.getBaseUrl();
    const path =
      process.env.MOTIVE_AVAILABLE_TIME_PATH || DEFAULT_AVAILABLE_TIME_PATH;

    const searchParams = new URLSearchParams();
    for (const id of chunk) {
      searchParams.append('driver_ids[]', String(id));
    }
    searchParams.set('per_page', String(Math.max(chunk.length, 25)));
    searchParams.set('page_no', '1');
    const url = `${baseUrl}${path}?${searchParams.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-api-key': apiKey,
        },
      });

      if (!response.ok) {
        const bodyText = await response.text();
        logger.warn(
          `Motive available_time error (${response.status}) for ${chunk.length} ids: ${bodyText.slice(0, 200)}`
        );
        return map;
      }

      const payload = (await response.json()) as MotiveListResponseShape | unknown;
      const rows = LiveFleetLocationService.extractUsersArray(payload);
      for (const item of rows) {
        if (!item || typeof item !== 'object') continue;
        const record = item as Record<string, unknown>;
        const userBase = LiveFleetLocationService.toObject(record.user) ?? record;
        const user: Record<string, unknown> = { ...userBase };
        if (!user.current_vehicle && !user.currentVehicle) {
          const nested =
            LiveFleetLocationService.toObject(record.current_vehicle) ??
            LiveFleetLocationService.toObject(record.vehicle);
          if (nested) user.current_vehicle = nested;
        }

        const id = LiveFleetLocationService.toNumber(user.id);
        if (!id) continue;

        const duty = LiveFleetLocationService.toString(user.duty_status);
        const { motiveVehicleId, vehicle } =
          LiveFleetLocationService.parseVehicleFromAvailableTimeUser(user);

        const row: AvailableTimeDriverEnrichment = {};
        if (duty) row.dutyStatus = duty;
        if (motiveVehicleId != null) row.motiveVehicleId = motiveVehicleId;
        if (vehicle) row.vehicle = vehicle;

        if (row.dutyStatus || row.motiveVehicleId || row.vehicle) {
          map.set(id, row);
        }
      }
    } catch (err) {
      logger.warn(
        `Motive available_time request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return map;
  }

  /**
   * Paginated `GET /v1/vehicle_locations` (no id): join `current_driver.id` → speed + vehicle.
   * Motive often leaves `current_location.speed` null on breadcrumb pings; then we fall back to per-vehicle `/{id}?date=`.
   */
  private static async fetchVehicleLocationsListPage(
    pageNo: number,
    apiKey: string,
    baseUrl: string,
    path: string
  ): Promise<unknown[]> {
    const searchParams = new URLSearchParams();
    searchParams.set('per_page', String(MOTIVE_LOCATIONS_PER_PAGE));
    searchParams.set('page_no', String(pageNo));
    const url = `${baseUrl}${path}?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      logger.warn(
        `Motive vehicle_locations list (${response.status}) page ${pageNo}: ${bodyText.slice(0, 280)}`
      );
      return [];
    }

    const payload = (await response.json()) as unknown;
    return LiveFleetLocationService.extractVehiclesArray(payload);
  }

  private static async fetchVehicleLocationsFleetByDriverId(): Promise<
    Map<number, { speedMph?: number; vehicle: NonNullable<LiveFleetDriverLocation['vehicle']> }>
  > {
    const map = new Map<
      number,
      { speedMph?: number; vehicle: NonNullable<LiveFleetDriverLocation['vehicle']> }
    >();

    try {
      const apiKey = LiveFleetLocationService.getApiKey();
      const baseUrl = LiveFleetLocationService.getBaseUrl();
      const path =
        process.env.MOTIVE_VEHICLE_LOCATIONS_PATH || DEFAULT_VEHICLE_LOCATIONS_PATH;

      let nextPage = 1;
      while (true) {
        const pageNos = Array.from(
          { length: MOTIVE_LIST_PAGE_PARALLELISM },
          (_, i) => nextPage + i
        );
        const rowBatches = await Promise.all(
          pageNos.map((p) =>
            LiveFleetLocationService.fetchVehicleLocationsListPage(p, apiKey, baseUrl, path)
          )
        );

        let stop = false;
        for (const rows of rowBatches) {
          for (const row of rows) {
            const parsed = LiveFleetLocationService.parseVehicleFleetListItem(row);
            if (!parsed) continue;
            map.set(parsed.driverId, {
              vehicle: parsed.vehicle,
              speedMph: parsed.speedMph,
            });
          }
          if (rows.length < MOTIVE_LOCATIONS_PER_PAGE) {
            stop = true;
            break;
          }
        }
        if (stop) break;
        nextPage += MOTIVE_LIST_PAGE_PARALLELISM;
      }
    } catch (err) {
      logger.warn(
        `Motive vehicle_locations list request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return map;
  }

  private static vehicleNumberFromUnknownField(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }

  /** Parse `vehicle.number` (unit / plate) from Motive `GET …/vehicle_locations/:id` JSON. */
  private static extractVehicleNumberFromLocationDetailRecord(
    record: Record<string, unknown>
  ): string | null {
    const direct = LiveFleetLocationService.vehicleNumberFromUnknownField(record.number);
    if (direct) return direct;

    const v = LiveFleetLocationService.toObject(record.vehicle);
    if (v) {
      const n = LiveFleetLocationService.vehicleNumberFromUnknownField(v.number);
      if (n) return n;
    }

    const vl = LiveFleetLocationService.toObject(record.vehicle_location);
    if (vl) {
      const n2 = LiveFleetLocationService.vehicleNumberFromUnknownField(vl.number);
      if (n2) return n2;
      const v2 = LiveFleetLocationService.toObject(vl.vehicle);
      if (v2) {
        const n3 = LiveFleetLocationService.vehicleNumberFromUnknownField(v2.number);
        if (n3) return n3;
      }
    }

    return null;
  }

  /**
   * Motive vehicle id → display `number` from `GET /v1/vehicle_locations/:id` (same endpoint
   * shape as speed lookup). Used when live driver_locations omit the driver or `vehicle.number`.
   */
  static async getVehicleDisplayNumberByVehicleId(vehicleId: number): Promise<string | null> {
    if (!vehicleId || vehicleId <= 0) return null;
    try {
      const apiKey = LiveFleetLocationService.getApiKey();
      const baseUrl = LiveFleetLocationService.getBaseUrl();
      const path =
        process.env.MOTIVE_VEHICLE_LOCATIONS_PATH || DEFAULT_VEHICLE_LOCATIONS_PATH;
      const today = new Date().toISOString().slice(0, 10);
      const url = `${baseUrl}${path}/${vehicleId}?date=${today}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          'x-api-key': apiKey,
        },
      });

      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as unknown;
      const record = LiveFleetLocationService.pickVehicleLocationRecord(payload);
      if (!record) return null;
      return LiveFleetLocationService.extractVehicleNumberFromLocationDetailRecord(record);
    } catch (err) {
      logger.warn(
        `Motive vehicle_locations/${vehicleId} number lookup failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    }
  }

  /** Batch-resolve Motive `vehicle.number` for many vehicle ids (bounded parallelism). */
  static async getVehicleDisplayNumbersByVehicleIds(
    vehicleIds: number[]
  ): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    const unique = [...new Set(vehicleIds.filter((id) => Number.isInteger(id) && id > 0))];
    const MAX = 120;
    const slice = unique.length > MAX ? unique.slice(0, MAX) : unique;
    if (slice.length < unique.length) {
      logger.warn(
        `getVehicleDisplayNumbersByVehicleIds: capping ${unique.length} vehicle ids to ${MAX}`
      );
    }

    const CHUNK = 8;
    for (let i = 0; i < slice.length; i += CHUNK) {
      const part = slice.slice(i, i + CHUNK);
      const results = await Promise.all(
        part.map(async (id) => {
          const num = await LiveFleetLocationService.getVehicleDisplayNumberByVehicleId(id);
          return { id, num } as const;
        })
      );
      for (const { id, num } of results) {
        if (num) map.set(id, num);
      }
    }
    return map;
  }

  /**
   * Motive driver id → `vehicle.number` from the same live driver-locations snapshot as
   * {@link getDriverLocationsWithDuty} (drivers map / cards). Plate only, not VIN.
   */
  static async getVehicleNumberByMotiveDriverIdMap(): Promise<Map<number, string>> {
    const map = new Map<number, string>();
    try {
      const locs = await LiveFleetLocationService.getDriverLocationsWithDuty({});
      for (const loc of locs) {
        const id = loc.motiveDriverId;
        if (typeof id !== 'number' || id <= 0) continue;
        const num = loc.vehicle?.number?.trim();
        if (num) map.set(id, num);
      }
    } catch (err) {
      logger.warn(
        `Live driver locations for vehicle number map failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return map;
  }

  private static parseVehicleFleetListItem(item: unknown): {
    driverId: number;
    speedMph?: number;
    vehicle: NonNullable<LiveFleetDriverLocation['vehicle']>;
  } | null {
    if (!item || typeof item !== 'object') return null;
    const wrap = item as Record<string, unknown>;
    const v = LiveFleetLocationService.toObject(wrap.vehicle);
    if (!v) return null;

    const vehicleId = LiveFleetLocationService.toNumber(v.id);
    if (!vehicleId || vehicleId <= 0) return null;

    const driver = LiveFleetLocationService.toObject(v.current_driver);
    const driverId = LiveFleetLocationService.toNumber(driver?.id);
    if (!driverId || driverId <= 0) return null;

    const loc = LiveFleetLocationService.toObject(v.current_location);
    let speedMph: number | undefined;
    if (loc && loc.speed !== undefined && loc.speed !== null) {
      const s = LiveFleetLocationService.toNumber(loc.speed);
      if (s !== undefined) speedMph = s;
    }

    const vehicle: NonNullable<LiveFleetDriverLocation['vehicle']> = {
      id: vehicleId,
      number: LiveFleetLocationService.toString(v.number),
      year: LiveFleetLocationService.toString(v.year),
      make: LiveFleetLocationService.toString(v.make),
      model: LiveFleetLocationService.toString(v.model),
      vin: LiveFleetLocationService.toString(v.vin),
    };

    return { driverId, vehicle, speedMph };
  }

  private static async getSpeedsForVehicleIds(vehicleIds: number[]): Promise<Map<number, number>> {
    const map = new Map<number, number>();
    if (vehicleIds.length === 0) return map;

    const results = await Promise.all(
      vehicleIds.map(async (vehicleId) => {
        const mph = await LiveFleetLocationService.getVehicleSpeedMph(vehicleId);
        return { vehicleId, mph } as const;
      })
    );
    for (const { vehicleId, mph } of results) {
      if (mph !== null) map.set(vehicleId, mph);
    }
    return map;
  }

  /**
   * Fetch current speed for a specific vehicle.
   * Tries common Motive fields (speed in mph, or kph converted to mph).
   */
  static async getVehicleSpeedMph(vehicleId: number): Promise<number | null> {
    const apiKey = LiveFleetLocationService.getApiKey();
    const baseUrl = LiveFleetLocationService.getBaseUrl();
    const path =
      process.env.MOTIVE_VEHICLE_LOCATIONS_PATH || DEFAULT_VEHICLE_LOCATIONS_PATH;
    const today = new Date().toISOString().slice(0, 10);
    const url = `${baseUrl}${path}/${vehicleId}?date=${today}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const bodyText = await response.text();
      logger.warn(`Motive vehicle_locations/${vehicleId} error (${response.status}): ${bodyText}`);
      return null;
    }

    const payload = (await response.json()) as unknown;
    const record = LiveFleetLocationService.pickVehicleLocationRecord(payload);
    if (!record) {
      if (process.env.MOTIVE_DEBUG_SPEED === '1' || process.env.MOTIVE_DEBUG_SPEED === 'true') {
        logger.info(
          `Motive speed debug vehicleId=${vehicleId}: pickVehicleLocationRecord returned null; payload keys=${payload && typeof payload === 'object' ? Object.keys(payload as object).join(',') : 'n/a'}`
        );
      }
      return null;
    }

    const currentLocation = LiveFleetLocationService.toObject(record.current_location);
    const nestedVl = LiveFleetLocationService.toObject(record.vehicle_location);

    const mph =
      LiveFleetLocationService.toNumber(record.speed) ??
      LiveFleetLocationService.toNumber(record.speed_mph) ??
      LiveFleetLocationService.toNumber(record.speed_in_mph) ??
      LiveFleetLocationService.toNumber(record.ground_speed) ??
      LiveFleetLocationService.toNumber(currentLocation?.speed) ??
      LiveFleetLocationService.toNumber(currentLocation?.speed_mph) ??
      LiveFleetLocationService.toNumber(nestedVl?.speed) ??
      LiveFleetLocationService.toNumber(nestedVl?.speed_mph) ??
      null;
    if (mph !== null) return mph;

    const kph =
      LiveFleetLocationService.toNumber(record.kph) ??
      LiveFleetLocationService.toNumber(record.speed_kph) ??
      LiveFleetLocationService.toNumber(currentLocation?.kph) ??
      LiveFleetLocationService.toNumber(currentLocation?.speed_kph) ??
      LiveFleetLocationService.toNumber(nestedVl?.kph) ??
      LiveFleetLocationService.toNumber(nestedVl?.speed_kph) ??
      null;
    if (kph !== null) {
      return Number((kph * 0.621371).toFixed(2));
    }

    if (process.env.MOTIVE_DEBUG_SPEED === '1' || process.env.MOTIVE_DEBUG_SPEED === 'true') {
      logger.info(
        `Motive speed debug vehicleId=${vehicleId}: HTTP 200 but no speed field; record keys=${Object.keys(record).join(',')}`
      );
    }

    return null;
  }

  private static extractUsersArray(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    const shaped = payload as MotiveListResponseShape;
    if (Array.isArray(shaped.users)) return shaped.users;
    if (Array.isArray(shaped.data)) return shaped.data;
    if (Array.isArray(shaped.driver_locations)) return shaped.driver_locations;
    if (Array.isArray(shaped.locations)) return shaped.locations;

    return [];
  }

  private static extractVehiclesArray(payload: unknown): unknown[] {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== 'object') return [];

    const shaped = payload as MotiveListResponseShape;
    if (Array.isArray(shaped.vehicles)) return shaped.vehicles;
    if (Array.isArray(shaped.data)) return shaped.data;

    return [];
  }

  private static normalizeLocation(item: unknown): LiveFleetDriverLocation | null {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const user = LiveFleetLocationService.toObject(record.user) ?? record;
    const currentLocation = LiveFleetLocationService.toObject(user.current_location);
    const currentVehicle = LiveFleetLocationService.toObject(user.current_vehicle);

    const motiveDriverId =
      LiveFleetLocationService.toNumber(user.id) ??
      LiveFleetLocationService.toNumber(record.driver_id) ??
      LiveFleetLocationService.toNumber(record.driverId) ??
      LiveFleetLocationService.toNumber(record.id);

    const latitude =
      LiveFleetLocationService.toNumber(currentLocation?.lat) ??
      LiveFleetLocationService.toNumber(record.latitude) ??
      LiveFleetLocationService.toNumber(record.lat) ??
      LiveFleetLocationService.toNumber(record.location_latitude);
    const longitude =
      LiveFleetLocationService.toNumber(currentLocation?.lon) ??
      LiveFleetLocationService.toNumber(record.longitude) ??
      LiveFleetLocationService.toNumber(record.lng) ??
      LiveFleetLocationService.toNumber(record.location_longitude);

    if (!motiveDriverId || latitude === undefined || longitude === undefined) {
      return null;
    }

    const recordedAt = LiveFleetLocationService.toString(
      currentLocation?.located_at ?? record.recorded_at ?? record.timestamp ?? record.updated_at
    );

    const speedMphFromDriverFeed = LiveFleetLocationService.parseSpeedMphFromRecord(
      currentLocation,
      user,
      record
    );

    return {
      motiveDriverId,
      firstName: LiveFleetLocationService.toString(user.first_name),
      lastName: LiveFleetLocationService.toString(user.last_name),
      latitude,
      longitude,
      locationDescription: LiveFleetLocationService.toString(currentLocation?.description),
      recordedAt,
      ...(speedMphFromDriverFeed !== undefined ? { speedMph: speedMphFromDriverFeed } : {}),
      vehicle: currentVehicle
        ? {
            id: LiveFleetLocationService.toNumber(currentVehicle.id),
            number: LiveFleetLocationService.toString(currentVehicle.number),
            year: LiveFleetLocationService.toString(currentVehicle.year),
            make: LiveFleetLocationService.toString(currentVehicle.make),
            model: LiveFleetLocationService.toString(currentVehicle.model),
            vin: LiveFleetLocationService.toString(currentVehicle.vin),
          }
        : null,
    };
  }

  private static pickVehicleLocationRecord(
    payload: unknown
  ): Record<string, unknown> | null {
    if (!payload || typeof payload !== 'object') return null;

    const root = payload as Record<string, unknown>;
    const vehicles = root.vehicles;
    if (Array.isArray(vehicles) && vehicles.length > 0) {
      const first = LiveFleetLocationService.toObject(vehicles[0]);
      const vehicle = LiveFleetLocationService.toObject(first?.vehicle);
      if (vehicle) return vehicle;
    }

    const vehicle = LiveFleetLocationService.toObject(root.vehicle);
    if (vehicle) return vehicle;

    const vehicleLocation = LiveFleetLocationService.toObject(root.vehicle_location);
    if (vehicleLocation) return vehicleLocation;

    const currentLocation = LiveFleetLocationService.toObject(root.current_location);
    if (currentLocation) return root;

    const data = root.data;
    if (Array.isArray(data) && data.length > 0) {
      const first = LiveFleetLocationService.toObject(data[0]);
      if (first) return first;
    }
    const directData = LiveFleetLocationService.toObject(data);
    if (directData) return directData;

    return root;
  }

  private static toNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  }

  private static toString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private static toObject(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object') return undefined;
    return value as Record<string, unknown>;
  }
}

export default LiveFleetLocationService;
