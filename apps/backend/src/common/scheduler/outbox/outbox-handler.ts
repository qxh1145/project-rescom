/**
 * Story IR.2b Task 4.1/4.2 (AD-10): the Outbox handler contract. Deliberately
 * framework-free (no Nest, no Prisma), so a handler class may live in a
 * context's `application/` layer; registration always happens in Nest wiring
 * (a module `onModuleInit` or an `infrastructure/*-outbox.registrar.ts`).
 *
 * Handler kinds:
 * (a) PostgreSQL-local effect: the handler runs inside the dispatcher's
 *     transaction; its effect, the `processed_handlers` row and the Outbox
 *     state update commit together, so a replay is a no-op. Notifications
 *     published inside are flushed after commit (`afterCommit`). The only
 *     kind IR.2b ships (`economy.internal-reward-settlement`).
 * (b) External effect (e.g. IR.4b email, `runsOutsideTransaction`): it runs
 *     outside any transaction. The handler first persists a
 *     delivery attempt keyed by `event.idempotencyKey`, calls the provider
 *     with that key and, on retry, reconciles the provider status before
 *     acknowledging. A provider without idempotency or status lookup is not an
 *     approved adapter (AD-10).
 *
 * Handlers MUST parse `payload` with the shared Zod schema of their event and
 * throw `OutboxPayloadInvalidError` when it does not parse (dead-lettered at
 * once). Any other error is retried with backoff unless `isRetryable` says no.
 */

export interface OutboxEnvelope {
  id: string;
  idempotencyKey: string;
  eventType: string;
  schemaVersion: number;
  producer: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  orderingStream: string | null;
  streamSequence: number | null;
  correlationId: string | null;
  causationId: string | null;
  payload: unknown;
  /** Deliveries so far, this one included (incremented at claim time). */
  attempts: number;
  createdAt: Date;
}

export interface OutboxHandler {
  /** Globally unique, e.g. `economy.internal-reward-settlement`. */
  name: string;
  eventType: string;
  schemaVersions: number[];
  handle(event: OutboxEnvelope): Promise<void>;
  /**
   * Kind (b) handlers (external effects, e.g. email): `handle` runs with no
   * ambient transaction after an unlocked claim check, then a short
   * transaction re-checks the claim and records it processed. The handler
   * makes its own effect idempotent (a delivery attempt keyed by
   * `idempotencyKey`). Default false: kind (a), inside the transaction.
   */
  runsOutsideTransaction?: boolean;
  /** Default: every error except `OutboxPayloadInvalidError` is retryable. */
  isRetryable?(error: unknown): boolean;
}

/** The payload failed its event's shared schema: dead-letter immediately. */
export class OutboxPayloadInvalidError extends Error {
  readonly code = 'INVALID_PAYLOAD';

  constructor(eventType: string, detail: string) {
    super(`Invalid ${eventType} payload: ${detail}`);
    this.name = 'OutboxPayloadInvalidError';
  }
}

export class OutboxHandlerRegistry {
  private readonly handlers = new Map<string, OutboxHandler>();

  register(handler: OutboxHandler): void {
    if (this.handlers.has(handler.name)) {
      throw new Error(
        `Outbox handler "${handler.name}" is already registered.`,
      );
    }
    this.handlers.set(handler.name, handler);
  }

  /** The event type's handlers, in registration order. */
  handlersFor(eventType: string): OutboxHandler[] {
    return Array.from(this.handlers.values()).filter(
      (handler) => handler.eventType === eventType,
    );
  }

  /** Only these types are ever claimed; others stay PENDING for their consumer. */
  subscribedEventTypes(): string[] {
    return Array.from(
      new Set(
        Array.from(this.handlers.values()).map((handler) => handler.eventType),
      ),
    ).sort();
  }
}
