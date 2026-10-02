import { z } from "zod";
import {
  createdFormVersionSchema as sharedCreatedFormVersionSchema,
  deletedFormSchema,
  formDetailSchema,
  formDetailVersionSchema,
  formInProgressAttemptsSchema,
  formRejectionSchema,
  formSummarySchema,
  PUBLISHER_PROGRESS_RANGES,
  publisherProgressSchema,
  type FormInProgressAttempts,
  type PublisherProgressDto,
  type PublisherProgressRange,
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

/**
 * Management fields shared by `GET /forms` items and `GET /forms/:id`.
 * `completedCompletions` and `escrowLocked` are VERIFIED (Phase 5 M1/M2:
 * `FormSummaryDto` / `FormDetailDto`); the others are ASSUMED API CONTRACT.
 */
const managementExtensions = {
  /** Completed participations so far (Figma "6/10"). */
  completedCompletions: count.default(0),
  /**
   * Unused points this survey still holds in Escrow — what closing it now
   * refunds ("ký quỹ 100"). `null` = unknown (server could not compute it, or
   * a response without the field): the UI then shows no number.
   */
  escrowLocked: count.nullable().default(null),
  /** `GET /forms/:id`: when the survey entered the moderation queue (null otherwise). */
  submittedAt: nullableIso,
  publishedAt: nullableIso,
  /** Collection deadline ("hạn 05/10 · còn 9 ngày"). */
  deadlineAt: nullableIso,
  /** `GET /forms/:id`: when the survey closed (null unless CLOSED). */
  closedAt: nullableIso,
  /** Hidden from Khám phá ("đã ẩn khỏi Khám phá"). */
  hiddenFromMarketplace: z.boolean().default(false),
  /** "Tạm dừng" (Figma 10a) — no backend state exists yet. */
  pausedAt: nullableIso,
  /**
   * `GET /forms/:id` (shared `formRejectionSchema`): the Admin rejection of a
   * survey closed by moderation ("Bị từ chối · Đã hoàn 120 điểm"), from its
   * `SurveyModerationDecision`. The rejection itself is `status` CLOSED +
   * `closeKind` MODERATION; the list DTO does not carry these details.
   */
  rejection: formRejectionSchema.nullable().default(null),
};

/**
 * VERIFIED `FormSummaryDto` (`GET /forms` → `forms.service.ts#listForms`,
 * with `closeKind`, `completedCompletions`, `escrowLocked` since Phase 5 M2)
 * + ASSUMED management fields.
 */
export const publisherFormSummarySchema = formSummarySchema.extend({
  closeKind: formSummarySchema.shape.closeKind.default(null),
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
export const publisherFormSchema = formDetailSchema.extend({
  closeKind: formDetailSchema.shape.closeKind.unwrap().default(null),
  currentVersion: formDetailVersionSchema.extend({
    schemaJson: z.object({ blocks: z.array(z.unknown()).optional() }).passthrough().nullable().optional(),
  }),
  ...managementExtensions,
  /** ASSUMED: questions of the current version (Figma 17 "8 câu hỏi"); falls back to the block count. */
  questionCount: count.nullable().default(null),
  /** ASSUMED: targeting summary (Figma 10a "Marketing, QTKD · 18–25 tuổi"). */
  audienceLabel: z.string().nullable().default(null),
});
export type PublisherForm = z.infer<typeof publisherFormSchema>;

/** `GET /forms/:id/in-progress-attempts` (shared `formInProgressAttemptsSchema`, decision E5-D4). */
export const inProgressAttemptsSchema = formInProgressAttemptsSchema;
export type InProgressAttempts = FormInProgressAttempts;

/** "Giờ / Ngày / Tuần / Tháng" of the "Lượt hoàn thành" chart (shared ranges). */
export const PROGRESS_RANGES = PUBLISHER_PROGRESS_RANGES;
export type ProgressRange = PublisherProgressRange;

/**
 * VERIFIED (Story IR.4a): `GET /forms/:id/progress?range=` — Figma 10a
 * "Tiến độ", the shared `publisherProgressSchema`. Owner only (404
 * `FORM_NOT_FOUND` for anybody else, Admins included). No opens/funnel
 * metrics (FR-41 deferred) and no feedback summary (Story 9.3).
 */
export const formProgressSchema = publisherProgressSchema;
export type FormProgress = PublisherProgressDto;

/** Figma 10 lists every survey on one screen: the backend maximum page size. */
export const PUBLISHER_FORMS_PAGE_SIZE = 100;
/** Phase 5 M6: at most 20 pages (2 000 surveys) are loaded for the list and its totals. */
export const PUBLISHER_FORMS_MAX_PAGES = 20;

/**
 * Every page of the list, up to `PUBLISHER_FORMS_MAX_PAGES` (page 1 first for
 * `totalPages`, then the rest in parallel). A survey that moved between pages
 * while loading (the list is ordered by `updatedAt`) is kept once.
 */
export async function collectPublisherFormPages(
  fetchPage: (page: number) => Promise<PublisherFormList>,
): Promise<PublisherFormList> {
  const first = await fetchPage(1);
  const lastPage = Math.min(first.totalPages, PUBLISHER_FORMS_MAX_PAGES);
  const rest: PublisherFormList[] = [];
  for (let page = 2; page <= lastPage; page += 1) {
    rest.push(await fetchPage(page));
  }
  const seen = new Set<string>();
  const forms = [first, ...rest]
    .flatMap((page) => page.forms)
    .filter((form) => (seen.has(form.id) ? false : (seen.add(form.id), true)));
  return { ...first, forms };
}

/** VERIFIED: `GET /forms?page&limit&status&type` — every survey of the caller (Phase 5 M6). */
export function listPublisherForms(signal?: AbortSignal): Promise<PublisherFormList> {
  return collectPublisherFormPages((page) =>
    apiRequest(`/forms?page=${page}&limit=${PUBLISHER_FORMS_PAGE_SIZE}`, { schema: publisherFormListSchema, signal }),
  );
}

const formPath = (id: string) => `/forms/${encodeURIComponent(id)}` as const;

/** VERIFIED: `GET /forms/:id` — header of every `/forms/[id]/*` screen. */
export function getPublisherForm(id: string, signal?: AbortSignal): Promise<PublisherForm> {
  return apiRequest(formPath(id), { schema: publisherFormSchema, signal });
}

/** VERIFIED: `GET /forms/:id/progress?range=day` (Story IR.4a). */
export function getFormProgress(id: string, range: ProgressRange, signal?: AbortSignal): Promise<FormProgress> {
  return apiRequest(`${formPath(id)}/progress?range=${range}`, { schema: formProgressSchema, signal });
}

/** VERIFIED: `GET /forms/:id/in-progress-attempts` — who a close would cut off. */
export function getInProgressAttempts(id: string, signal?: AbortSignal): Promise<InProgressAttempts> {
  return apiRequest(`${formPath(id)}/in-progress-attempts`, { schema: inProgressAttemptsSchema, signal });
}

/**
 * VERIFIED: `POST /forms/:id/close` (`closeFormSchema`) — "Đóng & hoàn điểm"
 * refunds the unused Escrow. Also "Rút lại & hoàn điểm" (Phase 5 M7): the
 * owner withdraws a queued survey or closes a re-versioned draft (400
 * `INVALID_STATUS_TRANSITION` for a never-published draft).
 */
export function closePublisherForm(id: string): Promise<PublisherForm> {
  return apiRequest(`${formPath(id)}/close`, { method: "POST", body: {}, schema: publisherFormSchema });
}

/**
 * VERIFIED: `POST /forms/:id/reopen` (`reopenSurveySchema`) — owner only, locks the added Escrow.
 * `deadlineAt` (Story IR.2b Q3): omitted keeps the current deadline; required (ISO or null) once it passed.
 */
export function reopenPublisherForm(
  id: string,
  additionalCompletions: number,
  deadlineAt?: string | null,
): Promise<PublisherForm> {
  return apiRequest(`${formPath(id)}/reopen`, {
    method: "POST",
    body: deadlineAt === undefined ? { additionalCompletions } : { additionalCompletions, deadlineAt },
    schema: publisherFormSchema,
  });
}

/**
 * VERIFIED: `DELETE /forms/:id` — deletes a never-published draft for good
 * (409 `FORM_NOT_IN_DRAFT_STATUS` / `FORM_HAS_PUBLISHED_VERSIONS` otherwise).
 */
export function deleteFormDraft(id: string): Promise<{ id: string }> {
  return apiRequest(formPath(id), { method: "DELETE", schema: deletedFormSchema });
}

/** `CreateFormVersionResultDto`: the form detail + attempts on the old version that were cut off. */
export const createdFormVersionSchema = publisherFormSchema.extend({
  interruptedAttempts: sharedCreatedFormVersionSchema.shape.interruptedAttempts.default(0),
});
export type CreatedFormVersion = z.infer<typeof createdFormVersionSchema>;

/**
 * VERIFIED: `POST /forms/:id/versions` — "Chỉnh sửa" of a running survey. The
 * backend clones the newest version into vN+1 and moves the survey back to
 * DRAFT (off Khám phá until the new version is approved); only PUBLISHED
 * surveys (409 `FORM_NOT_PUBLISHED` otherwise).
 */
export function createFormVersion(id: string): Promise<CreatedFormVersion> {
  return apiRequest(`${formPath(id)}/versions`, { method: "POST", body: {}, schema: createdFormVersionSchema });
}

/**
 * Phase 5 M3 (decision Q2, option a): the backend has no pause/resume route,
 * so "Tạm dừng" / "Tiếp tục" stay hidden until it does.
 */
export const PAUSE_SUPPORTED = false;
