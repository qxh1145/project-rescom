import { z } from "zod";
import {
  completionCodeLimitResetResultSchema,
  disputeHoldOutcomeSchema,
  type CompletionCodeLimitResetResultDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import { disputeReasonSchema } from "../forms/dispute-service.ts";

/**
 * Admin "Khiếu nại & báo lỗi" (Figma 11c, 62:1609). Three kinds of case share
 * one queue (header tabs "Khiếu nại lượt làm · Báo thiếu mã · Lượt bị khoá"):
 * - `ATTEMPT_DISPUTE`: a Publisher disputes a Google Forms completion inside
 *   its 48h review (FR-24). The reward sits in the respondent's Integrity Hold
 *   (backend `placeDisputeHold`, key `external-dispute:{caseId}`).
 * - `MISSING_CODE`: a Respondent's "Báo thiếu mã hoàn thành" (FR-23, VERIFIED
 *   `POST /attempts/:id/report-missing-code` stores `missingCodeReportedAt`).
 * - `LOCKED_ATTEMPT`: an attempt locked after 3 wrong completion codes
 *   (`completion-code-policy-v1`, decision E5-D1).
 *
 * ASSUMED API CONTRACT (no backend read/resolve route exists; the ledger side
 * is `LedgerService.resolveDisputeHold`, not exposed over HTTP):
 * - `GET  /admin/disputes?status=OPEN` → `{ items, counts }`
 * - `POST /admin/disputes/:id/resolve` `{ outcome, note }` → the resolved case.
 *   `ATTEMPT_DISPUTE` outcomes are the backend `disputeHoldOutcomeSchema`
 *   (`REFUND_TO_PUBLISHER` = upheld, `RELEASE_TO_RESPONDENT` = dismissed);
 *   the server derives respondent, publisher and amount from the case (never
 *   from the body, like the reward re-drive routes) and notifies both parties
 *   with `note`. Errors: 404 `DISPUTE_CASE_NOT_FOUND`, 409
 *   `DISPUTE_CASE_ALREADY_RESOLVED`, 400 `DISPUTE_OUTCOME_NOT_ALLOWED` /
 *   `VALIDATION_ERROR`, plus the ledger codes of `resolveDisputeHold`.
 *   `CREDIT_RESPONDENT` pays the reward from the survey escrow (form lock and
 *   the owner's Ký quỹ, journal `internal-reward:{attemptId}`) and is refused
 *   with 409 `DISPUTE_ATTEMPT_ALREADY_REWARDED` (the attempt is COMPLETED or
 *   already has a reward), 409 `DISPUTE_SURVEY_CLOSED` (survey closed or its
 *   quota full) or 409 `INSUFFICIENT_BALANCE` (escrow below the reward).
 *   `attempt.status` is the attempt's CURRENT status, not a snapshot.
 *   `REFUND_TO_PUBLISHER` is refused with 409 `INSUFFICIENT_BALANCE` (the
 *   respondent's Integrity Hold exists but falls short of the amount) or 409
 *   `DISPUTE_NO_HELD_POINTS` (ASSUMED, mock-only refinement: the respondent
 *   has no held points at all — nothing to refund, `disputeHoldRefusal`).
 *
 * VERIFIED: `POST /admin/completion-code-limits/reset`
 * (`admin-completion-code-limit.controller.ts`, `completionCodeLimitResetRequestSchema`)
 * — "Mở lại giới hạn mã" calls it first, then records `CODE_LIMIT_RESET`.
 */

export const DISPUTE_CASE_KINDS = ["ATTEMPT_DISPUTE", "MISSING_CODE", "LOCKED_ATTEMPT"] as const;
export const disputeCaseKindSchema = z.enum(DISPUTE_CASE_KINDS);
export type DisputeCaseKind = z.infer<typeof disputeCaseKindSchema>;

/** Backend dispute-hold outcomes + ASSUMED outcomes of the other two kinds. */
export const DISPUTE_CASE_OUTCOMES = [
  ...disputeHoldOutcomeSchema.options,
  /** Missing code: the Admin confirms the completion and pays the reward from the survey escrow. */
  "CREDIT_RESPONDENT",
  /** Missing code / locked attempt: wrong codes forgiven through the VERIFIED reset route. */
  "CODE_LIMIT_RESET",
  /** Missing code / locked attempt: nothing changes. */
  "DISMISSED",
] as const;
export const disputeCaseOutcomeSchema = z.enum(DISPUTE_CASE_OUTCOMES);
export type DisputeCaseOutcome = z.infer<typeof disputeCaseOutcomeSchema>;

/** Prisma `FraudLogType`. */
export const fraudLogTypeSchema = z.enum([
  "TIME_BARRIER",
  "RATE_LIMIT",
  "DEMO_MISMATCH",
  "RECAPTCHA_FAIL",
  "SECURITY_VIOLATION",
]);
export type FraudLogType = z.infer<typeof fraudLogTypeSchema>;

const count = z.number().int().nonnegative();
const isoDate = z.string().datetime({ offset: true });

export const disputeCaseSchema = z.object({
  id: z.string().uuid(),
  kind: disputeCaseKindSchema,
  status: z.enum(["OPEN", "RESOLVED"]),
  createdAt: isoDate,
  /** Who filed it: the Publisher (dispute), the Respondent (missing code), the system (lock). */
  reporter: z.object({ role: z.enum(["PUBLISHER", "RESPONDENT", "SYSTEM"]), name: z.string() }),
  survey: z.object({
    id: z.string().uuid(),
    title: z.string(),
    type: z.enum(["INTERNAL", "EXTERNAL"]),
    rewardPerResponse: count,
  }),
  attempt: z.object({
    id: z.string().uuid(),
    formVersionId: z.string().uuid(),
    status: z.enum(["IN_PROGRESS", "COMPLETED", "ABANDONED", "LOCKED"]),
    startedAt: isoDate,
    codeVerifiedAt: isoDate.nullable(),
    /** Publisher estimate ("khai 8 phút"). */
    declaredEffortSeconds: count.nullable(),
    wrongCodeCount: count,
  }),
  respondent: z.object({
    id: z.string().uuid(),
    /** Anonymised handle shown to admins and publishers ("#7F3A"). */
    code: z.string(),
    joinedAt: isoDate.nullable(),
    attemptCount: count,
    /** FraudLog entries of the last 14 days. */
    fraudLogCount: count,
    repeatOffender: z.boolean(),
    /** Newest first, at most 3 (Figma lists 3 + "+2 mục khác"). */
    recentFraudLogs: z.array(z.object({ id: z.string(), type: fraudLogTypeSchema, createdAt: isoDate })),
  }),
  /** Points at stake: the held reward (dispute) or the survey reward (missing code / lock). */
  amount: count,
  /** Disputes: end of the reward's 48h review ("Điểm còn chờ 31 giờ"). */
  reviewEndsAt: isoDate.nullable(),
  /** Publisher dispute reason (Figma 10c chips); null for the other kinds. */
  reason: disputeReasonSchema.nullable(),
  description: z.string().nullable(),
  evidence: z.array(z.object({ id: z.string(), url: z.string().url().nullable() })),
  resolution: z
    .object({
      outcome: disputeCaseOutcomeSchema,
      note: z.string(),
      resolvedAt: isoDate,
      resolvedByName: z.string(),
    })
    .nullable(),
});
export type DisputeCase = z.infer<typeof disputeCaseSchema>;

export const disputeCaseListSchema = z.object({
  items: z.array(disputeCaseSchema),
  /** OPEN cases per kind (tab counts). */
  counts: z.object({ ATTEMPT_DISPUTE: count, MISSING_CODE: count, LOCKED_ATTEMPT: count }),
});
export type DisputeCaseList = z.infer<typeof disputeCaseListSchema>;

/** ASSUMED: the admin note is sent to both parties (Figma "gửi email cho cả hai bên"). */
export const DECISION_NOTE_MIN = 10;
export const DECISION_NOTE_MAX = 1000;

export function listOpenDisputeCases(signal?: AbortSignal): Promise<DisputeCaseList> {
  return apiRequest("/admin/disputes?status=OPEN", { schema: disputeCaseListSchema, signal });
}

export function resolveDisputeCase(
  caseId: string,
  input: { outcome: DisputeCaseOutcome; note: string },
): Promise<DisputeCase> {
  return apiRequest(`/admin/disputes/${encodeURIComponent(caseId)}/resolve`, {
    method: "POST",
    body: { outcome: input.outcome, note: input.note },
    schema: disputeCaseSchema,
  });
}

/** VERIFIED: forgives the account's counted wrong codes on one FormVersion (reason 5–1000 chars). */
export function resetCompletionCodeLimit(input: {
  respondentId: string;
  formVersionId: string;
  reason: string;
}): Promise<CompletionCodeLimitResetResultDto> {
  return apiRequest("/admin/completion-code-limits/reset", {
    method: "POST",
    body: input,
    schema: completionCodeLimitResetResultSchema,
  });
}
