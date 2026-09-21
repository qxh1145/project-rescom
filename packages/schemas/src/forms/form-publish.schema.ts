import { z } from "zod";
import { formStatusEnum, FormStatusEnum, formTypeEnum, FormTypeEnum } from "./form-draft.schema";

/**
 * Platform Form Lifecycle State Machine:
 * DRAFT -> ESCROW_LOCKED -> MODERATION_QUEUE -> PUBLISHED -> CLOSED
 *
 * Direct paths:
 * - Internal non-reward surveys (rewardPerResponse = 0): DRAFT -> PUBLISHED
 * - Direct moderation submission: DRAFT -> MODERATION_QUEUE
 * - Surveys requiring escrow funds: DRAFT -> ESCROW_LOCKED
 */
export const FORM_STATUS_TRANSITIONS: Record<FormStatusEnum, readonly FormStatusEnum[]> = {
  DRAFT: ["ESCROW_LOCKED", "PUBLISHED", "MODERATION_QUEUE"] as const,
  ESCROW_LOCKED: ["MODERATION_QUEUE", "PUBLISHED", "CLOSED"] as const,
  MODERATION_QUEUE: ["PUBLISHED", "CLOSED"] as const,
  PUBLISHED: ["CLOSED"] as const,
  CLOSED: [] as const,
};

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
 * Determines the default publish target status based on survey type and reward configuration.
 * - External surveys or surveys with rewards (> 0 points) transition to ESCROW_LOCKED.
 * - Internal non-reward surveys (0 points) transition directly to PUBLISHED.
 */
export function determinePublishTargetStatus(form: {
  type: FormTypeEnum;
  rewardPerResponse: number;
}): FormStatusEnum {
  if (form.type === "EXTERNAL" || form.rewardPerResponse > 0) {
    return "ESCROW_LOCKED";
  }
  return "PUBLISHED";
}

/**
 * Schema for publishing a form draft.
 */
export const publishFormSchema = z
  .object({
    targetStatus: formStatusEnum.optional(),
    externalUrl: z
      .string()
      .trim()
      .url("Invalid external survey URL")
      .max(2000)
      .optional()
      .nullable(),
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
