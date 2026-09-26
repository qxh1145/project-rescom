import { z } from "zod";
import { formStatusEnum, FormStatusEnum, FormTypeEnum } from "./form-draft.schema";
import { externalSurveyUrlSchema } from "./external-url.schema";
import { estimatedDurationMinutesSchema } from "../economy/pricing.schema";

/**
 * Platform Form Lifecycle State Machine (authoritative; Story 2.6, revised by Story 8.1):
 *
 *   DRAFT -> MODERATION_QUEUE -> PUBLISHED -> CLOSED
 *                    \-> CLOSED (Admin rejection or Publisher withdrawal)
 *
 * - Publishing reserves the Escrow (when the effective cost is > 0) AND enters the
 *   Admin moderation queue in one Unit of Work (AD-16 `publish:{formVersionId}`), so
 *   every survey — Internal or External, rewarded or free — is moderated before it
 *   reaches the Marketplace (FR-20, FR-53). There is no direct DRAFT -> PUBLISHED path.
 * - Only an Admin approval moves MODERATION_QUEUE -> PUBLISHED; an Admin rejection
 *   (or Publisher withdrawal) moves MODERATION_QUEUE -> CLOSED and refunds the Escrow.
 * - DRAFT -> CLOSED (decision D2, Bug 3.1) is allowed only for a re-versioned draft
 *   (a survey with a published version back in DRAFT after "Create New Version"):
 *   closing it refunds the Escrow it still holds. A never-published draft is deleted,
 *   not closed — `FormsService.closeForm` enforces that precondition.
 * - ESCROW_LOCKED is a legacy state: rows published before Story 8.1 may still hold it.
 *   Nothing enters it any more; such rows can only be moved into moderation or closed.
 * - Out-of-table transitions owned by other stories: new version (PUBLISHED -> DRAFT,
 *   Story 2.7) and reopen with additional quota (CLOSED -> PUBLISHED, Story 6.3,
 *   approved versions only).
 *
 * Signed off 2026-09-26 (code-review decision E8-D1, option B; recorded next to
 * the ARCHITECTURE-SPINE open question): the table above plus the two
 * out-of-table transitions is the approved lifecycle. Every close records who
 * closed the survey (`FormCloseKind`), and the reopen transition is allowed only
 * after the owner's own close — an Admin takedown (`ADMIN`) or a moderation
 * rejection (`MODERATION`) is final (`409 FORM_NOT_REOPENABLE`).
 */
export const FORM_STATUS_TRANSITIONS: Record<FormStatusEnum, readonly FormStatusEnum[]> = {
  DRAFT: ["MODERATION_QUEUE", "CLOSED"] as const,
  ESCROW_LOCKED: ["MODERATION_QUEUE", "CLOSED"] as const,
  MODERATION_QUEUE: ["PUBLISHED", "CLOSED"] as const,
  PUBLISHED: ["CLOSED"] as const,
  CLOSED: [] as const,
};

/**
 * Who closed a survey (decision E8-D1). Must stay identical to the Prisma
 * `FormCloseKind` enum.
 * - `OWNER`: the Publisher closed their live survey or withdrew it from the
 *   moderation queue (an Admin closing their own survey is an owner close).
 * - `ADMIN`: an Admin took down someone else's survey (`POST /forms/:id/close`
 *   or the generic `/status` endpoint).
 * - `MODERATION`: an Admin rejected the queued version (Story 8.1).
 */
export const formCloseKindEnum = z.enum(["OWNER", "ADMIN", "MODERATION"]);
export type FormCloseKind = z.infer<typeof formCloseKindEnum>;

/**
 * Decision E8-D1: a closed survey may be reopened (CLOSED -> PUBLISHED with
 * additional quota) only after its owner closed it. Admin takedowns and
 * moderation rejections are final; `null` (a close recorded before the close
 * kind existed) is not proven to be the owner's, so it fails closed.
 */
export function isOwnerReopenableClose(
  closeKind: FormCloseKind | null | undefined
): boolean {
  return closeKind === "OWNER";
}

/**
 * Checks whether a transition between two FormStatus values is allowed by the lifecycle state machine.
 */
export function isValidStatusTransition(
  from: FormStatusEnum,
  to: FormStatusEnum
): boolean {
  if (from === to) return false;
  const allowed = FORM_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Checks whether a form in a given status is immutable (cannot have its blocks or schema edited).
 * Per platform invariants, any status other than DRAFT is strictly locked from mutation.
 */
export function isFormImmutable(status: FormStatusEnum): boolean {
  return status !== "DRAFT";
}

/**
 * Determines the status a form enters when its Publisher publishes it.
 * Since Story 8.1 every survey enters the Admin moderation queue (FR-20); the
 * type/reward are kept in the signature because Escrow reservation still depends
 * on them (see `calculateEscrowCost`).
 */
export function determinePublishTargetStatus(_form: {
  type: FormTypeEnum;
  rewardPerResponse: number;
}): FormStatusEnum {
  return "MODERATION_QUEUE";
}

/**
 * Schema for publishing a form draft.
 */
export const publishFormSchema = z
  .object({
    targetStatus: formStatusEnum.optional(),
    externalUrl: externalSurveyUrlSchema.optional().nullable(),
    /**
     * Sets the estimated completion time with the publish request (stored on
     * the form); the FR-14 band check uses it (decision E6-D2).
     */
    estimatedDurationMinutes: estimatedDurationMinutesSchema.optional(),
  })
  .strict();

export type PublishFormDto = z.infer<typeof publishFormSchema>;
export type PublishFormInput = z.input<typeof publishFormSchema>;

/**
 * Schema for closing an active or published form.
 */
export const closeFormSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CloseFormDto = z.infer<typeof closeFormSchema>;
export type CloseFormInput = z.input<typeof closeFormSchema>;

/**
 * Schema for administrative or direct status transition.
 */
export const formStatusTransitionSchema = z
  .object({
    targetStatus: formStatusEnum,
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export type FormStatusTransitionDto = z.infer<typeof formStatusTransitionSchema>;
export type FormStatusTransitionInput = z.input<typeof formStatusTransitionSchema>;
