import {
  RESERVATION_EXPIRY_MS,
  TIME_BARRIER_POLICY_VERSION,
  computeInternalTimeBarrier,
  type AttemptTimeBarrierDto,
} from "@rescom/schemas";
import { createCollection, mockId, nowIso } from "../db/store";
import { getActiveScenario } from "../scenarios";
import type { SurveyType } from "./surveys";

/**
 * Survey attempts (participation). Created by `POST /surveys/:id/attempts`
 * (`mocks/handlers/participation.ts`); the in-Rescom and Google Forms flows
 * move them forward through the helpers below.
 */
/**
 * Backend `AttemptStatus` (prisma). Reward states (Google Forms 48h pending,
 * integrity hold) live in the wallet history, not here; an expired
 * reservation stays IN_PROGRESS (reads never write, like the backend).
 */
export type MockAttemptStatus =
  | "IN_PROGRESS"
  /** Submitted (in-Rescom) or completion code accepted (Google Forms). */
  | "COMPLETED"
  /** Cancelled ("Huỷ lượt làm"). */
  | "ABANDONED"
  /** Google Forms: 3 wrong codes (page 5c). */
  | "LOCKED";

export interface MockAttempt {
  attemptId: string;
  responseId: string | null;
  userId: string;
  surveyId: string;
  formVersionId: string;
  type: SurveyType;
  status: MockAttemptStatus;
  /** Why an ABANDONED attempt closed (`closedReason` of GET /attempts/:id). */
  closedReason: "EXPIRED" | "CANCELLED" | null;
  /** When it closed; absent on attempts stored before the field existed. */
  closedAt?: string | null;
  /** Pinned FormVersion number (`versionNumber` of GET /attempts/:id). */
  versionNumber: number;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  /** In-Rescom answers by question id (draft + final). */
  answers: Record<string, unknown>;
  /** Google Forms completion code checks. */
  wrongCodeCount: number;
  /** Mock completion code the Google Form's thank-you page would show. */
  completionCode: string | null;
  /** In-Rescom: the original submit result, replayed on a resubmission (decision E5-D3). */
  submission: unknown;
}

export const attempts = createCollection<MockAttempt[]>("attempts", () => []);

export function findAttempt(attemptId: string): MockAttempt | undefined {
  return attempts.get().find((attempt) => attempt.attemptId === attemptId);
}

function isActive(attempt: MockAttempt, now: number): boolean {
  return attempt.status === "IN_PROGRESS" && Date.parse(attempt.expiresAt) > now;
}

export function activeAttemptOf(userId: string, surveyId: string): MockAttempt | undefined {
  const now = Date.now();
  return attempts
    .get()
    .find((attempt) => attempt.userId === userId && attempt.surveyId === surveyId && isActive(attempt, now));
}

/** Unexpired in-progress attempts of a survey: they hold reserved quota (SURVEY_QUOTA_FULL). */
export function activeReservationCount(surveyId: string): number {
  const now = Date.now();
  return attempts.get().filter((attempt) => attempt.surveyId === surveyId && isActive(attempt, now)).length;
}

/** Wrong completion codes of this account on one FormVersion, across all attempts (decision E5-D1). */
export function accountWrongCodeCount(userId: string, formVersionId: string): number {
  return attempts
    .get()
    .filter((attempt) => attempt.userId === userId && attempt.formVersionId === formVersionId)
    .reduce((sum, attempt) => sum + attempt.wrongCodeCount, 0);
}

export function createAttempt(input: {
  userId: string;
  surveyId: string;
  formVersionId: string;
  versionNumber: number;
  type: SurveyType;
}): MockAttempt {
  const startedAt = nowIso();
  const attempt: MockAttempt = {
    attemptId: mockId(),
    responseId: input.type === "INTERNAL" ? mockId() : null,
    userId: input.userId,
    surveyId: input.surveyId,
    formVersionId: input.formVersionId,
    type: input.type,
    status: "IN_PROGRESS",
    closedReason: null,
    closedAt: null,
    versionNumber: input.versionNumber,
    startedAt,
    expiresAt: new Date(Date.parse(startedAt) + RESERVATION_EXPIRY_MS).toISOString(),
    submittedAt: null,
    answers: {},
    wrongCodeCount: 0,
    // Figma 5b sample code; any 6 digits other than this are "wrong" in the mock.
    completionCode: input.type === "EXTERNAL" ? "482917" : null,
    submission: null,
  };
  attempts.update((all) => {
    all.push(attempt);
  });
  return attempt;
}

export function updateAttempt(attemptId: string, mutator: (attempt: MockAttempt) => void): MockAttempt | undefined {
  return attempts
    .update((all) => {
      const target = all.find((attempt) => attempt.attemptId === attemptId);
      if (target) mutator(target);
    })
    .find((attempt) => attempt.attemptId === attemptId);
}

/**
 * Google Forms time barrier. The backend uses the publisher's
 * `minTimeBarrierSeconds` or `DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS` (15 s);
 * ASSUMED mock publisher minimum = 4:12, the countdown Figma 5 (62:2) shows
 * right after opening the form. `?msw=gform-no-barrier` drops it for demos.
 */
export const MOCK_EXTERNAL_TIME_BARRIER_SECONDS = 4 * 60 + 12;

export function externalBarrierSecondsOf(attempt: MockAttempt): number {
  if (attempt.type !== "EXTERNAL") return 0;
  return getActiveScenario() === "gform-no-barrier" ? 0 : MOCK_EXTERNAL_TIME_BARRIER_SECONDS;
}

/**
 * `attemptTimeBarrierSchema` of an INTERNAL attempt: the backend rule
 * (answerable questions x 2 s or the publisher minimum) on its questions.
 */
export function internalTimeBarrierOf(
  attempt: MockAttempt,
  definition: Parameters<typeof computeInternalTimeBarrier>[0],
): AttemptTimeBarrierDto {
  const { requiredSeconds, questionCount, secondsPerQuestion, policyVersion } = computeInternalTimeBarrier(definition);
  return {
    requiredSeconds,
    questionCount,
    secondsPerQuestion,
    earliestSubmitAt: new Date(Date.parse(attempt.startedAt) + requiredSeconds * 1000).toISOString(),
    policyVersion,
  };
}

/** `attemptTimeBarrierSchema` for EXTERNAL attempts; `null` for INTERNAL (see `internalTimeBarrierOf`). */
export function mockTimeBarrierOf(attempt: MockAttempt): AttemptTimeBarrierDto | null {
  if (attempt.type !== "EXTERNAL") return null;
  const requiredSeconds = externalBarrierSecondsOf(attempt);
  return {
    requiredSeconds,
    questionCount: null,
    secondsPerQuestion: null,
    earliestSubmitAt: new Date(Date.parse(attempt.startedAt) + requiredSeconds * 1000).toISOString(),
    policyVersion: TIME_BARRIER_POLICY_VERSION,
  };
}
