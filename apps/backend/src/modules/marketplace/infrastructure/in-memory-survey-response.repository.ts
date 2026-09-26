import {
  SurveyResponseRepositoryPort,
  RecordResponseParams,
  SurveyResponseStatus,
  CreateGuestSubmissionParams,
  GuestSubmissionEntity,
} from '../application/ports/survey-response.repository.port';

interface StoredResponse {
  id: string;
  formId: string;
  formVersionId?: string;
  respondentId?: string | null;
  status: SurveyResponseStatus;
  isGuest?: boolean;
  answers?: Record<string, unknown>;
  ipAddress?: string;
  submittedAt?: Date;
}

interface StoredCompletedAttempt {
  formId: string;
  respondentId: string;
  hasResponse: boolean;
}

export class InMemorySurveyResponseRepository implements SurveyResponseRepositoryPort {
  private readonly responses: StoredResponse[] = [];
  private readonly completedAttempts: StoredCompletedAttempt[] = [];

  clear(): void {
    this.responses.length = 0;
    this.completedAttempts.length = 0;
  }

  /**
   * Test helper: a COMPLETED SurveyAttempt. External completions have no
   * Response (`hasResponse: false`) and count toward the quota; an Internal
   * attempt keeps its Response (whose status decides the quota count).
   */
  recordCompletedAttempt(params: {
    formId: string;
    respondentId: string;
    hasResponse?: boolean;
  }): void {
    this.completedAttempts.push({
      formId: params.formId,
      respondentId: params.respondentId,
      hasResponse: params.hasResponse ?? false,
    });
  }

  /** Test helper: a verified External completion (attempt, no Response). */
  recordExternalCompletion(formId: string, respondentId: string): void {
    this.recordCompletedAttempt({ formId, respondentId, hasResponse: false });
  }

  async recordResponse(params: RecordResponseParams): Promise<void> {
    this.responses.push({
      id: `resp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      formId: params.formId,
      formVersionId: params.formVersionId,
      respondentId: params.respondentId ?? null,
      status: params.status,
      isGuest: params.respondentId == null,
      submittedAt: new Date(),
    });
  }

  async findCompletedFormIdsByRespondent(
    respondentId: string,
  ): Promise<Set<string>> {
    const completedSet = new Set<string>();
    for (const r of this.responses) {
      if (
        r.respondentId === respondentId &&
        (r.status === 'SUBMITTED' || r.status === 'VALIDATED')
      ) {
        completedSet.add(r.formId);
      }
    }
    for (const attempt of this.completedAttempts) {
      if (attempt.respondentId === respondentId) {
        completedSet.add(attempt.formId);
      }
    }
    return completedSet;
  }

  async getCompletedCountsByFormIds(
    formIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const id of formIds) {
      counts.set(id, 0);
    }
    for (const r of this.responses) {
      if (
        formIds.includes(r.formId) &&
        (r.status === 'SUBMITTED' || r.status === 'VALIDATED')
      ) {
        const current = counts.get(r.formId) ?? 0;
        counts.set(r.formId, current + 1);
      }
    }
    for (const attempt of this.completedAttempts) {
      if (!attempt.hasResponse && formIds.includes(attempt.formId)) {
        counts.set(attempt.formId, (counts.get(attempt.formId) ?? 0) + 1);
      }
    }
    return counts;
  }

  async createGuestSubmission(
    params: CreateGuestSubmissionParams,
  ): Promise<GuestSubmissionEntity> {
    const submissionId = `00000000-0000-4000-8000-${Math.random().toString(16).substring(2, 14).padStart(12, '0')}`;
    const now = new Date();

    this.responses.push({
      id: submissionId,
      formId: params.formId,
      formVersionId: params.formVersionId,
      respondentId: null,
      status: 'SUBMITTED',
      isGuest: true,
      answers: params.answers,
      ipAddress: params.ipAddress,
      submittedAt: now,
    });

    return {
      id: submissionId,
      formId: params.formId,
      formVersionId: params.formVersionId,
      status: 'SUBMITTED',
      isGuest: true,
      rewardEarned: 0,
      integrityStatus: 'ASSESSED',
      respondentReliability: 'NOT_AVAILABLE',
      submittedAt: now,
    };
  }
}
