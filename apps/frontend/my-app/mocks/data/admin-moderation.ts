import { calculateEscrowCost, type NotificationDto, type SurveyModerationDecisionDto } from "@rescom/schemas";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import { findMockUserByEmail, type MockSessionUser } from "../db/session";
import { createdFormExtras } from "../handlers/forms-create";
import { toMockUuid } from "./auth";
import { refundSurveyEscrow } from "./economy";
import { findFormDraft, nextUpdatedAt, saveFormDraft, type MockFormDraft } from "./form-drafts";
import {
  PUBLISHER_FORM_IDS,
  addPublisherForm,
  findPublisherForm,
  publisherForms,
  updatePublisherForm,
  type MockPublisherForm,
} from "./forms";
import { updateNotifications } from "./notifications";
import { surveys, type MockSurvey } from "./surveys";
import { FRAUD_SEED_USER_IDS, fraudSummaryOf } from "./admin-fraud-log";

/**
 * Phase 6 · Duyệt khảo sát (Figma 11a 62:3406, 11a' 62:2868). The queue is
 * every `publisherForms` row in MODERATION_QUEUE (peer-owned data, Phase 5
 * submissions land there). Review-only fields the peer rows lack live here,
 * keyed by form id. Seed = Figma 11a: the peer's "Hành vi tiêu dùng của sinh
 * viên Marketing" (owner = demo publisher, so decisions show up in "Khảo sát
 * của tôi") plus the two other queued surveys, added idempotently.
 */

const DAY_MS = 86_400_000;

export const MODERATION_SEED_FORM_IDS = {
  canteenSatisfaction: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f11",
  freshmanExercise: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f12",
} as const;

interface ReviewExtras {
  description?: string | null;
  targeting?: MockTargeting | null;
  /** Figma "Hạn": days after submission when the form row has no `deadlineAt`. */
  collectionDays?: number;
  /** Owners that are not demo accounts (Figma names). */
  publisherName?: string;
  topic?: string;
}

type MockTargeting = {
  ageRange?: { min: number; max: number };
  genders?: ("MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY")[];
  fieldOfStudy?: string[];
  occupations?: string[];
  locations?: string[];
  schools?: string[];
};

const FPT_DA_NANG = "Trường Đại học FPT – Đà Nẵng";

const REVIEW_EXTRAS: Record<string, ReviewExtras> = {
  [PUBLISHER_FORM_IDS.consumerMarketing]: {
    description: "Khảo sát phục vụ đồ án tốt nghiệp ngành Marketing. Câu trả lời được ẩn danh.",
    targeting: {
      ageRange: { min: 18, max: 25 },
      fieldOfStudy: ["Marketing & Truyền thông", "Kinh tế & Quản trị kinh doanh"],
      schools: [FPT_DA_NANG],
      locations: ["Đà Nẵng"],
    },
    collectionDays: 14,
    topic: "Marketing",
  },
  [MODERATION_SEED_FORM_IDS.canteenSatisfaction]: {
    description: "Ý kiến của sinh viên về món ăn, giá cả và vệ sinh ở căng tin cơ sở Đà Nẵng.",
    targeting: { schools: [FPT_DA_NANG] },
    collectionDays: 7,
    publisherName: "Phạm Quân",
    topic: "Đời sống",
  },
  [MODERATION_SEED_FORM_IDS.freshmanExercise]: {
    description: "Tần suất và hình thức tập thể dục của sinh viên năm nhất. Mất khoảng 7 phút.",
    targeting: { ageRange: { min: 18, max: 20 } },
    collectionDays: 14,
    publisherName: "Võ Hà",
    topic: "Sức khỏe",
  },
};

function seedForm(
  id: string,
  input: Pick<
    MockPublisherForm,
    "ownerEmail" | "title" | "type" | "rewardPerResponse" | "expectedCompletions" | "estimatedEffortSeconds" | "externalUrl"
  > & { submittedHoursAgo: number; questionCount?: number },
): MockPublisherForm {
  const { submittedHoursAgo, questionCount, ...rest } = input;
  const escrow = calculateEscrowCost({
    type: rest.type,
    expectedCompletions: rest.expectedCompletions,
    rewardPerResponse: rest.rewardPerResponse,
  }).effectiveCost;
  return {
    id,
    ...rest,
    status: "MODERATION_QUEUE",
    completedCompletions: 0,
    escrowLocked: escrow,
    createdAt: hoursAgo(submittedHoursAgo + 0.5),
    submittedAt: hoursAgo(submittedHoursAgo),
    publishedAt: null,
    deadlineAt: null,
    closedAt: null,
    hiddenFromMarketplace: true,
    rejection: null,
    versionNumber: 1,
    questionCount: questionCount ?? null,
  };
}

/** Figma 11a times 19:30 / 20:02 / 20:15: same spacing after the peer's "2.5 h ago". */
function extraSeed(): MockPublisherForm[] {
  return [
    seedForm(MODERATION_SEED_FORM_IDS.canteenSatisfaction, {
      ownerEmail: "quan.pham@fpt.edu.vn",
      title: "Mức độ hài lòng với căng tin",
      type: "INTERNAL",
      rewardPerResponse: 8,
      expectedCompletions: 30,
      estimatedEffortSeconds: 4 * 60,
      externalUrl: null,
      submittedHoursAgo: 2.5 - 32 / 60,
      questionCount: 8,
    }),
    seedForm(MODERATION_SEED_FORM_IDS.freshmanExercise, {
      ownerEmail: "ha.vo@fpt.edu.vn",
      title: "Thói quen tập thể dục của sinh viên năm nhất",
      type: "EXTERNAL",
      rewardPerResponse: 12,
      expectedCompletions: 20,
      estimatedEffortSeconds: 7 * 60,
      externalUrl: "https://docs.google.com/forms/d/e/mock-freshman-exercise/viewform",
      submittedHoursAgo: 2.5 - 45 / 60,
    }),
  ];
}

/** Adds the Figma queue rows missing from the peer data (idempotent, by id). */
export function ensureModerationSeed(): void {
  for (const form of extraSeed()) {
    if (!findPublisherForm(form.id)) addPublisherForm(form);
  }
}

/** Sidebar badge "Duyệt khảo sát" (`GET /admin/queue-counts` → `surveys`). */
export function moderationQueueCount(): number {
  ensureModerationSeed();
  return publisherForms.get().filter((form) => form.status === "MODERATION_QUEUE").length;
}

/** Queue, oldest submission first (backend `listQueue`). */
export function moderationQueue(): MockPublisherForm[] {
  ensureModerationSeed();
  return publisherForms
    .get()
    .filter((form) => form.status === "MODERATION_QUEUE")
    .sort((a, b) => Date.parse(a.submittedAt ?? a.createdAt) - Date.parse(b.submittedAt ?? b.createdAt));
}

/** Stable FormVersion id of a form's current version. */
export function formVersionIdOf(form: MockPublisherForm): string {
  return toMockUuid(`form-version:${form.id}:${form.versionNumber}`);
}

function extrasOf(form: MockPublisherForm): ReviewExtras {
  const created = createdFormExtras.get()[form.id];
  const own = REVIEW_EXTRAS[form.id] ?? {};
  return {
    ...own,
    description: created?.description ?? own.description ?? null,
    targeting: created?.targeting ?? own.targeting ?? null,
    topic: created?.topic ?? own.topic,
  };
}

function ownerOf(form: MockPublisherForm): MockSessionUser | null {
  return findMockUserByEmail(form.ownerEmail);
}

function deadlineOf(form: MockPublisherForm, extras: ReviewExtras): string | null {
  if (form.deadlineAt) return form.deadlineAt;
  if (!extras.collectionDays || !form.submittedAt) return null;
  return new Date(Date.parse(form.submittedAt) + extras.collectionDays * DAY_MS).toISOString();
}

/** Backend `toQueueItem` + the ASSUMED display extensions (`lib/admin/moderation-service.ts`). */
export function toModerationQueueItem(form: MockPublisherForm) {
  const extras = extrasOf(form);
  const owner = ownerOf(form);
  const publisherId =
    owner?.id ??
    (form.ownerEmail === "quan.pham@fpt.edu.vn" ? FRAUD_SEED_USER_IDS.quan : toMockUuid(form.ownerEmail));
  const cost = calculateEscrowCost({
    type: form.type,
    expectedCompletions: form.expectedCompletions,
    rewardPerResponse: form.rewardPerResponse,
  });
  const targeting = extras.targeting && Object.keys(extras.targeting).length > 0 ? extras.targeting : null;
  return {
    formId: form.id,
    formVersionId: formVersionIdOf(form),
    versionNumber: form.versionNumber,
    title: form.title,
    description: extras.description ?? null,
    type: form.type,
    status: form.status,
    publisherId,
    publisherEmail: form.ownerEmail,
    rewardPerResponse: form.rewardPerResponse,
    expectedCompletions: form.expectedCompletions,
    effectiveRewardPerResponse: cost.effectiveRewardPerResponse,
    escrowAmount: cost.effectiveCost,
    estimatedEffortSeconds: form.estimatedEffortSeconds,
    blocksCount: form.questionCount ?? 0,
    externalUrl: form.externalUrl,
    targetingJson: targeting,
    targetingInvalid: false,
    isResubmission: form.versionNumber > 1 && form.publishedAt !== null,
    submittedAt: form.submittedAt ?? form.createdAt,
    publisherName: owner?.name ?? extras.publisherName ?? null,
    // ASSUMED response extension, composed from the same append-only FraudLog store.
    publisherFraudLogCount: fraudSummaryOf(publisherId).count14d,
    deadlineAt: deadlineOf(form, extras),
  };
}

/** Decisions by FormVersion id (backend `SurveyModerationDecision`, one per version). */
export const moderationDecisions = createCollection<Record<string, SurveyModerationDecisionDto>>(
  "admin-moderation-decisions",
  () => ({}),
);

export function toModerationPreview(form: MockPublisherForm) {
  const item = toModerationQueueItem(form);
  const queued = form.status === "MODERATION_QUEUE";
  return {
    ...item,
    schemaJson: { metadata: { expectedEffortSeconds: form.estimatedEffortSeconds } },
    decision: moderationDecisions.get()[item.formVersionId] ?? null,
    // The survey's own escrow (the mock wallet has no per-survey journals).
    escrowHeld: queued ? form.escrowLocked : null,
    fundingShortfall: queued ? Math.max(0, item.escrowAmount - form.escrowLocked) : null,
  };
}

/**
 * Puts an approved form into the Khám phá catalog (`surveys.ts`, same id):
 * a new MockSurvey, or the existing one updated to the new version.
 */
export function publishPublisherFormToCatalog(form: MockPublisherForm): MockSurvey {
  const extras = extrasOf(form);
  const owner = ownerOf(form);
  const entry: MockSurvey = {
    id: form.id,
    formVersionId: formVersionIdOf(form),
    versionNumber: form.versionNumber,
    title: form.title,
    description: extras.description ?? null,
    type: form.type,
    status: "PUBLISHED",
    rewardPerResponse: form.rewardPerResponse,
    expectedCompletions: form.expectedCompletions,
    completedCompletions: form.completedCompletions,
    estimatedEffortSeconds: form.estimatedEffortSeconds,
    topic: extras.topic ?? "Khác",
    publisherName: owner?.name ?? extras.publisherName ?? form.ownerEmail,
    externalUrl: form.externalUrl,
    publishedAt: form.publishedAt ?? nowIso(),
  };
  surveys.update((all) => {
    const index = all.findIndex((survey) => survey.id === form.id);
    if (index >= 0) all[index] = { ...all[index], ...entry, completedCompletions: all[index].completedCompletions };
    else all.unshift(entry);
  });
  return entry;
}

function notifyOwner(owner: MockSessionUser | null, type: NotificationDto["type"], message: string): void {
  if (!owner) return;
  updateNotifications(owner.id, (items) => {
    items.unshift({ id: mockId(), type, message, isRead: false, createdAt: nowIso(), readAt: null });
  });
}

function saveDecision(
  form: MockPublisherForm,
  admin: MockSessionUser,
  input: Pick<SurveyModerationDecisionDto, "outcome" | "reason" | "refundAmount" | "refundJournalId">,
): SurveyModerationDecisionDto {
  const decision: SurveyModerationDecisionDto = {
    id: mockId(),
    formId: form.id,
    formVersionId: formVersionIdOf(form),
    versionNumber: form.versionNumber,
    adminId: admin.id,
    correlationId: mockId(),
    decidedAt: nowIso(),
    ...input,
  };
  moderationDecisions.update((all) => {
    all[decision.formVersionId] = decision;
  });
  return decision;
}

/**
 * A Form Builder survey also lives in `formDrafts`, whose handler answers
 * `GET /forms/:id` first: keep its status in step with the decision.
 */
function syncBuilderDraft(formId: string, patch: Pick<MockFormDraft, "status"> & Partial<MockFormDraft>): void {
  const draft = findFormDraft(formId);
  if (draft) saveFormDraft({ ...draft, ...patch, updatedAt: nextUpdatedAt(draft.updatedAt) });
}

/** `MODERATION_QUEUE → PUBLISHED`, catalog entry, SURVEY_APPROVED to the owner. */
export function approveModeration(form: MockPublisherForm, admin: MockSessionUser) {
  const extras = extrasOf(form);
  const published =
    updatePublisherForm(form.id, (draft) => {
      draft.status = "PUBLISHED";
      draft.publishedAt = nowIso();
      draft.hiddenFromMarketplace = false;
      draft.deadlineAt = deadlineOf(draft, extras);
    }) ?? form;
  syncBuilderDraft(form.id, { status: "PUBLISHED" });
  publishPublisherFormToCatalog(published);
  const decision = saveDecision(published, admin, {
    outcome: "APPROVED",
    reason: null,
    refundAmount: 0,
    refundJournalId: null,
  });
  notifyOwner(
    ownerOf(published),
    "SURVEY_APPROVED",
    `Khảo sát đã được duyệt — “${published.title}” đã lên Khám phá và bắt đầu nhận câu trả lời.`,
  );
  return { decision, form: published };
}

/**
 * Backend `rejectPublication`: `MODERATION_QUEUE → CLOSED` with `closeKind`
 * MODERATION (final, never reopenable), the escrow back to the owner's Khả
 * dụng, SURVEY_REJECTED with the reason. `rejection` keeps the reason and the
 * points actually refunded (the wallet helper caps at the wallet's escrow and
 * refunds nothing without an account) for the ASSUMED publisher fields.
 */
export function rejectModeration(form: MockPublisherForm, admin: MockSessionUser, reason: string) {
  const owner = ownerOf(form);
  const refundRow =
    owner && form.escrowLocked > 0
      ? refundSurveyEscrow(owner, { amount: form.escrowLocked, surveyId: form.id, title: form.title })
      : null;
  const refundedPoints = refundRow ? Math.abs(refundRow.amount) : 0;
  const rejectedAt = nowIso();
  const rejected =
    updatePublisherForm(form.id, (draft) => {
      draft.status = "CLOSED";
      draft.closeKind = "MODERATION";
      draft.closedAt = rejectedAt;
      draft.rejection = { reason, refundedPoints, rejectedAt };
      draft.escrowLocked = 0;
      draft.hiddenFromMarketplace = true;
      draft.pausedAt = null;
    }) ?? form;
  syncBuilderDraft(form.id, { status: "CLOSED", escrowLocked: 0 });
  const decision = saveDecision(rejected, admin, {
    outcome: "REJECTED",
    reason,
    refundAmount: refundedPoints,
    refundJournalId: refundRow?.id ?? null,
  });
  const refund = refundedPoints > 0 ? ` Đã hoàn ${refundedPoints} điểm.` : "";
  const sentence = reason.replace(/[.\s]+$/, "");
  notifyOwner(owner, "SURVEY_REJECTED", `Khảo sát bị từ chối — “${form.title}”: ${sentence}.${refund}`);
  return { decision, form: rejected };
}

/** Backend `toResult`. */
export function toModerationResult(
  decision: SurveyModerationDecisionDto,
  form: MockPublisherForm | undefined,
  replayed: boolean,
) {
  return {
    decision,
    form: {
      id: decision.formId,
      status: form?.status ?? (decision.outcome === "APPROVED" ? "PUBLISHED" : "CLOSED"),
      currentVersionId: form ? formVersionIdOf(form) : decision.formVersionId,
      isPublished: form ? form.publishedAt !== null && form.status === "PUBLISHED" : decision.outcome === "APPROVED",
      publishedAt: form?.publishedAt ?? null,
    },
    replayed,
  };
}
