export type AttemptStatus =
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ABANDONED'
  | 'LOCKED';

export class SurveyAttemptEntity {
  constructor(
    public readonly id: string,
    public readonly surveyId: string,
    public readonly formVersionId: string,
    public readonly respondentId: string | null,
    public readonly status: AttemptStatus,
    public readonly isGuest: boolean,
    public readonly startedAt: Date,
    public readonly submittedAt: Date | null,
    public readonly clientContext: Record<string, unknown> | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  isActive(cutoffDate: Date): boolean {
    return this.status === 'IN_PROGRESS' && this.startedAt >= cutoffDate;
  }

  isExpired(cutoffDate: Date): boolean {
    return this.status === 'IN_PROGRESS' && this.startedAt < cutoffDate;
  }
}
