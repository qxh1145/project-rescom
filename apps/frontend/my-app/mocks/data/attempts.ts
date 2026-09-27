import { RESERVATION_EXPIRY_MS, TIME_BARRIER_POLICY_VERSION, type AttemptTimeBarrierDto } from "@rescom/schemas";
import { createCollection, mockId, nowIso } from "../db/store";
import { getActiveScenario } from "../scenarios";
import type { SurveyType } from "./surveys";

/**
 * Survey attempts (participation). Created by `POST /surveys/:id/attempts`
 * (`mocks/handlers/participation.ts`); the in-Rescom and Google Forms flows
 * move them forward through the helpers below.
 */
export type MockAttemptStatus =
  | "IN_PROGRESS"
  /** Google Forms: code accepted, points pending 48h (page 5 step 3). */
  | "PENDING_REVIEW"
  | "SUBMITTED"
  /** Google Forms: 3 wrong codes (page 5c). */
  | "LOCKED"
  | "EXPIRED"
  | "CANCELLED";

export interface MockAttempt {
  attemptId: string;
  responseId: string | null;
  userId: string;
  surveyId: string;
  formVersionId: string;
  type: SurveyType;
  status: MockAttemptStatus;
  startedAt: string;
  expiresAt: string;
  submittedAt: string | null;
  /** In-Rescom answers by question id (draft + final). */
  answers: Record<string, unknown>;
  /** Google Forms completion code checks. */
  wrongCodeCount: number;
  /** Mock completion code the Google Form's thank-you page would show. */
  completionCode: string | null;
}

export const attempts = createCollection<MockAttempt[]>("attempts", () => []);

export function findAttempt(attemptId: string): MockAttempt | undefined {
  return attempts.get().find((attempt) => attempt.attemptId === attemptId);
}

export function activeAttemptOf(userId: string, surveyId: string): MockAttempt | undefined {
  const now = Date.now();
  return attempts
    .get()
    .find(
      (attempt) =>
        attempt.userId === userId &&
        attempt.surveyId === surveyId &&
        attempt.status === "IN_PROGRESS" &&
        Date.parse(attempt.expiresAt) > now,
    );
}

export function createAttempt(input: {
  userId: string;
  surveyId: string;
  formVersionId: string;
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
    startedAt,
    expiresAt: new Date(Date.parse(startedAt) + RESERVATION_EXPIRY_MS).toISOString(),
    submittedAt: null,
    answers: {},
    wrongCodeCount: 0,
    // Figma 5b sample code; any 6 digits other than this are "wrong" in the mock.
    completionCode: input.type === "EXTERNAL" ? "482917" : null,
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

/** `attemptTimeBarrierSchema` for EXTERNAL attempts; `null` for INTERNAL (owned by the in-Rescom flow). */
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
