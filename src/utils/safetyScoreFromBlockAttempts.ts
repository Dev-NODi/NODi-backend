/**
 * Per-session safety score:
 * - starts at 100
 * - minus 2 per unlock attempt
 * - minus 5 per tamper event
 * - floored at 0
 */
export function safetyScoreFromBlockAttempts(
  attempts: number,
  tamperCount: number = 0,
): number {
  const aRaw = Math.floor(Number(attempts));
  const tRaw = Math.floor(Number(tamperCount));
  const a = Number.isFinite(aRaw) ? Math.max(0, aRaw) : 0;
  const t = Number.isFinite(tRaw) ? Math.max(0, tRaw) : 0;
  return Math.max(0, 100 - 2 * a - 5 * t);
}
