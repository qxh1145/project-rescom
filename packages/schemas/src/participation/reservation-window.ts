import { RESERVATION_EXPIRY_MINUTES } from './survey-attempt.schema';
import {
  computeInternalTimeBarrier,
  resolveExternalTimeBarrierSeconds,
} from './bot-protection';

/**
 * Code-review decision E5-D2 (2026-09-26, option A): a survey must fit the
 * fixed 30-minute attempt reservation, or nobody can finish it (a barrier of
 * 30 minutes or more makes every submission "too fast" until the attempt
 * expires; an honest survey longer than 30 minutes expires mid-way and loses
 * the answers or the External code).
 *
 * Checked when a survey is published (and re-checked by the moderation
 * approval); drafts stay editable. Embedded sub-question default (recorded):
 * **Phase 1 does not support surveys longer than 30 minutes.** Longer surveys
 * would need a per-attempt reservation (option B), which is Phase 2.
 */
export const SURVEY_DURATION_EXCEEDS_RESERVATION_CODE =
  'SURVEY_DURATION_EXCEEDS_RESERVATION';

/** The attempt reservation window (Story 5.1 AC3.1), in seconds. */
export const RESERVATION_WINDOW_SECONDS = RESERVATION_EXPIRY_MINUTES * 60;

/**
 * Time a respondent keeps after the required barrier to type the answers or
 * the code and submit before the reservation expires.
 */
export const RESERVATION_SUBMIT_GRACE_SECONDS = 5 * 60;

/** Largest effective minimum time a publishable survey may require (25 min). */
export const MAX_PUBLISHABLE_TIME_BARRIER_SECONDS =
  RESERVATION_WINDOW_SECONDS - RESERVATION_SUBMIT_GRACE_SECONDS;

/** Largest expected effort / estimated duration a publishable survey may declare. */
export const MAX_PUBLISHABLE_EFFORT_SECONDS = RESERVATION_WINDOW_SECONDS;
export const MAX_PUBLISHABLE_DURATION_MINUTES = RESERVATION_EXPIRY_MINUTES;

export type ReservationWindowViolation =
  | {
      rule: 'TIME_BARRIER';
      /** Internal: max(answerable questions x 2 s, publisher minimum). */
      requiredSeconds: number;
      maxSeconds: number;
      questionCount: number | null;
      publisherMinimumSeconds: number;
    }
  | {
      rule: 'EXPECTED_EFFORT';
      expectedEffortSeconds: number;
      maxSeconds: number;
    }
  | {
      rule: 'ESTIMATED_DURATION';
      estimatedDurationMinutes: number;
      maxMinutes: number;
    };

export interface ReservationWindowCheck {
  fits: boolean;
  reservationWindowSeconds: number;
  violations: ReservationWindowViolation[];
}

type DefinitionLike =
  | {
      blocks?: ReadonlyArray<{ type?: unknown }> | null;
      metadata?: {
        minTimeBarrierSeconds?: number | null;
        expectedEffortSeconds?: number | null;
      } | null;
    }
  | null
  | undefined;

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * The publish-time invariant "required barrier + grace <= reservation window"
 * plus "declared effort/duration <= reservation window":
 * - Internal: the effective barrier is `computeInternalTimeBarrier` —
 *   answerable questions x 2 s AND the publisher minimum (Epic 8 D6 note);
 * - External: the configured minimum (or the 15 s default);
 * - both: `metadata.expectedEffortSeconds` and the form's
 *   `estimatedDurationMinutes` (when set).
 */
export function checkSurveyFitsReservationWindow(input: {
  type: 'INTERNAL' | 'EXTERNAL';
  definition: unknown;
  estimatedDurationMinutes?: number | null;
}): ReservationWindowCheck {
  const definition = (
    input.definition && typeof input.definition === 'object'
      ? input.definition
      : null
  ) as DefinitionLike;
  const violations: ReservationWindowViolation[] = [];

  if (input.type === 'INTERNAL') {
    const barrier = computeInternalTimeBarrier(definition);
    if (barrier.requiredSeconds > MAX_PUBLISHABLE_TIME_BARRIER_SECONDS) {
      violations.push({
        rule: 'TIME_BARRIER',
        requiredSeconds: barrier.requiredSeconds,
        maxSeconds: MAX_PUBLISHABLE_TIME_BARRIER_SECONDS,
        questionCount: barrier.questionCount,
        publisherMinimumSeconds: barrier.publisherMinimumSeconds,
      });
    }
  } else {
    const requiredSeconds = resolveExternalTimeBarrierSeconds(
      definition?.metadata,
    );
    if (requiredSeconds > MAX_PUBLISHABLE_TIME_BARRIER_SECONDS) {
      violations.push({
        rule: 'TIME_BARRIER',
        requiredSeconds,
        maxSeconds: MAX_PUBLISHABLE_TIME_BARRIER_SECONDS,
        questionCount: null,
        publisherMinimumSeconds: requiredSeconds,
      });
    }
  }

  const expectedEffortSeconds = positiveNumber(
    definition?.metadata?.expectedEffortSeconds,
  );
  if (
    expectedEffortSeconds !== null &&
    expectedEffortSeconds > MAX_PUBLISHABLE_EFFORT_SECONDS
  ) {
    violations.push({
      rule: 'EXPECTED_EFFORT',
      expectedEffortSeconds,
      maxSeconds: MAX_PUBLISHABLE_EFFORT_SECONDS,
    });
  }

  const estimatedDurationMinutes = positiveNumber(
    input.estimatedDurationMinutes,
  );
  if (
    estimatedDurationMinutes !== null &&
    estimatedDurationMinutes > MAX_PUBLISHABLE_DURATION_MINUTES
  ) {
    violations.push({
      rule: 'ESTIMATED_DURATION',
      estimatedDurationMinutes,
      maxMinutes: MAX_PUBLISHABLE_DURATION_MINUTES,
    });
  }

  return {
    fits: violations.length === 0,
    reservationWindowSeconds: RESERVATION_WINDOW_SECONDS,
    violations,
  };
}

/** One English sentence per violation (backend 422 message). */
export function describeReservationWindowViolation(
  violation: ReservationWindowViolation,
): string {
  switch (violation.rule) {
    case 'TIME_BARRIER':
      return violation.questionCount !== null
        ? `the minimum completion time is ${violation.requiredSeconds} s (${violation.questionCount} questions x 2 s or the publisher minimum of ${violation.publisherMinimumSeconds} s), above the ${violation.maxSeconds} s allowed`
        : `the minimum completion time is ${violation.requiredSeconds} s, above the ${violation.maxSeconds} s allowed`;
    case 'EXPECTED_EFFORT':
      return `the expected effort is ${violation.expectedEffortSeconds} s, above the ${violation.maxSeconds} s allowed`;
    case 'ESTIMATED_DURATION':
      return `the estimated duration is ${violation.estimatedDurationMinutes} min, above the ${violation.maxMinutes} min allowed`;
  }
}
