/**
 * Maps `driving_sessions.total_block_attempts` (app-open count) to 0–100.
 *
 * Simple rule for stakeholders: **100 minus 2 points per attempt, minimum 50**
 * (at most 50 points deducted per session snapshot).
 */
export function safetyScoreFromBlockAttempts(attempts: number): number {
  const a = Math.max(0, Math.floor(Number(attempts)));
  if (!Number.isFinite(a)) return 100;
  return Math.max(50, 100 - 2 * a);
}
