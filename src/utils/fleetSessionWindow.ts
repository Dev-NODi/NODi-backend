/** Rolling window for fleet safety (matches dashboard donut / activity). */
export const FLEET_SAFETY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export function fleetSafetyCutoff(): Date {
  return new Date(Date.now() - FLEET_SAFETY_LOOKBACK_MS);
}

/**
 * Sessions that count for "last 30 days" fleet views:
 * started in window, ended in window, or still open.
 */
export function sessionsRelevantToWindow(cutoff: Date) {
  return {
    OR: [
      { startedAt: { gte: cutoff } },
      { endedAt: { gte: cutoff } },
      { endedAt: null },
    ],
  };
}
