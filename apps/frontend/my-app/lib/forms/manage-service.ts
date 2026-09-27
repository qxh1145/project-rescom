import { z } from "zod";
import {
  formCloseKindEnum,
  formStatusEnum,
  formTypeEnum,
  surveyFeedbackIssueTagSchema,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";

/**
 * Publisher survey management (Figma page 10: "Khảo sát của tôi", 10a
 * tracking, 10b reopen, 10c complaint) and the shared survey header of
 * `/forms/[id]/*`.
 *
 * Every ASSUMED field is optional with a neutral default, so the VERIFIED
 * backend response still parses before the backend adds them.
 */

const nullableIso = z.string().nullable().default(null);
const count = z.number().int().nonnegative();

/** ASSUMED API CONTRACT extensions shared by `GET /forms` items and `GET /forms/:id`. */
const managementExtensions = {
  /** Validated completions so far (Figma "6/10"). */
  completedCompletions: count.default(0),
  /** Points still locked in this survey's Escrow ("ký quỹ 100"). */
  escrowLocked: count.default(0),
  submittedAt: nullableIso,
  publishedAt: nullableIso,
  /** Collection deadline ("hạn 05/10 · còn 9 ngày"). */
  deadlineAt: nullableIso,
  closedAt: nullableIso,
  /** Hidden from Khám phá ("đã ẩn khỏi Khám phá"). */
  hiddenFromMarketplace: z.boolean().default(false),
  /** "Tạm dừng" (Figma 10a) — no backend state exists yet. */
  pausedAt: nullableIso,
  /** Admin rejection of the submitted version ("Bị từ chối · Đã hoàn 120 điểm"). */
  rejection: z
    .object({ reason: z.string(), refundedPoints: count, rejectedAt: z.string().nullable().default(null) })
    .nullable()
    .default(null),
};

/**
 * VERIFIED `FormSummaryDto` (`GET /forms` → `forms.service.ts#listForms`)
 * + ASSUMED management fields (incl. `closeKind`, which only the detail DTO has).
 */
export const publisherFormSummarySchema = z.object({
  id: z.string().min(1),
  publisherId: z.string(),
  type: formTypeEnum,
  status: formStatusEnum,
  title: z.string(),
  description: z.string().nullable().optional(),
  rewardPerResponse: count,
  expectedCompletions: count,
  estimatedDurationMinutes: z.number().nullable().optional(),
  latestVersionNumber: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  closeKind: formCloseKindEnum.nullable().default(null),
  ...managementExtensions,
});
export type PublisherFormSummary = z.infer<typeof publisherFormSummarySchema>;

export const publisherFormListSchema = z.object({
  forms: z.array(publisherFormSummarySchema),
  total: count,
  page: z.number().int(),
  limit: z.number().int(),
  totalPages: z.number().int(),
});
export type PublisherFormList = z.infer<typeof publisherFormListSchema>;

/**
 * VERIFIED `FormDetailDto` (`GET /forms/:id` → `forms.service.ts#getFormById`,
 * owner or Admin) + ASSUMED management fields and header facts.
 */
export const publisherFormSchema = z.object({
  id: z.string().min(1),
  publisherId: z.string(),
  type: formTypeEnum,
  status: formStatusEnum,
  title: z.string(),
  description: z.string().nullable().optional(),
  rewardPerResponse: count,
  expectedCompletions: count,
  estimatedDurationMinutes: z.number().nullable().optional(),
  closeKind: formCloseKindEnum.nullable().default(null),
  currentVersion: z
    .object({
      id: z.string(),
      versionNumber: z.number().int(),
      externalUrl: z.string().nullable().optional(),
      schemaJson: z.object({ blocks: z.array(z.unknown()).optional() }).passthrough().nullable().optional(),
    })
    .passthrough(),
  createdAt: z.string(),
  updatedAt: z.string(),
  ...managementExtensions,
  /** ASSUMED: questions of the current version (Figma 17 "8 câu hỏi"); falls back to the block count. */
  questionCount: count.nullable().default(null),
  /** ASSUMED: targeting summary (Figma 10a "Marketing, QTKD · 18–25 tuổi"). */
  audienceLabel: z.string().nullable().default(null),
});
export type PublisherForm = z.infer<typeof publisherFormSchema>;

/** VERIFIED `FormInProgressAttemptsDto` (`GET /forms/:id/in-progress-attempts`, decision E5-D4). */
export const inProgressAttemptsSchema = z.object({
  formId: z.string(),
  status: formStatusEnum,
  inProgressAttempts: count,
  reservationWindowMinutes: count,
});
export type InProgressAttempts = z.infer<typeof inProgressAttemptsSchema>;

/** "Giờ / Ngày / Tuần / Tháng" of "Lượt mở khảo sát". */
export const OPENS_RANGES = ["hour", "day", "week", "month"] as const;
export type OpensRange = (typeof OPENS_RANGES)[number];

/** ASSUMED: why a Publisher disputes a Google Forms attempt (Figma 10c chips). */
export const DISPUTE_REASONS = ["LOW_EFFORT", "NO_MATCHING_RESPONSE", "DUPLICATE_RESPONDENT", "OTHER"] as const;
export const disputeReasonSchema = z.enum(DISPUTE_REASONS);
export type DisputeReason = z.infer<typeof disputeReasonSchema>;

const disputeSchema = z.object({
  id: z.string(),
  status: z.enum(["OPEN", "UPHELD", "DISMISSED"]),
  reason: disputeReasonSchema,
  createdAt: z.string(),
});

/**
 * ASSUMED API CONTRACT: `GET /forms/:id/progress?range=` — Figma 10a
 * "Tiến độ". No backend route aggregates opens, the funnel, the 48h review
 * queue and the rating summary for a Publisher yet.
 */
export const formProgressSchema = z.object({
  formId: z.string(),
  completed: count,
  expected: count,
  /** Escrow drawn by validated completions ("Điểm đã chi"). */
  pointsSpent: count,
  escrowRemaining: count,
  deadlineAt: z.string().nullable(),
  opens: z.object({
    range: z.enum(OPENS_RANGES),
    total: count,
    buckets: z.array(z.object({ label: z.string(), count })),
  }),
  started: count,
  abandoned: count,
  averageDurationSeconds: z.number().nonnegative().nullable(),
  /** Google Forms completions still in their 48h review (FR-24: disputable). */
  pendingAttempts: z.array(
    z.object({
      attemptId: z.string(),
      /** Anonymous respondent handle ("#7F3A"). */
      respondentCode: z.string(),
      codeVerifiedAt: z.string(),
      reviewEndsAt: z.string(),
      dispute: disputeSchema.nullable(),
    }),
  ),
  feedback: z.object({
    count,
    averageRating: z.number().min(0).max(5).nullable(),
    issues: z.array(z.object({ tag: surveyFeedbackIssueTagSchema, percent: z.number().min(0).max(100) })),
  }),
});
export type FormProgress = z.infer<typeof formProgressSchema>;
export type PendingAttempt = FormProgress["pendingAttempts"][number];

export const disputeResultSchema = z.object({
  attemptId: z.string(),
  dispute: disputeSchema,
});
export type DisputeResult = z.infer<typeof disputeResultSchema>;

/** Figma 10 lists every survey on one screen: the backend maximum page size. */
export const PUBLISHER_FORMS_PAGE_SIZE = 100;

/** VERIFIED: `GET /forms?page&limit&status&type` — the caller's own surveys. */
export function listPublisherForms(signal?: AbortSignal): Promise<PublisherFormList> {
  return apiRequest(`/forms?page=1&limit=${PUBLISHER_FORMS_PAGE_SIZE}`, { schema: publisherFormListSchema, signal });
}

const formPath = (id: string) => `/forms/${encodeURIComponent(id)}` as const;

/** VERIFIED: `GET /forms/:id` — header of every `/forms/[id]/*` screen. */
export function getPublisherForm(id: string, signal?: AbortSignal): Promise<PublisherForm> {
  return apiRequest(formPath(id), { schema: publisherFormSchema, signal });
}

/** ASSUMED API CONTRACT: `GET /forms/:id/progress?range=day`. */
export function getFormProgress(id: string, range: OpensRange, signal?: AbortSignal): Promise<FormProgress> {
  return apiRequest(`${formPath(id)}/progress?range=${range}`, { schema: formProgressSchema, signal });
}

/** VERIFIED: `GET /forms/:id/in-progress-attempts` — who a close would cut off. */
export function getInProgressAttempts(id: string, signal?: AbortSignal): Promise<InProgressAttempts> {
  return apiRequest(`${formPath(id)}/in-progress-attempts`, { schema: inProgressAttemptsSchema, signal });
}

/** VERIFIED: `POST /forms/:id/close` (`closeFormSchema`) — "Đóng & hoàn điểm" refunds the unused Escrow. */
export function closePublisherForm(id: string): Promise<PublisherForm> {
  return apiRequest(`${formPath(id)}/close`, { method: "POST", body: {}, schema: publisherFormSchema });
}

/** VERIFIED: `POST /forms/:id/reopen` (`reopenSurveySchema`) — owner only, locks the added Escrow. */
export function reopenPublisherForm(id: string, additionalCompletions: number): Promise<PublisherForm> {
  return apiRequest(`${formPath(id)}/reopen`, {
    method: "POST",
    body: { additionalCompletions },
    schema: publisherFormSchema,
  });
}

/** ASSUMED API CONTRACT: `POST /forms/:id/pause` / `POST /forms/:id/resume` ("Tạm dừng", Figma 10a). */
export function setPublisherFormPaused(id: string, paused: boolean): Promise<PublisherForm> {
  return apiRequest(`${formPath(id)}/${paused ? "pause" : "resume"}`, {
    method: "POST",
    body: {},
    schema: publisherFormSchema,
  });
}

export interface DisputeInput {
  reason: DisputeReason;
  description: string;
}

/**
 * ASSUMED API CONTRACT: `POST /forms/:id/attempts/:attemptId/disputes`
 * (Figma 10c, FR-24). The backend holds the reward of a disputed Google Forms
 * attempt (`external-dispute:` ledger hold) but exposes no Publisher route yet.
 */
export function submitAttemptDispute(formId: string, attemptId: string, input: DisputeInput): Promise<DisputeResult> {
  return apiRequest(`${formPath(formId)}/attempts/${encodeURIComponent(attemptId)}/disputes`, {
    method: "POST",
    body: input,
    schema: disputeResultSchema,
  });
}
