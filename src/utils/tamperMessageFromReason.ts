/** Human-readable tamper detail for fleet APIs (dashboard activity, driver timeline). */
export function tamperMessageFromReason(reason: string | null): string {
  if (!reason) {
    return 'Device tamper flagged — heartbeat not acknowledged as expected.';
  }
  if (reason === 'missed_heartbeat_ack_2x') {
    return 'NODi App may have been tampered with. Missed two heartbeat acknowledgments in a row.';
  }
  return `Tamper: ${reason}`;
}
