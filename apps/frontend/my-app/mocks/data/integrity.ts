import type { SubmitSurveyFeedbackCommand, SurveyFeedbackDto } from "@rescom/schemas";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import { attempts } from "./attempts";
import { rewardOutcomeOf } from "./economy";
import { findSurvey, SURVEY_IDS } from "./surveys";
import type { MockSessionUser } from "../db/session";

/**
 * Phase 3B respondent data quality: integrity consent (Figma 14, ASSUMED
 * routes), post-completion feedback (Story 9.2, VERIFIED routes) and the
 * reliability summary (Figma 17d, ASSUMED route).
 */

/** Figma 14 "Thông báo phiên bản 1". */
export const CURRENT_NOTICE_VERSION = 1;

interface MockConsent {
  noticeVersion: number;
  acceptedAt: string;
}

export const integrityConsents = createCollection<Record<string, MockConsent>>("integrity-consents", () => ({}));

export function consentOf(userId: string) {
  const consent = integrityConsents.get()[userId];
  return {
    currentVersion: CURRENT_NOTICE_VERSION,
    acceptedVersion: consent?.noticeVersion ?? null,
    acceptedAt: consent?.acceptedAt ?? null,
  };
}

export function acceptConsent(userId: string, noticeVersion: number) {
  integrityConsents.update((all) => {
    all[userId] = { noticeVersion, acceptedAt: nowIso() };
  });
  return consentOf(userId);
}

/** Feedback by attempt id (one per attempt, immutable once sent). */
export const surveyFeedback = createCollection<Record<string, SurveyFeedbackDto>>("survey-feedback", () => ({}));

export function saveFeedback(
  attempt: { attemptId: string; surveyId: string; formVersionId: string; type: "INTERNAL" | "EXTERNAL" },
  input: SubmitSurveyFeedbackCommand,
): SurveyFeedbackDto {
  const feedback: SurveyFeedbackDto = {
    id: mockId(),
    attemptId: attempt.attemptId,
    formId: attempt.surveyId,
    formVersionId: attempt.formVersionId,
    formType: attempt.type,
    rating: input.rating,
    comment: input.comment,
    issueTags: input.issueTags,
    validationStatus: "PENDING",
    submittedAt: nowIso(),
  };
  surveyFeedback.update((all) => {
    all[attempt.attemptId] = feedback;
  });
  return feedback;
}

type ReliabilityResult = "PASSED" | "REVIEW" | "PENDING" | "NOT_ASSESSED";

interface ReliabilityRow {
  attemptId: string;
  surveyTitle: string;
  source: "INTERNAL" | "EXTERNAL";
  submittedAt: string;
  result: ReliabilityResult;
}

/** Figma 17d sample history for the demo respondent (one in-Rescom "Đạt", one Google Forms). */
function seededRows(user: MockSessionUser): ReliabilityRow[] {
  if (user.email !== "minh.le@fpt.edu.vn") return [];
  return [
    {
      attemptId: "7c1e2d3f-4a5b-4c6d-8e7f-000000000001",
      surveyTitle: findSurvey(SURVEY_IDS.onlineShopping)?.title ?? "Hành vi mua sắm online của sinh viên Đà Nẵng",
      source: "INTERNAL",
      submittedAt: hoursAgo(18),
      result: "PASSED",
    },
    {
      attemptId: "7c1e2d3f-4a5b-4c6d-8e7f-000000000002",
      surveyTitle: findSurvey(SURVEY_IDS.aiStudyHabits)?.title ?? "Thói quen dùng AI trong học tập của sinh viên IT",
      source: "EXTERNAL",
      submittedAt: hoursAgo(17),
      result: "NOT_ASSESSED",
    },
  ];
}

/**
 * `GET /integrity/reliability/me` (ASSUMED): finished attempts of this user,
 * newest first, plus the Figma seed. Fewer than 3 assessed in-Rescom answers
 * = "Đang hình thành" with low confidence.
 */
export function reliabilityOf(user: MockSessionUser) {
  const own: ReliabilityRow[] = attempts
    .get()
    .filter((attempt) => attempt.userId === user.id && attempt.submittedAt !== null)
    .map((attempt) => {
      const held = rewardOutcomeOf(user, attempt.attemptId)?.status === "HELD_IN_INTEGRITY";
      return {
        attemptId: attempt.attemptId,
        surveyTitle: findSurvey(attempt.surveyId)?.title ?? "Khảo sát",
        source: attempt.type,
        submittedAt: attempt.submittedAt ?? nowIso(),
        result: attempt.type === "EXTERNAL" ? "NOT_ASSESSED" : held ? "PENDING" : "PASSED",
      };
    });
  const recent = [...own, ...seededRows(user)].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const assessed = recent.filter((row) => row.source === "INTERNAL");
  const internalResponseCount = assessed.length;
  const formed = assessed.filter((row) => row.result === "PASSED" || row.result === "REVIEW").length >= 3;
  return {
    level: formed ? (assessed.some((row) => row.result === "REVIEW") ? "REVIEW" : "GOOD") : "FORMING",
    confidence: internalResponseCount >= 10 ? "HIGH" : internalResponseCount >= 3 ? "MEDIUM" : "LOW",
    internalResponseCount,
    updatedAt: recent[0]?.submittedAt ?? nowIso(),
    recent: recent.slice(0, 10),
  } as const;
}
