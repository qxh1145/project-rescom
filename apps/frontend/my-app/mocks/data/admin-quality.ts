import type { FormBlock, NotificationDto } from "@rescom/schemas";
import type { QualityDecisionCommand, QualityDecisionResult, QualityReview } from "@/lib/admin/quality-service";
import { loadStore } from "../legacy/store";
import type { MockSessionUser } from "../db/session";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import { findAttempt, type MockAttempt } from "./attempts";
import { toMockUuid } from "./auth";
import { holdSurveyReward, rewardOutcomeOf, settleHeldSurveyReward, transactions, transactionsOf } from "./economy";
import { reliabilityOf } from "./integrity";
import { updateNotifications } from "./notifications";
import { surveyContentOf } from "./survey-content";
import { findSurvey, SURVEY_IDS } from "./surveys";

/**
 * Admin "Xem xét chất lượng" (Figma 17b, 63:3276) — ASSUMED routes, see
 * `lib/admin/quality-service.ts`.
 *
 * The queue holds every in-Rescom reward still in INTEGRITY_HOLD:
 * - the 3 Figma items (#9A2E, #41C7, #E07B), owned by seed respondents whose
 *   wallets get the matching hold the first time the queue is read;
 * - holds created by the respondent flow (`?msw=integrity-hold`, Figma 17c),
 *   picked up from the shared wallet history on every read.
 * A decision moves the respondent's points like the backend
 * (`settleHeldSurveyReward`) and notifies them.
 */

interface MockReviewRespondent {
  id: string;
  email: string;
  name: string;
}

export interface MockQualityReview extends QualityReview {
  respondentUser: MockReviewRespondent;
  status: "OPEN" | "DECIDED";
  decision: (QualityDecisionResult & { note: string; decidedBy: string }) | null;
}

// --- Answers ---------------------------------------------------------------

type AnswerValue = string | number | string[] | null | undefined;

function formatAnswer(value: AnswerValue): string {
  if (value === null || value === undefined || value === "") return "(bỏ trống)";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "(bỏ trống)";
  return String(value);
}

/** Seed answers: straight-lined scales (3), first options — matches the Figma signals. */
function sampleAnswer(block: FormBlock): AnswerValue {
  if ("options" in block && Array.isArray(block.options)) {
    const labels = block.options.map((option) => option.label);
    return block.type === "multiple_choice" ? labels.slice(0, 2) : labels[0];
  }
  switch (block.type) {
    case "linear_scale":
    case "rating":
      return 3;
    case "number":
      return 500;
    case "date":
      return "2026-09-01";
    default:
      return "";
  }
}

function answersOf(surveyId: string, values: (block: FormBlock) => AnswerValue): QualityReview["answers"] {
  const blocks = surveyContentOf(surveyId)?.blocks ?? [];
  return blocks.map((block) => ({ question: block.title, answer: formatAnswer(values(block)) }));
}

// --- Seed (Figma 17b) ------------------------------------------------------

/** Seed respondents: not demo accounts, so the demo wallets stay as drawn in Figma 7. */
const SEED_RESPONDENTS = {
  r9a2e: { id: "b7e1c9a0-9a2e-4c11-8d3e-00000000a9a2", email: "an.pham23@fpt.edu.vn", name: "Phạm Thu An" },
  r41c7: { id: "b7e1c9a0-41c7-4c11-8d3e-0000000041c7", email: "khoa.tran22@fpt.edu.vn", name: "Trần Đăng Khoa" },
  re07b: { id: "b7e1c9a0-e07b-4c11-8d3e-00000000e07b", email: "vy.ngo24@fpt.edu.vn", name: "Ngô Tường Vy" },
} as const;

function seedReview(input: {
  reference: string;
  responseId: string;
  attemptId: string;
  surveyId: string;
  submittedHoursAgo: number;
  respondent: MockReviewRespondent;
  qualityScore: number;
  confidence: QualityReview["confidence"];
  coverage: number;
  reasons: QualityReview["reasons"];
  respondentContext: QualityReview["respondent"];
  surveyStatus: QualityReview["surveyQuality"]["status"];
}): MockQualityReview {
  const survey = findSurvey(input.surveyId);
  const submittedAt = hoursAgo(input.submittedHoursAgo);
  return {
    responseId: input.responseId,
    attemptId: input.attemptId,
    reference: input.reference,
    surveyId: input.surveyId,
    surveyTitle: survey?.title ?? "Khảo sát",
    formVersionNumber: survey?.versionNumber ?? 1,
    submittedAt,
    heldPoints: survey?.rewardPerResponse ?? 12,
    reviewDeadline: null,
    qualityScore: input.qualityScore,
    confidence: input.confidence,
    coverage: input.coverage,
    policyVersion: "integrity-v1",
    reasons: input.reasons,
    respondent: input.respondentContext,
    surveyQuality: { version: survey?.versionNumber ?? 1, status: input.surveyStatus },
    answers: answersOf(input.surveyId, sampleAnswer),
    respondentUser: input.respondent,
    status: "OPEN",
    decision: null,
  };
}

function seed(): MockQualityReview[] {
  return [
    seedReview({
      reference: "9A2E",
      responseId: "a9a2e000-17b0-4e5f-9c1d-000000009a2e",
      attemptId: "a9a2e000-17b0-4e5f-9c1d-10000000a9a2",
      surveyId: SURVEY_IDS.onlineShopping,
      submittedHoursAgo: 2,
      respondent: SEED_RESPONDENTS.r9a2e,
      qualityScore: 34,
      confidence: "MEDIUM",
      coverage: 0.8,
      reasons: [
        { code: "FAST_COMPLETION", params: { durationSeconds: 100, expectedSeconds: 300 } },
        { code: "ATTENTION_CHECK_FAILED", params: { questionNumber: 6 } },
        { code: "STRAIGHT_LINING", params: { scaleCount: 6 } },
      ],
      respondentContext: { reliabilityLevel: "FORMING", priorAssessed: 3, priorPassed: 3 },
      surveyStatus: "INSUFFICIENT_DATA",
    }),
    seedReview({
      reference: "41C7",
      responseId: "a41c7000-17b0-4e5f-9c1d-0000000041c7",
      attemptId: "a41c7000-17b0-4e5f-9c1d-10000000041c",
      surveyId: SURVEY_IDS.onlineShopping,
      submittedHoursAgo: 3.4,
      respondent: SEED_RESPONDENTS.r41c7,
      qualityScore: 46,
      confidence: "LOW",
      coverage: 0.7,
      reasons: [
        { code: "FAST_COMPLETION", params: { durationSeconds: 130, expectedSeconds: 300 } },
        { code: "STRAIGHT_LINING", params: { scaleCount: 6 } },
      ],
      respondentContext: { reliabilityLevel: "FORMING", priorAssessed: 1, priorPassed: 1 },
      surveyStatus: "INSUFFICIENT_DATA",
    }),
    seedReview({
      reference: "E07B",
      responseId: "ae07b000-17b0-4e5f-9c1d-00000000e07b",
      attemptId: "ae07b000-17b0-4e5f-9c1d-10000000e07b",
      surveyId: SURVEY_IDS.studyStressSleep,
      submittedHoursAgo: 20.8,
      respondent: SEED_RESPONDENTS.re07b,
      qualityScore: 41,
      confidence: "LOW",
      coverage: 0.6,
      reasons: [
        { code: "ATTENTION_CHECK_FAILED", params: { questionNumber: 4 } },
        { code: "ANSWER_INCONSISTENCY", params: { firstQuestion: 2, secondQuestion: 7 } },
      ],
      respondentContext: { reliabilityLevel: "GOOD", priorAssessed: 8, priorPassed: 7 },
      surveyStatus: "READY",
    }),
  ];
}

export const qualityReviews = createCollection<MockQualityReview[]>("admin-quality-reviews", seed);

function sessionUserOf(respondent: MockReviewRespondent): MockSessionUser {
  return { ...respondent, role: "USER", profileComplete: true };
}

/** A legacy-store user by API id (same mapping as `getMockSessionUser`). */
function findStoreUser(userId: string): MockSessionUser | null {
  const user = Object.values(loadStore().users).find((candidate) => toMockUuid(candidate.id) === userId);
  if (!user) return null;
  return {
    id: userId,
    email: user.email,
    name: user.name,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    profileComplete: user.isOnboarded,
  };
}

// --- Respondent-flow holds (17c) -------------------------------------------

/** "9A2E"-style reference from a UUID. */
function referenceOf(id: string): string {
  return id.replace(/-/g, "").slice(-4).toUpperCase();
}

/**
 * MOCK-ONLY signals for a hold made by the respondent flow: the mock has no
 * integrity engine, so the review shows the ENFORCED policy as the reason,
 * plus FAST_COMPLETION when the attempt took under half the expected time.
 */
function reviewFromHold(user: MockSessionUser, attempt: MockAttempt | undefined, row: {
  attemptId: string;
  surveyId: string | null;
  amount: number;
  note: string;
  createdAt: string;
}): MockQualityReview {
  const surveyId = row.surveyId ?? attempt?.surveyId ?? "";
  const survey = findSurvey(surveyId);
  const expectedSeconds = surveyContentOf(surveyId)?.metadata.expectedEffortSeconds ?? survey?.estimatedEffortSeconds ?? 0;
  const submittedAt = attempt?.submittedAt ?? row.createdAt;
  const durationSeconds = attempt ? Math.round((Date.parse(submittedAt) - Date.parse(attempt.startedAt)) / 1000) : null;
  const fast = durationSeconds !== null && expectedSeconds > 0 && durationSeconds < expectedSeconds / 2;
  const reliability = reliabilityOf(user);
  const prior = reliability.recent.filter((item) => item.source === "INTERNAL" && item.attemptId !== row.attemptId);
  const responseId = attempt?.responseId ?? row.attemptId;
  return {
    responseId,
    attemptId: row.attemptId,
    reference: referenceOf(responseId),
    surveyId,
    surveyTitle: survey?.title ?? row.note,
    formVersionNumber: attempt?.versionNumber ?? survey?.versionNumber ?? 1,
    submittedAt,
    heldPoints: row.amount,
    reviewDeadline: null,
    qualityScore: fast ? 38 : 55,
    confidence: "LOW",
    coverage: 0.6,
    policyVersion: "integrity-v1",
    reasons: [
      ...(fast && durationSeconds !== null ? [{ code: "FAST_COMPLETION", params: { durationSeconds, expectedSeconds } }] : []),
      { code: "ENFORCED_POLICY", params: {} },
    ],
    respondent: {
      reliabilityLevel: reliability.level,
      priorAssessed: prior.length,
      priorPassed: prior.filter((item) => item.result === "PASSED").length,
    },
    surveyQuality: { version: attempt?.versionNumber ?? 1, status: "INSUFFICIENT_DATA" },
    answers: answersOf(surveyId, (block) => (attempt?.answers[block.id] as AnswerValue) ?? null),
    respondentUser: { id: user.id, email: user.email, name: user.name },
    status: "OPEN",
    decision: null,
  };
}

/** Adds the held rewards of the respondent flow that are not in the queue yet. */
function syncRespondentHolds(): void {
  const known = new Set(qualityReviews.get().map((review) => review.attemptId));
  const found: MockQualityReview[] = [];
  for (const [userId, rows] of Object.entries(transactions.get())) {
    for (const row of rows) {
      if (row.kind !== "SURVEY_REWARD" || row.status !== "HELD" || !row.attemptId || known.has(row.attemptId)) continue;
      const user = findStoreUser(userId);
      if (!user) continue;
      known.add(row.attemptId);
      found.push(reviewFromHold(user, findAttempt(row.attemptId), { ...row, attemptId: row.attemptId }));
    }
  }
  if (found.length > 0) {
    qualityReviews.update((all) => {
      all.push(...found);
    });
  }
}

const SEED_RESPONDENT_IDS = new Set<string>(Object.values(SEED_RESPONDENTS).map((respondent) => respondent.id));

/** Seed respondents get the hold Figma shows (once: only while their wallet has no reward row for it). */
function ensureSeedHolds(): void {
  for (const review of qualityReviews.get()) {
    if (review.status !== "OPEN" || !SEED_RESPONDENT_IDS.has(review.respondentUser.id)) continue;
    const user = sessionUserOf(review.respondentUser);
    const hasRow = transactionsOf(user).some((row) => row.kind === "SURVEY_REWARD" && row.attemptId === review.attemptId);
    if (hasRow) continue;
    holdSurveyReward(user, {
      amount: review.heldPoints,
      surveyId: review.surveyId,
      attemptId: review.attemptId,
      title: review.surveyTitle,
    });
  }
}

/**
 * Open reviews whose points are still held, newest answer first (Figma
 * order). Syncs new holds first; a hold settled elsewhere drops out.
 */
export function openQualityReviews(): MockQualityReview[] {
  syncRespondentHolds();
  ensureSeedHolds();
  return qualityReviews
    .get()
    .filter(
      (review) =>
        review.status === "OPEN" &&
        rewardOutcomeOf(sessionUserOf(review.respondentUser), review.attemptId)?.status === "HELD_IN_INTEGRITY",
    )
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

/** Sidebar badge "Xét chất lượng" (`GET /admin/queue-counts` → `quality`). */
export function qualityQueueCount(): number {
  return openQualityReviews().length;
}

/** API shape (drops the mock-only fields). */
export function toQualityReviewDto(review: MockQualityReview): QualityReview {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- strip mock-only fields
  const { respondentUser, status, decision, ...dto } = review;
  return dto;
}

// --- Decision --------------------------------------------------------------

function notify(userId: string, type: NotificationDto["type"], message: string): void {
  updateNotifications(userId, (items) => {
    items.unshift({ id: mockId(), type, message, isRead: false, createdAt: nowIso(), readAt: null });
  });
}

const NOTE_IN_MESSAGE_MAX = 200;

export type QualityDecisionOutcome =
  | { ok: true; result: QualityDecisionResult }
  | { ok: false; error: "NOT_FOUND" | "ALREADY_DECIDED" | "HOLD_NOT_FOUND" };

/**
 * `POST /admin/quality-reviews/:responseId/decision`: ACCEPT /
 * INSUFFICIENT_EVIDENCE release the hold to Khả dụng, REJECT reverses it.
 */
export function decideQualityReview(
  responseId: string,
  command: QualityDecisionCommand,
  admin: MockSessionUser,
): QualityDecisionOutcome {
  const review = qualityReviews.get().find((item) => item.responseId === responseId);
  if (!review) return { ok: false, error: "NOT_FOUND" };
  if (review.status !== "OPEN") return { ok: false, error: "ALREADY_DECIDED" };

  const respondent = sessionUserOf(review.respondentUser);
  const reject = command.decision === "REJECT";
  const settled = settleHeldSurveyReward(respondent, {
    attemptId: review.attemptId,
    outcome: reject ? "REVERSE" : "RELEASE",
  });
  if (!settled) return { ok: false, error: "HOLD_NOT_FOUND" };

  const result: QualityDecisionResult = {
    responseId,
    decision: command.decision,
    outcome: reject ? "REVERSED" : "RELEASED",
    points: settled.amount,
    decidedAt: nowIso(),
  };
  qualityReviews.update((all) => {
    const target = all.find((item) => item.responseId === responseId);
    if (!target) return;
    target.status = "DECIDED";
    target.decision = { ...result, note: command.note, decidedBy: admin.id };
  });

  const title = review.surveyTitle;
  if (reject) {
    const reason =
      command.note.length > NOTE_IN_MESSAGE_MAX ? `${command.note.slice(0, NOTE_IN_MESSAGE_MAX)}…` : command.note;
    notify(
      respondent.id,
      "WARNING",
      `Câu trả lời chưa được tính điểm — Câu trả lời cho “${title}” chưa đạt yêu cầu chất lượng: ${reason}. ${settled.amount} điểm đang giữ đã được hoàn cho khảo sát. Bạn có thể khiếu nại nếu thấy chưa đúng.`,
    );
  } else {
    notify(respondent.id, "REWARD_RELEASED", `+${settled.amount} điểm vào Khả dụng — Câu trả lời cho “${title}” đã được xét xong.`);
    if (settled.activated) {
      notify(
        respondent.id,
        "ACCOUNT_ACTIVATED",
        "Tài khoản đã kích hoạt — 100 điểm khởi đầu đã mở khoá. Bạn có thể dùng để đăng khảo sát.",
      );
    }
  }
  return { ok: true, result };
}
