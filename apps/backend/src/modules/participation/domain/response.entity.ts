export type ResponseStatus =
  'IN_PROGRESS' | 'SUBMITTED' | 'VALIDATED' | 'DISPUTED' | 'REJECTED';

export class ResponseEntity {
  constructor(
    public readonly id: string,
    public readonly formId: string,
    public readonly formVersionId: string,
    public readonly attemptId: string | null,
    public readonly respondentId: string | null,
    public readonly status: ResponseStatus,
    public readonly answersJson: Record<string, unknown> | null,
    public readonly ipAddress: string,
    public readonly isGuest: boolean,
    public readonly submittedAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  isCompleted(): boolean {
    return this.status === 'SUBMITTED' || this.status === 'VALIDATED';
  }
}
