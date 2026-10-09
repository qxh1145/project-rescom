import {
  SurveyResponseRepositoryPort,
  RecordResponseParams,
  SurveyResponseStatus,
  CreateGuestResponseWithinQuotaParams,
  CreateGuestResponseWithinQuotaResult,
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

/** The `forms` row columns the guest quota check reads under its lock. */
export interface InMemoryGuestQuotaForm {
  id: string;
  status: string;
  type: string;
  expectedCompletions: number;
  isOfficial?: boolean;
}

/**
 * Review F12: the in-memory stores the services write, read by the guest
 * quota check instead of the `registerForm` / `recordActiveAttempt` test
 * maps, so closing a form or starting a paid attempt through the services
 * affects guests the way it does with Prisma.
 */
export interface InMemoryGuestQuotaSources {
  /** The forms rows, e.g. `InMemoryFormRepository`. */
  forms?: {
    peekForm(formId: string): InMemoryGuestQuotaForm | null | undefined;
  };
  /** The attempts `reserveAttempt` writes, e.g. `InMemoryParticipationRepository`. */
  attempts?: {
    countInProgressAttemptsFor(formId: string, startedSince: Date): number;
  };
}

interface StoredCompletedAttempt {
  formId: string;
  respondentId: string;
  hasResponse: boolean;
}

export class InMemorySurveyResponseRepository implements SurveyResponseRepositoryPort {
  private readonly responses: StoredResponse[] = [];
  private readonly completedAttempts: StoredCompletedAttempt[] = [];
  private readonly forms = new Map<string, InMemoryGuestQuotaForm>();
  private readonly activeAttempts: Array<{ formId: string; startedAt: Date }> =
    [];

  constructor(private readonly sources: InMemoryGuestQuotaSources = {}) {}

  clear(): void {
    this.responses.length = 0;
    this.completedAttempts.length = 0;
    this.forms.clear();
    this.activeAttempts.length = 0;
  }

  /**
   * Test helper: the form row `createGuestResponseWithinQuota` locks when no
   * `forms` source is injected.
   */
  registerForm(form: InMemoryGuestQuotaForm): void {
    this.forms.set(form.id, { ...form });
  }

  /**
   * Test helper: an IN_PROGRESS attempt (a paid reservation) of a form, read
   * when no `attempts` source is injected.
   */
  recordActiveAttempt(formId: string, startedAt: Date = new Date()): void {
    this.activeAttempts.push({ formId, startedAt });
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

  /**
   * Mirrors the Prisma implementation: the check and the insert run with no
   * `await` in between, which is as atomic as the form row lock in memory.
   */
  async createGuestResponseWithinQuota(
    params: CreateGuestResponseWithinQuotaParams,
  ): Promise<CreateGuestResponseWithinQuotaResult> {
    const form = this.sources.forms
      ? this.sources.forms.peekForm(params.formId)
      : this.forms.get(params.formId);
    if (!form || form.status !== 'PUBLISHED' || form.type !== 'INTERNAL') {
      return { outcome: 'NOT_OPEN' };
    }

    const completed = this.countCompletions(params.formId);
    const activeReservationCount = this.sources.attempts
      ? this.sources.attempts.countInProgressAttemptsFor(
          params.formId,
          params.cutoffDate,
        )
      : this.activeAttempts.filter(
          (attempt) =>
            attempt.formId === params.formId &&
            attempt.startedAt.getTime() >= params.cutoffDate.getTime(),
        ).length;
    if (
      !form.isOfficial &&
      completed + activeReservationCount >= form.expectedCompletions
    ) {
      return { outcome: 'QUOTA_FULL' };
    }

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

    if (params.afterCreate) {
      await params.afterCreate();
    }

    return {
      outcome: 'CREATED',
      response: {
        id: submissionId,
        formId: params.formId,
        formVersionId: params.formVersionId,
        status: 'SUBMITTED',
        isGuest: true,
        rewardEarned: 0,
        integrityStatus: 'ASSESSED',
        respondentReliability: 'NOT_AVAILABLE',
        submittedAt: now,
      },
    };
  }

  private countCompletions(formId: string): number {
    const responses = this.responses.filter(
      (r) =>
        r.formId === formId &&
        (r.status === 'SUBMITTED' || r.status === 'VALIDATED'),
    ).length;
    const external = this.completedAttempts.filter(
      (attempt) => !attempt.hasResponse && attempt.formId === formId,
    ).length;
    return responses + external;
  }
}
