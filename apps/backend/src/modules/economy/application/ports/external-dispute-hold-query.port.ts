export const EXTERNAL_DISPUTE_HOLD_QUERY_PORT = Symbol(
  'EXTERNAL_DISPUTE_HOLD_QUERY_PORT',
);

/**
 * Server-side dispute check for the 48-hour Pending release (FR-24, Epic 6
 * review P2). The release must never trust a caller-supplied dispute flag.
 */
export interface ExternalDisputeHoldQueryPort {
  /** True when an open (locked) dispute hold exists for this External attempt. */
  hasOpenDisputeHold(attemptId: string): Promise<boolean>;
}

/**
 * Phase 1 default: no dispute cases exist yet (Story 8.5 is deferred to
 * Phase 2), so no attempt is ever under a dispute hold. Story 8.5 must
 * provide a real implementation (dispute case linked to the attempt, status
 * open) and bind it to `EXTERNAL_DISPUTE_HOLD_QUERY_PORT`.
 */
export class NoExternalDisputeHolds implements ExternalDisputeHoldQueryPort {
  async hasOpenDisputeHold(): Promise<boolean> {
    return false;
  }
}
