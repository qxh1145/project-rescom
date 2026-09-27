import { InMemoryParticipationRepository } from '../../src/modules/participation/infrastructure/in-memory-participation.repository';
import { SurveyAttemptEntity } from '../../src/modules/participation/domain/survey-attempt.entity';

/**
 * Story 8.2: submissions must respect the server-side Time Barrier
 * (answerable questions x 2 s, or the publisher minimum). Specs that are not
 * about timing move the server-recorded attempt start into the past instead of
 * sleeping or weakening the rule.
 */
export function backdateAttempt(
  repository: InMemoryParticipationRepository,
  attemptId: string,
  seconds: number,
): SurveyAttemptEntity {
  const attempt = repository.attempts.get(attemptId);
  if (!attempt) {
    throw new Error(`Attempt ${attemptId} not found`);
  }
  const backdated = new SurveyAttemptEntity(
    attempt.id,
    attempt.surveyId,
    attempt.formVersionId,
    attempt.respondentId,
    attempt.status,
    attempt.isGuest,
    new Date(attempt.startedAt.getTime() - seconds * 1000),
    attempt.submittedAt,
    attempt.clientContext,
    attempt.createdAt,
    attempt.updatedAt,
    // Keep the server-owned completion-code state (decision E5-D1 counts it).
    attempt.codeVerification,
  );
  repository.attempts.set(attemptId, backdated);
  return backdated;
}
