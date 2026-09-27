export class IntegrityEventEntity {
  constructor(
    public readonly clientEventId: string,
    public readonly eventType: string,
    public readonly attemptId: string,
    public readonly formVersionId: string,
    public readonly respondentId: string | null,
    public readonly occurredAt: Date,
    public readonly responseId?: string | null,
    public readonly questionId?: string | null,
    public readonly sequence?: number | null,
    public readonly metadata?: Record<string, unknown> | null,
    public readonly consentId?: string | null,
  ) {}
}
