import {
  AttemptTimeBarrierDto,
  computeInternalTimeBarrier,
  parseFormDefinitionDraft,
  resolveExternalTimeBarrierSeconds,
  TIME_BARRIER_POLICY_VERSION,
} from '@rescom/schemas';
import { FormWithVersion } from '../../forms/application/ports/form-repository.port';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';

/**
 * Pure projections of an attempt's PINNED FormVersion (AD-19), shared by the
 * attempt start / submit / verify commands (`ParticipationService`) and the
 * runner reads (`SurveyRunnerReadService`), so the start response and
 * `GET /attempts/:attemptId` announce the same barrier byte for byte.
 */

/** Barrier that applies to an attempt (Story 8.2); computed server-side only. */
export interface ResolvedTimeBarrier {
  requiredSeconds: number;
  questionCount: number | null;
  secondsPerQuestion: number | null;
  publisherMinimumSeconds: number | null;
  policyVersion: string;
}

/** The attempt's pinned FormVersion (AD-19), or null when it is unknown. */
export function findPinnedVersion(
  formWithVersion: FormWithVersion,
  formVersionId: string,
): FormVersionEntity | null {
  return (
    formWithVersion.versions?.find((v) => v.id === formVersionId) ??
    (formWithVersion.currentVersion.id === formVersionId
      ? formWithVersion.currentVersion
      : null)
  );
}

/**
 * Story 8.2: Internal = max(answerable questions x 2 s, publisher minimum);
 * External = publisher minimum or 15 s (question count unknown).
 */
export function resolveTimeBarrier(
  formType: 'INTERNAL' | 'EXTERNAL',
  version: FormVersionEntity,
): ResolvedTimeBarrier {
  const parsed = parseFormDefinitionDraft(version.schemaJson);
  const definition = parsed.success
    ? parsed.data
    : ((version.schemaJson ?? null) as Parameters<
        typeof computeInternalTimeBarrier
      >[0]);
  if (formType === 'INTERNAL') {
    return computeInternalTimeBarrier(definition);
  }
  const requiredSeconds = resolveExternalTimeBarrierSeconds(
    definition?.metadata,
  );
  return {
    requiredSeconds,
    questionCount: null,
    secondsPerQuestion: null,
    publisherMinimumSeconds: requiredSeconds,
    policyVersion: TIME_BARRIER_POLICY_VERSION,
  };
}

/** The barrier as announced to the client, measured from the server start. */
export function describeAttemptTimeBarrier(
  barrier: ResolvedTimeBarrier,
  startedAt: Date,
): AttemptTimeBarrierDto {
  return {
    requiredSeconds: barrier.requiredSeconds,
    questionCount: barrier.questionCount,
    secondsPerQuestion: barrier.secondsPerQuestion,
    earliestSubmitAt: new Date(
      startedAt.getTime() + barrier.requiredSeconds * 1000,
    ).toISOString(),
    policyVersion: barrier.policyVersion,
  };
}
