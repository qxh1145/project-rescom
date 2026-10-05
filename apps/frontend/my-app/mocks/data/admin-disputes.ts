import { loadStore } from "../legacy/store";
import {
  disputeCaseSchema,
  type DisputeCase,
  type DisputeCaseKind,
  type DisputeCaseOutcome,
} from "@/lib/admin/disputes-service";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import { findMockUserByEmail, type MockSessionUser } from "../db/session";
import { attempts, findAttempt, updateAttempt, type MockAttempt } from "./attempts";
import { toMockUuid } from "./auth";
import { addMissingCodeCase, creditRespondentRefusal, disputeHoldRefusal, type ResolveRefusal } from "./dispute-rules";
import {
  creditSurveyReward,
  holdSurveyReward,
  payRewardFromSurveyEscrow,
  recordTransaction,
  rewardOutcomeOf,
  updateWallet,
  walletOf,
} from "./economy";
import { findPublisherForm, PUBLISHER_FORM_IDS, updatePublisherForm } from "./forms";
import { formTracking, trackingOf, updateTracking } from "./forms-manage";
import { updateNotifications } from "./notifications";
import { findSurvey, markSurveyCompleted, SURVEY_IDS, updateSurvey } from "./surveys";
import { FRAUD_SEED_USER_IDS, recordMockFraudLog } from "./admin-fraud-log";

/**
 * Admin "Khiếu nại & báo lỗi" queue (Figma 11c, 62:1609). A case is the
 * backend-shaped `DisputeCase` plus the mock-only links needed to move points
 * (publisher form / email, respondent email).
 *
 * Sources, all materialised into one collection so a decision is stored once:
 * - the seed = the two Figma items (1 khiếu nại · 1 báo thiếu mã);
 * - disputes filed by publishers on `/forms/:id` (`forms-manage.ts` tracking,
 *   `pendingAttempts[].dispute` with status OPEN);
 * - Google Forms attempts locked after 3 wrong codes (`attempts.ts`);
 * - missing-code reports passed to `addMissingCodeReport` (the respondent
 *   handler does not store its reports yet, see the export below).
 */

export interface MockDisputeCase extends DisputeCase {
  /** Publisher survey whose escrow a refund goes back to (`forms.ts`). */
  publisherFormId: string | null;
  publisherEmail: string | null;
  /** Mock user of the respondent (null for Figma sample respondents such as #7F3A). */
  respondentEmail: string | null;
}

const REVIEW_MS = 48 * 3_600_000;

/** Figma 11c #7F3A: code verified 17h ago ("còn 31 giờ"), same attempt as the publisher tracking seed. */
const FIGMA_ATTEMPT_ID = "8d1e4b20-7f3a-4c1d-9e2f-0a1b2c3d5a01";

function figmaDispute(): MockDisputeCase {
  const tracked = trackingOf(PUBLISHER_FORM_IDS.readingHabits).pendingAttempts.find(
    (attempt) => attempt.attemptId === FIGMA_ATTEMPT_ID,
  );
  const codeVerifiedAt = tracked?.codeVerifiedAt ?? hoursAgo(17);
  const verifiedMs = Date.parse(codeVerifiedAt);
  const form = findPublisherForm(PUBLISHER_FORM_IDS.readingHabits);
  return {
    id: "9e3c1a70-1d2b-4c3d-8e4f-0a1b2c3d6a01",
    kind: "ATTEMPT_DISPUTE",
    status: "OPEN",
    createdAt: new Date(verifiedMs + 3 * 3_600_000).toISOString(),
    reporter: { role: "PUBLISHER", name: "Linh N." },
    survey: {
      id: PUBLISHER_FORM_IDS.readingHabits,
      title: form?.title ?? "Thói quen đọc sách của sinh viên",
      type: "EXTERNAL",
      rewardPerResponse: 10,
    },
    attempt: {
      id: FIGMA_ATTEMPT_ID,
      formVersionId: "6b1d2e3f-4a5b-4c6d-9e7f-0000000000f2",
      status: "COMPLETED",
      // "Nhập đúng mã hoàn thành · 3 phút 05 giây (khai 8 phút)".
      startedAt: new Date(verifiedMs - 185_000).toISOString(),
      codeVerifiedAt,
      declaredEffortSeconds: 8 * 60,
      wrongCodeCount: 0,
    },
    respondent: {
      id: FRAUD_SEED_USER_IDS.khang,
      code: "#7F3A",
      joinedAt: "2026-09-20T09:00:00+07:00",
      attemptCount: 14,
      fraudLogCount: 5,
      repeatOffender: true,
      recentFraudLogs: [
        { id: "a1f00001-0000-4000-8000-000000007f3a", type: "TIME_BARRIER", createdAt: "2026-09-25T21:14:00+07:00" },
        { id: "a1f00002-0000-4000-8000-000000007f3a", type: "SECURITY_VIOLATION", createdAt: "2026-09-24T10:02:00+07:00" },
        { id: "a1f00003-0000-4000-8000-000000007f3a", type: "RATE_LIMIT", createdAt: "2026-09-23T22:40:00+07:00" },
      ],
    },
    amount: 10,
    reviewEndsAt: new Date(verifiedMs + REVIEW_MS).toISOString(),
    reason: "LOW_EFFORT",
    description:
      'Câu trả lời chọn cùng một đáp án cho tất cả 20 câu, phần câu hỏi mở chỉ ghi "abc". Nộp lúc 15:10 theo Google Sheets.',
    evidence: [
      { id: "b2e00001-0000-4000-8000-000000007f3a", url: null },
      { id: "b2e00002-0000-4000-8000-000000007f3a", url: null },
    ],
    resolution: null,
    publisherFormId: PUBLISHER_FORM_IDS.readingHabits,
    publisherEmail: form?.ownerEmail ?? "minh.le@fpt.edu.vn",
    respondentEmail: null,
  };
}

/** Figma overview "1 báo thiếu mã" on "Thói quen dùng AI trong học tập của sinh viên IT" (detail ASSUMED). */
function figmaMissingCode(): MockDisputeCase {
  const survey = findSurvey(SURVEY_IDS.aiStudyHabits);
  const startedAt = hoursAgo(3);
  return {
    id: "9e3c1a70-1d2b-4c3d-8e4f-0a1b2c3d6a02",
    kind: "MISSING_CODE",
    status: "OPEN",
    createdAt: new Date(Date.parse(startedAt) + (9 * 60 + 40) * 1000).toISOString(),
    reporter: { role: "RESPONDENT", name: "#2C9D" },
    survey: {
      id: SURVEY_IDS.aiStudyHabits,
      title: survey?.title ?? "Thói quen dùng AI trong học tập của sinh viên IT",
      type: "EXTERNAL",
      rewardPerResponse: survey?.rewardPerResponse ?? 18,
    },
    attempt: {
      id: "8d1e4b20-2c9d-4c1d-9e2f-0a1b2c3d5a03",
      formVersionId: survey?.formVersionId ?? "6b1d2e3f-4a5b-4c6d-9e7f-000000000002",
      status: "IN_PROGRESS",
      startedAt,
      codeVerifiedAt: null,
      declaredEffortSeconds: survey?.estimatedEffortSeconds ?? 8 * 60,
      wrongCodeCount: 1,
    },
    respondent: {
      id: "3f7a0c1d-2e3f-4a5b-8c6d-7e8f9a0b2c9d",
      code: "#2C9D",
      joinedAt: "2026-09-12T20:30:00+07:00",
      attemptCount: 6,
      fraudLogCount: 1,
      repeatOffender: false,
      recentFraudLogs: [
        { id: "a1f00004-0000-4000-8000-000000002c9d", type: "SECURITY_VIOLATION", createdAt: new Date(Date.parse(startedAt) + 9 * 60_000).toISOString() },
      ],
    },
    amount: survey?.rewardPerResponse ?? 18,
    reviewEndsAt: null,
    reason: null,
    description:
      "Trang cảm ơn của Google Form chỉ hiện “Câu trả lời của bạn đã được ghi lại”, không có mã hoàn thành. Mình đã thử một mã đoán nhưng sai.",
    evidence: [{ id: "b2e00003-0000-4000-8000-000000002c9d", url: null }],
    resolution: null,
    publisherFormId: null,
    publisherEmail: null,
    respondentEmail: null,
  };
}

const STUDENT_DISPUTE_ATTEMPT_ID = "8d1e4b20-9c1d-4b1d-9e2f-0a1b2c3d5a09";
const STUDENT_DISPUTE_CASE_ID = "9e3c1a70-1d2b-4c3d-8e4f-0a1b2c3d6a03";

/**
 * Demo gap fix: `figmaDispute()` above uses the Figma sample respondent
 * `#7F3A`, who is not a mock account (`respondentEmail: null`), so admin
 * "Chấp nhận" on it always hits `disputeHoldRefusal` — there is no wallet to
 * refund the hold from. Seeds one real respondent (`student@fpt.edu.vn`) with
 * a completed Google Forms attempt on minh's "Thói quen đọc sách của sinh
 * viên" survey, still inside its 48h review. The mock has no `placeDisputeHold`
 * equivalent that moves a Chờ 48h reward into Integrity Hold when a dispute
 * opens (unlike the backend's `external-dispute:` journal) — `holdSurveyReward`
 * (used for the in-Rescom ENFORCED policy) reaches the same end state, so it
 * is reused here instead of inventing new economy rules.
 */
function ensureStudentDisputeAttempt(): MockAttempt | null {
  const student = findMockUserByEmail("student@fpt.edu.vn");
  if (!student) return null;
  const existing = findAttempt(STUDENT_DISPUTE_ATTEMPT_ID);
  if (existing) return existing;
  const codeVerifiedAt = hoursAgo(20);
  const startedAt = new Date(Date.parse(codeVerifiedAt) - 185_000).toISOString();
  const attempt: MockAttempt = {
    attemptId: STUDENT_DISPUTE_ATTEMPT_ID,
    responseId: null,
    userId: student.id,
    surveyId: PUBLISHER_FORM_IDS.readingHabits,
    formVersionId: "6b1d2e3f-4a5b-4c6d-9e7f-0000000000f2",
    type: "EXTERNAL",
    status: "COMPLETED",
    closedReason: null,
    versionNumber: 1,
    startedAt,
    expiresAt: new Date(Date.parse(startedAt) + 3_600_000).toISOString(),
    submittedAt: codeVerifiedAt,
    answers: {},
    wrongCodeCount: 0,
    completionCode: "482917",
    submission: null,
  };
  attempts.update((all) => {
    all.push(attempt);
  });
  holdSurveyReward(student, {
    amount: 10,
    surveyId: PUBLISHER_FORM_IDS.readingHabits,
    attemptId: STUDENT_DISPUTE_ATTEMPT_ID,
    title: "Thói quen đọc sách của sinh viên",
  });
  return attempt;
}

function studentReadingHabitsDispute(): MockDisputeCase | null {
  const attempt = ensureStudentDisputeAttempt();
  if (!attempt) return null;
  const form = findPublisherForm(PUBLISHER_FORM_IDS.readingHabits);
  const { respondent, email } = respondentOfUser(attempt.userId);
  const verifiedMs = Date.parse(attempt.submittedAt ?? attempt.startedAt);
  return {
    id: STUDENT_DISPUTE_CASE_ID,
    kind: "ATTEMPT_DISPUTE",
    status: "OPEN",
    createdAt: new Date(verifiedMs + 1_800_000).toISOString(),
    reporter: { role: "PUBLISHER", name: "Linh N." },
    survey: {
      id: PUBLISHER_FORM_IDS.readingHabits,
      title: form?.title ?? "Thói quen đọc sách của sinh viên",
      type: "EXTERNAL",
      rewardPerResponse: 10,
    },
    attempt: {
      id: attempt.attemptId,
      formVersionId: attempt.formVersionId,
      status: attempt.status,
      startedAt: attempt.startedAt,
      codeVerifiedAt: attempt.submittedAt,
      declaredEffortSeconds: 8 * 60,
      wrongCodeCount: attempt.wrongCodeCount,
    },
    respondent,
    amount: 10,
    reviewEndsAt: new Date(verifiedMs + REVIEW_MS).toISOString(),
    reason: "LOW_EFFORT",
    description:
      "Demo: lượt làm của tài khoản demo student@fpt.edu.vn, dùng để kiểm thử chấp nhận khiếu nại và hoàn điểm cho người đăng.",
    evidence: [],
    resolution: null,
    publisherFormId: PUBLISHER_FORM_IDS.readingHabits,
    publisherEmail: form?.ownerEmail ?? "minh.le@fpt.edu.vn",
    respondentEmail: email,
  };
}

export const disputeCases = createCollection<MockDisputeCase[]>("admin-dispute-cases", () => {
  const seeded = [figmaDispute(), figmaMissingCode()];
  const studentCase = studentReadingHabitsDispute();
  if (studentCase) seeded.push(studentCase);
  return seeded;
});

interface LegacyUser {
  id: string;
  email: string;
  createdAt: string;
}

function legacyUserById(userId: string): LegacyUser | null {
  const users = Object.values(loadStore().users) as LegacyUser[];
  return users.find((user) => toMockUuid(user.id) === userId) ?? null;
}

/** "#7F3A"-style handle from a user id. */
function respondentCodeOf(userId: string): string {
  return `#${userId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

function respondentOfUser(userId: string): { respondent: DisputeCase["respondent"]; email: string | null } {
  const user = legacyUserById(userId);
  const own = attempts.get().filter((attempt) => attempt.userId === userId);
  const wrongCodes = own.reduce((sum, attempt) => sum + attempt.wrongCodeCount, 0);
  return {
    email: user?.email ?? null,
    respondent: {
      id: userId,
      code: respondentCodeOf(userId),
      joinedAt: user?.createdAt ?? null,
      attemptCount: own.length,
      // Every wrong completion code is a SECURITY_VIOLATION FraudLog row (backend).
      fraudLogCount: wrongCodes,
      repeatOffender: own.filter((attempt) => attempt.status === "LOCKED").length > 1,
      recentFraudLogs: [],
    },
  };
}

/** Publisher disputes filed on `/forms/:id` (ASSUMED `POST /forms/:id/attempts/:attemptId/disputes`). */
function publisherDisputeCases(known: Set<string>): MockDisputeCase[] {
  const cases: MockDisputeCase[] = [];
  for (const [formId, tracking] of Object.entries(formTracking.get())) {
    const form = findPublisherForm(formId);
    if (!form) continue;
    for (const pending of tracking.pendingAttempts) {
      const dispute = pending.dispute;
      if (!dispute || dispute.status !== "OPEN" || known.has(pending.attemptId)) continue;
      const verifiedMs = Date.parse(pending.codeVerifiedAt);
      cases.push({
        id: dispute.id,
        kind: "ATTEMPT_DISPUTE",
        status: "OPEN",
        createdAt: dispute.createdAt,
        reporter: { role: "PUBLISHER", name: findMockUserByEmail(form.ownerEmail)?.name ?? form.ownerEmail },
        survey: { id: form.id, title: form.title, type: form.type, rewardPerResponse: form.rewardPerResponse },
        attempt: {
          id: pending.attemptId,
          formVersionId: mockId(),
          status: "COMPLETED",
          // ASSUMED: the tracking seed has no start time; the publisher estimate is used.
          startedAt: new Date(verifiedMs - form.estimatedEffortSeconds * 1000).toISOString(),
          codeVerifiedAt: pending.codeVerifiedAt,
          declaredEffortSeconds: form.estimatedEffortSeconds,
          wrongCodeCount: 0,
        },
        respondent: {
          id: mockId(),
          code: pending.respondentCode,
          joinedAt: null,
          attemptCount: 1,
          fraudLogCount: 0,
          repeatOffender: false,
          recentFraudLogs: [],
        },
        amount: form.rewardPerResponse,
        reviewEndsAt: new Date(verifiedMs + REVIEW_MS).toISOString(),
        reason: dispute.reason,
        description: dispute.description,
        evidence: [],
        resolution: null,
        publisherFormId: form.id,
        publisherEmail: form.ownerEmail,
        respondentEmail: null,
      });
    }
  }
  return cases;
}

/** Google Forms attempts locked by 3 wrong codes, not reviewed yet. */
function lockedAttemptCases(known: Set<string>): MockDisputeCase[] {
  return attempts
    .get()
    .filter((attempt) => attempt.type === "EXTERNAL" && attempt.status === "LOCKED" && !known.has(attempt.attemptId))
    .map((attempt): MockDisputeCase => {
      const survey = findSurvey(attempt.surveyId);
      const { respondent, email } = respondentOfUser(attempt.userId);
      return {
        id: mockId(),
        kind: "LOCKED_ATTEMPT",
        status: "OPEN",
        // The mock does not store the lock time: first seen by the admin queue.
        createdAt: nowIso(),
        reporter: { role: "SYSTEM", name: "Hệ thống" },
        survey: {
          id: attempt.surveyId,
          title: survey?.title ?? "Khảo sát",
          type: "EXTERNAL",
          rewardPerResponse: survey?.rewardPerResponse ?? 0,
        },
        attempt: {
          id: attempt.attemptId,
          formVersionId: attempt.formVersionId,
          status: "LOCKED",
          startedAt: attempt.startedAt,
          codeVerifiedAt: null,
          declaredEffortSeconds: survey?.estimatedEffortSeconds ?? null,
          wrongCodeCount: attempt.wrongCodeCount,
        },
        respondent,
        amount: survey?.rewardPerResponse ?? 0,
        reviewEndsAt: null,
        reason: null,
        description: null,
        evidence: [],
        resolution: null,
        publisherFormId: null,
        publisherEmail: null,
        respondentEmail: email,
      };
    });
}

/** Adds cases from the other mock sources that the queue has not seen yet. */
function syncCases(): MockDisputeCase[] {
  const current = disputeCases.get();
  const known = new Set(current.map((item) => item.attempt.id));
  const found = [...publisherDisputeCases(known), ...lockedAttemptCases(known)];
  if (found.length === 0) return current;
  return disputeCases.update((all) => {
    all.push(...found);
  });
}

/**
 * Strips the mock-only links: the `DisputeCase` the API returns. The attempt
 * status and wrong-code count are read live from `attempts.ts` (the case keeps
 * a snapshot from when it was filed): a respondent who reports a missing code
 * and then enters it has a COMPLETED attempt the Admin must see.
 */
export function toDisputeCaseDto(item: MockDisputeCase): DisputeCase {
  const live = findAttempt(item.attempt.id);
  const attempt = live
    ? { ...item.attempt, status: live.status, wrongCodeCount: live.wrongCodeCount }
    : item.attempt;
  // zod drops the unknown (mock-only) keys and checks the contract shape.
  return disputeCaseSchema.parse({ ...item, attempt });
}

export function openDisputeCases(): MockDisputeCase[] {
  return syncCases().filter((item) => item.status === "OPEN");
}

export function findDisputeCase(caseId: string): MockDisputeCase | undefined {
  return syncCases().find((item) => item.id === caseId);
}

export function openCaseCounts(): Record<DisputeCaseKind, number> {
  const counts: Record<DisputeCaseKind, number> = { ATTEMPT_DISPUTE: 0, MISSING_CODE: 0, LOCKED_ATTEMPT: 0 };
  for (const item of openDisputeCases()) counts[item.kind] += 1;
  return counts;
}

/** Sidebar badge "Khiếu nại & báo lỗi": open cases of every kind (Figma 2 = 1 + 1 + 0). */
export function disputeQueueCount(): number {
  return openDisputeCases().length;
}

/**
 * For the respondent handler (`POST /attempts/:attemptId/report-missing-code`),
 * which answers REPORTED but stores nothing yet: one call there makes the
 * report show up in the admin queue. One OPEN case per attempt
 * (`addMissingCodeCase`): a repeated report is ignored and an open
 * locked-attempt case of the same attempt becomes the report.
 */
export function addMissingCodeReport(input: { attemptId: string; reason: string }): void {
  const attempt = findAttempt(input.attemptId);
  if (!attempt) return;
  const survey = findSurvey(attempt.surveyId);
  const { respondent, email } = respondentOfUser(attempt.userId);
  disputeCases.update((all) => {
    addMissingCodeCase(all, {
      id: mockId(),
      kind: "MISSING_CODE",
      status: "OPEN",
      createdAt: nowIso(),
      reporter: { role: "RESPONDENT", name: respondent.code },
      survey: {
        id: attempt.surveyId,
        title: survey?.title ?? "Khảo sát",
        type: "EXTERNAL",
        rewardPerResponse: survey?.rewardPerResponse ?? 0,
      },
      attempt: {
        id: attempt.attemptId,
        formVersionId: attempt.formVersionId,
        status: attempt.status,
        startedAt: attempt.startedAt,
        codeVerifiedAt: null,
        declaredEffortSeconds: survey?.estimatedEffortSeconds ?? null,
        wrongCodeCount: attempt.wrongCodeCount,
      },
      respondent,
      amount: survey?.rewardPerResponse ?? 0,
      reviewEndsAt: null,
      reason: null,
      description: input.reason,
      evidence: [],
      resolution: null,
      publisherFormId: null,
      publisherEmail: null,
      respondentEmail: email,
    });
  });
}

/** Outcomes each kind accepts (ASSUMED `DISPUTE_OUTCOME_NOT_ALLOWED` otherwise). */
export const OUTCOMES_BY_KIND: Record<DisputeCaseKind, readonly DisputeCaseOutcome[]> = {
  ATTEMPT_DISPUTE: ["REFUND_TO_PUBLISHER", "RELEASE_TO_RESPONDENT"],
  MISSING_CODE: ["CREDIT_RESPONDENT", "CODE_LIMIT_RESET", "DISMISSED"],
  LOCKED_ATTEMPT: ["CODE_LIMIT_RESET", "DISMISSED"],
};

function notify(user: MockSessionUser | null, type: "ESCROW_RELEASED" | "REWARD_RELEASED" | "WARNING", message: string) {
  if (!user) return;
  updateNotifications(user.id, (items) => {
    items.unshift({ id: mockId(), type, message, isRead: false, createdAt: nowIso(), readAt: null });
  });
}

const userOf = (email: string | null) => (email ? findMockUserByEmail(email) : null);

/**
 * `resolveDisputeHold` for a dispute: the respondent's held points go to the
 * publisher's Khả dụng (`refund`, like backend `ledger.service.ts`) or to the
 * respondent's Khả dụng (`release`), with the backend journal key
 * `dispute-resolution:{caseId}:refund|release`. A refund is refused up front
 * when the hold does not cover it (`disputeHoldRefusal`); a release only posts
 * the respondent's side when it does (the Figma respondents #7F3A / #C21D are
 * not mock accounts). The survey's escrow and completions are not touched.
 */
function settleDispute(item: MockDisputeCase, outcome: DisputeCaseOutcome, note: string) {
  const publisher = userOf(item.publisherEmail);
  const respondent = userOf(item.respondentEmail);
  const title = item.survey.title;
  const code = item.respondent.code;
  const heldByRespondent = respondent !== null && walletOf(respondent).integrityHold >= item.amount;
  const base = { note: title, surveyId: item.survey.id, attemptId: item.attempt.id, releasesAt: null };

  if (outcome === "REFUND_TO_PUBLISHER") {
    recordMockFraudLog({
      userId: item.respondent.id,
      type: "COMPLAINT_UPHELD",
      survey: { id: item.survey.id, title },
      details: { caseId: item.id, refundedPoints: item.amount, note },
    });
    if (publisher) {
      updateWallet(publisher, (wallet) => {
        wallet.available += item.amount;
      });
      recordTransaction(publisher, {
        ...base,
        kind: "DISPUTE_RESOLUTION",
        amount: item.amount,
        status: "AVAILABLE",
        dispute: { caseId: item.id, action: "refund" },
      });
    }
    if (respondent && heldByRespondent) {
      updateWallet(respondent, (wallet) => {
        wallet.integrityHold -= item.amount;
      });
      recordTransaction(respondent, {
        ...base,
        kind: "DISPUTE_RESOLUTION",
        amount: -item.amount,
        status: "REVERSED",
        dispute: { caseId: item.id, action: "refund" },
      });
    }
    // Figma 14d (62:2117) publisher notification; the points land in Khả dụng like the backend.
    notify(
      publisher,
      "ESCROW_RELEASED",
      `Khiếu nại được chấp nhận — Lượt làm của ${code} trong “${title}” không hợp lệ. ${item.amount} điểm đã hoàn vào Khả dụng của bạn.`,
    );
    notify(respondent, "WARNING", `Lượt làm bị thu hồi điểm — Khiếu nại về “${title}” được chấp nhận. Lý do: ${note}`);
  } else {
    if (respondent && heldByRespondent) {
      updateWallet(respondent, (wallet) => {
        wallet.integrityHold -= item.amount;
        wallet.available += item.amount;
      });
      recordTransaction(respondent, {
        ...base,
        kind: "DISPUTE_RESOLUTION",
        amount: item.amount,
        status: "AVAILABLE",
        dispute: { caseId: item.id, action: "release" },
      });
    }
    notify(
      publisher,
      "WARNING",
      `Khiếu nại không được chấp nhận — Lượt làm của ${code} trong “${title}” hợp lệ. Lý do: ${note}`,
    );
    notify(respondent, "REWARD_RELEASED", `+${item.amount} điểm vào Khả dụng — Khiếu nại về “${title}” đã được xem xét.`);
  }

  // Keep the publisher's tracking view ("Khiếu nại" state of the attempt) in sync.
  if (item.publisherFormId) {
    const status = outcome === "REFUND_TO_PUBLISHER" ? "UPHELD" : "DISMISSED";
    updateTracking(item.publisherFormId, (tracking) => {
      const pending = tracking.pendingAttempts.find((attempt) => attempt.attemptId === item.attempt.id);
      if (!pending) return;
      pending.dispute = pending.dispute
        ? { ...pending.dispute, status }
        : { id: item.id, status, reason: item.reason ?? "OTHER", description: item.description ?? note, createdAt: item.createdAt };
    });
  }
}

/** Publisher form a missing-code reward is paid from (it shares the Khám phá survey id). */
function payingFormOf(item: MockDisputeCase) {
  return findPublisherForm(item.publisherFormId ?? item.survey.id);
}

/** `creditRespondentRefusal` on the live attempt, reward history, survey and escrow. */
function creditRefusal(item: MockDisputeCase): ResolveRefusal | null {
  const respondent = userOf(item.respondentEmail);
  const form = payingFormOf(item);
  const survey = findSurvey(item.survey.id);
  const publisher = form ? userOf(form.ownerEmail) : null;
  return creditRespondentRefusal({
    amount: item.amount,
    attemptStatus: findAttempt(item.attempt.id)?.status ?? item.attempt.status,
    alreadyRewarded: respondent !== null && rewardOutcomeOf(respondent, item.attempt.id) !== null,
    survey: form
      ? {
          closed: form.status !== "PUBLISHED",
          completedCompletions: form.completedCompletions,
          expectedCompletions: form.expectedCompletions,
        }
      : survey
        ? {
            closed: survey.status === "CLOSED",
            completedCompletions: survey.completedCompletions,
            expectedCompletions: survey.expectedCompletions,
          }
        : null,
    escrow: form ? { form: form.escrowLocked, wallet: publisher ? walletOf(publisher).escrow : null } : null,
  });
}

/** Missing code / locked attempt decisions (ASSUMED effects). */
function settleReport(item: MockDisputeCase, outcome: DisputeCaseOutcome, note: string) {
  const respondent = userOf(item.respondentEmail);
  const title = item.survey.title;
  if (outcome === "CREDIT_RESPONDENT") {
    if (respondent) {
      // The reward comes out of the survey escrow (checked by `creditRefusal`):
      // the form's lock and its owner's Ký quỹ ("Trả thưởng khảo sát").
      const form = payingFormOf(item);
      const publisher = form ? userOf(form.ownerEmail) : null;
      const reward = { amount: item.amount, surveyId: item.survey.id, attemptId: item.attempt.id, title };
      if (publisher) payRewardFromSurveyEscrow(publisher, reward);
      if (form) {
        updatePublisherForm(form.id, (draft) => {
          draft.escrowLocked -= item.amount;
          draft.completedCompletions += 1;
        });
      }
      updateAttempt(item.attempt.id, (attempt) => {
        attempt.status = "COMPLETED";
        attempt.submittedAt = nowIso();
      });
      markSurveyCompleted(respondent.id, respondent.email, item.survey.id);
      updateSurvey(item.survey.id, (survey) => {
        survey.completedCompletions = Math.min(survey.expectedCompletions, survey.completedCompletions + 1);
      });
      // Checked by an Admin: straight to Khả dụng (no second 48h review).
      creditSurveyReward(respondent, { ...reward, pending: false });
    }
    notify(respondent, "REWARD_RELEASED", `+${item.amount} điểm vào Khả dụng — Admin đã xác nhận lượt làm “${title}”.`);
  } else if (outcome === "CODE_LIMIT_RESET") {
    notify(
      respondent,
      "WARNING",
      `Đã mở lại giới hạn mã hoàn thành — Bạn có thể bắt đầu lại “${title}”. Ghi chú của Admin: ${note}`,
    );
  } else {
    notify(respondent, "WARNING", `Báo cáo về “${title}” chưa được chấp nhận — Lý do: ${note}`);
  }
}

export type ResolveCaseResult = { ok: true; item: MockDisputeCase } | ({ ok: false } & ResolveRefusal);

export function resolveMockDisputeCase(
  caseId: string,
  input: { outcome: DisputeCaseOutcome; note: string },
  admin: MockSessionUser,
): ResolveCaseResult {
  const item = findDisputeCase(caseId);
  if (!item) return { ok: false, status: 404, code: "DISPUTE_CASE_NOT_FOUND", message: "Dispute case not found." };
  if (item.status !== "OPEN") {
    return { ok: false, status: 409, code: "DISPUTE_CASE_ALREADY_RESOLVED", message: "Dispute case already resolved." };
  }
  if (!OUTCOMES_BY_KIND[item.kind].includes(input.outcome)) {
    return { ok: false, status: 400, code: "DISPUTE_OUTCOME_NOT_ALLOWED", message: "Outcome not allowed for this case." };
  }
  if (input.outcome === "CREDIT_RESPONDENT") {
    const refusal = creditRefusal(item);
    if (refusal) return { ok: false, ...refusal };
  }
  if (item.kind === "ATTEMPT_DISPUTE" && input.outcome === "REFUND_TO_PUBLISHER") {
    const respondent = userOf(item.respondentEmail);
    const refusal = disputeHoldRefusal(respondent ? walletOf(respondent).integrityHold : null, item.amount);
    if (refusal) return { ok: false, ...refusal };
  }
  if (item.kind === "ATTEMPT_DISPUTE") settleDispute(item, input.outcome, input.note);
  else settleReport(item, input.outcome, input.note);

  const resolved = disputeCases.update((all) => {
    const target = all.find((candidate) => candidate.id === caseId);
    if (!target) return;
    target.status = "RESOLVED";
    target.resolution = { outcome: input.outcome, note: input.note, resolvedAt: nowIso(), resolvedByName: admin.name };
  });
  return { ok: true, item: resolved.find((candidate) => candidate.id === caseId) ?? item };
}

/**
 * VERIFIED `POST /admin/completion-code-limits/reset` in the mock: the mock
 * only keeps per-attempt wrong-code counts (`accountWrongCodeCount` sums
 * them), so forgiving them zeroes those counts. The backend keeps the
 * attempts and FraudLog untouched and records a reset row instead.
 */
export function resetMockCodeLimit(respondentId: string, formVersionId: string): number {
  const forgiven = attempts
    .get()
    .filter((attempt) => attempt.userId === respondentId && attempt.formVersionId === formVersionId)
    .reduce((sum, attempt) => sum + attempt.wrongCodeCount, 0);
  if (forgiven > 0) {
    attempts.update((all) => {
      for (const attempt of all) {
        if (attempt.userId === respondentId && attempt.formVersionId === formVersionId) attempt.wrongCodeCount = 0;
      }
    });
  }
  return forgiven;
}
