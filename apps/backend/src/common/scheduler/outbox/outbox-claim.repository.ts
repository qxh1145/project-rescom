import { OutboxEnvelope } from './outbox-handler';

/**
 * Story IR.2b Task 4.3–4.7: claim/lease/retry state of `outbox_events` and
 * the `processed_handlers` dedupe rows (Platform Infrastructure owns both;
 * AD-16). Never deletes Outbox rows: re-drive reads the pinned payloads.
 */
export const OUTBOX_CLAIM_REPOSITORY = Symbol('OUTBOX_CLAIM_REPOSITORY');

export interface OutboxFailure {
  status: 'FAILED' | 'DEAD_LETTER';
  availableAt: Date;
  lastError: string;
  /** `MAX_ATTEMPTS` | `INVALID_PAYLOAD` | `UNSUPPORTED_SCHEMA_VERSION` | `NON_RETRYABLE`. */
  terminalState: string | null;
}

export interface OutboxBacklog {
  /** Subscribed types, PENDING. */
  pending: number;
  /** Subscribed types, FAILED (waiting for their retry). */
  retrying: number;
  deadLetter: number;
  /** Age of the oldest subscribed event that is due now (null when none). */
  oldestAvailableAgeSeconds: number | null;
  /** PENDING events of types no handler subscribes to (informational). */
  unsubscribedPending: number;
}

export interface DeadLetterItem {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  attempts: number;
  terminalState: string | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeadLetterPage {
  items: DeadLetterItem[];
  nextCursor: string | null;
}

export type RedriveResult = 'REDRIVEN' | 'NOT_FOUND' | 'NOT_DEAD_LETTER';

export interface OutboxClaimRepository {
  /**
   * One statement: claims up to `limit` due events of `types` (PENDING or
   * FAILED, unclaimed or claim expired, no unprocessed earlier sequence of
   * their ordering stream) with `FOR UPDATE SKIP LOCKED`; sets the claim and
   * increments `attempts`.
   */
  claimBatch(params: {
    types: string[];
    owner: string;
    fencingToken: string;
    now: Date;
    leaseMs: number;
    limit: number;
  }): Promise<OutboxEnvelope[]>;
  /** Joins the ambient transaction: `FOR UPDATE` the row if still ours. */
  lockClaimed(
    eventId: string,
    owner: string,
    fencingToken: string,
  ): Promise<boolean>;
  processedHandlerNames(eventId: string): Promise<Set<string>>;
  /** Joins the ambient transaction. */
  recordProcessed(
    handlerName: string,
    eventId: string,
    streamSequence: number | null,
    now: Date,
  ): Promise<void>;
  /** Joins the ambient transaction. */
  markProcessed(eventId: string, now: Date): Promise<void>;
  /**
   * Graceful stop (review MEDIUM-3): hands an unstarted claim back — claim
   * cleared, the attempt it counted given back. CAS on owner + token.
   */
  releaseClaim(
    eventId: string,
    owner: string,
    fencingToken: string,
  ): Promise<void>;
  /** Short separate write, compare-and-set on the claim. */
  recordFailure(
    eventId: string,
    owner: string,
    fencingToken: string,
    now: Date,
    failure: OutboxFailure,
  ): Promise<boolean>;
  backlog(subscribedTypes: string[], now: Date): Promise<OutboxBacklog>;
  /** Newest first; `cursor` = `keysetCursorOf` the last row shown. */
  listDeadLetters(
    limit: number,
    cursor: string | null,
  ): Promise<DeadLetterPage>;
  /**
   * DEAD_LETTER → PENDING, attempts 0, available now; keeps the identity.
   * The `OUTBOX_EVENT_REDRIVEN` audit row (by `adminId`) is written in the
   * same transaction (review LOW-13).
   */
  redrive(eventId: string, now: Date, adminId: string): Promise<RedriveResult>;
}
