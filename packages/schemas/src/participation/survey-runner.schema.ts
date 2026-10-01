import { z } from 'zod';
import { respondentFormBlockSchema } from '../forms/form-blocks.schema';
import {
  formSectionSchema,
  formSettingsSchema,
} from '../forms/form-definition.schema';
import { formStatusEnum, formTypeEnum } from '../forms/form-draft.schema';
import { formIntegrityMetadataSchema } from '../forms/form-integrity.schema';
import { ledgerAccountClassSchema } from '../economy/ledger-account.schema';
import { attemptTimeBarrierSchema } from './bot-protection';

/**
 * Story IR.2a — Respondent reads of the survey runner (API-01..API-05):
 * `GET /surveys/:id`, `GET /attempts/:attemptId` (with the PINNED Form
 * Definition), `GET /attempts/:attemptId/outcome` and the command
 * `POST /attempts/:attemptId/cancel`. One schema per route, shared by the
 * backend controllers, the frontend services and the MSW handlers. Every
 * response schema is strict: a security-sensitive or unknown field fails
 * parsing instead of being silently dropped.
 */

export const SURVEY_NOT_FOUND_CODE = 'SURVEY_NOT_FOUND';
export const ATTEMPT_NOT_FOUND_CODE = 'ATTEMPT_NOT_FOUND';
export const ATTEMPT_NOT_IN_PROGRESS_CODE = 'ATTEMPT_NOT_IN_PROGRESS';

/** BE-12 fallback when neither a duration nor an expected effort is known. */
export const DEFAULT_ESTIMATED_EFFORT_SECONDS = 60;

/**
 * BE-12: the Publisher's estimated duration (whole minutes) wins over the
 * Form Definition's `metadata.expectedEffortSeconds`; 60 s otherwise. Pass the
 * metadata of the version being described (the pinned one for an attempt).
 */
export function resolveEstimatedEffortSeconds(input: {
  estimatedDurationMinutes: number | null | undefined;
  metadata: { expectedEffortSeconds?: number | null } | null | undefined;
}): number {
  const minutes = input.estimatedDurationMinutes;
  if (typeof minutes === 'number' && minutes > 0) {
    return minutes * 60;
  }
  return (
    input.metadata?.expectedEffortSeconds ?? DEFAULT_ESTIMATED_EFFORT_SECONDS
  );
}

/** Mirrors Prisma `AttemptStatus` (`survey-attempt.entity.ts`). */
export const attemptStatusSchema = z.enum([
  'IN_PROGRESS',
  'COMPLETED',
  'ABANDONED',
  'LOCKED',
]);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;

/**
 * Mirrors Prisma `AttemptCloseReason`: why an ABANDONED attempt closed. Rows
 * abandoned before the column existed carry null.
 */
export const attemptCloseReasonSchema = z.enum(['EXPIRED', 'CANCELLED']);
export type AttemptCloseReason = z.infer<typeof attemptCloseReasonSchema>;

/**
 * `GET /surveys/:id` (API-01): public facts of one PUBLISHED survey — never
 * targeting, the completion code, the external URL, the publisher or
 * escrow data. Unknown and unpublished surveys are one 404 SURVEY_NOT_FOUND.
 */
export const surveySummarySchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1),
    description: z.string().nullable(),
    type: formTypeEnum,
    status: formStatusEnum,
    /** The advertised reward, credited in full (decision E6-D1). */
    rewardPerResponse: z.number().int().nonnegative(),
    estimatedEffortSeconds: z.number().int().nonnegative(),
    expectedCompletions: z.number().int().nonnegative(),
    /** Quota definition: completed participations, guests included. */
    completedCompletions: z.number().int().nonnegative(),
    /** expected − completed − active reservations, never below 0. */
    remainingSlots: z.number().int().nonnegative(),
  })
  .strict();
export type SurveySummaryDto = z.infer<typeof surveySummarySchema>;

/**
 * API-05: the Form Definition of the attempt's PINNED FormVersion (AD-19),
 * never the survey's current one. Same building blocks as
 * `publicFormDetailsSchema`, without `publicUrl`. Blocks are the Respondent
 * projection: no `integrity` (review MEDIUM-1), so attention-check answers
 * never reach the runner.
 */
export const attemptPinnedFormSchema = z
  .object({
    formVersionId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    title: z.string().min(1).max(200),
    description: z.string().nullable(),
    blocks: z.array(respondentFormBlockSchema).min(1),
    sections: z.array(formSectionSchema).max(50).optional(),
    settings: formSettingsSchema,
    metadata: formIntegrityMetadataSchema,
    publishedAt: z.string().datetime().nullable(),
  })
  .strict();
export type AttemptPinnedFormDto = z.infer<typeof attemptPinnedFormSchema>;

/**
 * `GET /attempts/:attemptId` (API-02 + API-05): the owner's attempt as
 * persisted (an expired reservation stays IN_PROGRESS with a past
 * `expiresAt`), its server-authoritative times and barrier, a survey header
 * and — for an Internal Form only — the pinned Form Definition.
 */
export const surveyAttemptDetailsSchema = z
  .object({
    attemptId: z.string().uuid(),
    /** The Internal Response; null for External attempts. */
    responseId: z.string().uuid().nullable(),
    formId: z.string().uuid(),
    /** The pinned version (BE-7: an External attempt may be re-pinned after a code rotation). */
    formVersionId: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    type: formTypeEnum,
    status: attemptStatusSchema,
    closedReason: attemptCloseReasonSchema.nullable(),
    closedAt: z.string().datetime().nullable(),
    startedAt: z.string().datetime(),
    /** startedAt + the 30-minute reservation (`RESERVATION_EXPIRY_MS`). */
    expiresAt: z.string().datetime(),
    submittedAt: z.string().datetime().nullable(),
    /** Wrong completion codes of this attempt (server-owned counter). */
    wrongCodeCount: z.number().int().nonnegative(),
    /** Decision E5-D1: the account's counted wrong codes on the pinned version; 0 for Internal. */
    accountWrongCodeCount: z.number().int().nonnegative(),
    /** Same barrier the start response announces. */
    timeBarrier: attemptTimeBarrierSchema,
    survey: z
      .object({
        title: z.string().min(1),
        /** Drives the "survey updated or closed" panel of the runner. */
        status: formStatusEnum,
        rewardPerResponse: z.number().int().nonnegative(),
        estimatedEffortSeconds: z.number().int().nonnegative(),
        /** The pinned version's Google Form link (External); null for Internal. */
        externalUrl: z.string().url().nullable(),
      })
      .strict(),
    form: attemptPinnedFormSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.type === 'INTERNAL') !== (value.form !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['form'],
        message:
          'An Internal attempt carries its pinned form; an External one has none.',
      });
    }
  });
export type SurveyAttemptDetailsDto = z.infer<
  typeof surveyAttemptDetailsSchema
>;

/**
 * Where an attempt's reward stands, derived read-only from posted Ledger
 * journals (API-04). `AVAILABLE` = credited to Available (Internal instant
 * credit, or a released External credit); `PENDING` = External credit in its
 * 48 h window; `HELD_IN_INTEGRITY` = ENFORCED Integrity Hold; `HELD_IN_DISPUTE`
 * = open dispute hold; `REVERSED` = reversed or refunded to the Publisher;
 * `AWAITING_SETTLEMENT` = a reward is owed but no journal exists yet;
 * `NO_REWARD` = nothing is owed; `NOT_COMPLETED` = the attempt is not
 * COMPLETED.
 */
export const attemptRewardStateSchema = z.enum([
  'AVAILABLE',
  'PENDING',
  'HELD_IN_INTEGRITY',
  'HELD_IN_DISPUTE',
  'REVERSED',
  'AWAITING_SETTLEMENT',
  'NO_REWARD',
  'NOT_COMPLETED',
]);
export type AttemptRewardState = z.infer<typeof attemptRewardStateSchema>;

/** States backed by the attempt's credit journal (`journalId` / `creditedAt` set). */
export const ATTEMPT_REWARD_STATES_WITH_JOURNAL: readonly AttemptRewardState[] =
  ['AVAILABLE', 'PENDING', 'HELD_IN_INTEGRITY', 'HELD_IN_DISPUTE', 'REVERSED'];

export const attemptRewardSchema = z
  .object({
    state: attemptRewardStateSchema,
    /** Positive total of the credit journal (never the form's price); 0 without one. */
    amount: z.number().int().nonnegative(),
    targetAccountClass: ledgerAccountClassSchema.nullable(),
    journalId: z.string().uuid().nullable(),
    creditedAt: z.string().datetime().nullable(),
    /** End of the 48 h review window; set only while PENDING. */
    releasesAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((reward, ctx) => {
    const hasJournal = reward.journalId !== null;
    if (hasJournal !== (reward.creditedAt !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['creditedAt'],
        message: 'journalId and creditedAt are set together.',
      });
    }
    if (hasJournal !== ATTEMPT_REWARD_STATES_WITH_JOURNAL.includes(reward.state)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['journalId'],
        message: `A ${reward.state} reward ${hasJournal ? 'has no' : 'needs a'} credit journal.`,
      });
    }
    if (!hasJournal && (reward.amount !== 0 || reward.targetAccountClass !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['amount'],
        message: 'A reward without a credit journal has amount 0 and no account.',
      });
    }
    if ((reward.state === 'PENDING') !== (reward.releasesAt !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['releasesAt'],
        message: 'releasesAt is set exactly when the reward is PENDING.',
      });
    }
  });
export type AttemptRewardDto = z.infer<typeof attemptRewardSchema>;

/**
 * Story 7.2: whether THIS attempt unlocked the frozen starter points (its
 * logical Form and source are the activation survey of the unlock).
 */
export const attemptStarterUnlockSchema = z
  .object({
    activatedByThisAttempt: z.boolean(),
    /** Points the unlock moved; null unless this attempt activated the account. */
    amount: z.number().int().nonnegative().nullable(),
    activatedAt: z.string().datetime().nullable(),
  })
  .strict()
  .superRefine((unlock, ctx) => {
    if (
      unlock.activatedByThisAttempt !==
        (unlock.amount !== null && unlock.activatedAt !== null) ||
      (unlock.amount === null) !== (unlock.activatedAt === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['activatedByThisAttempt'],
        message:
          'amount and activatedAt are set exactly when this attempt activated the account.',
      });
    }
  });
export type AttemptStarterUnlockDto = z.infer<
  typeof attemptStarterUnlockSchema
>;

/** `GET /attempts/:attemptId/outcome` (API-04): read-only, never re-priced. */
export const attemptOutcomeSchema = z
  .object({
    attemptId: z.string().uuid(),
    attemptStatus: attemptStatusSchema,
    submittedAt: z.string().datetime().nullable(),
    reward: attemptRewardSchema,
    /** Mirrors `starterUnlock.activatedByThisAttempt`. */
    accountActivated: z.boolean(),
    starterUnlock: attemptStarterUnlockSchema,
  })
  .strict()
  .superRefine((outcome, ctx) => {
    if (outcome.accountActivated !== outcome.starterUnlock.activatedByThisAttempt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountActivated'],
        message: 'accountActivated mirrors starterUnlock.activatedByThisAttempt.',
      });
    }
    if (
      (outcome.attemptStatus === 'COMPLETED') !==
      (outcome.reward.state !== 'NOT_COMPLETED')
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reward', 'state'],
        message: 'Only an attempt that is not COMPLETED reads NOT_COMPLETED.',
      });
    }
  });
export type AttemptOutcomeDto = z.infer<typeof attemptOutcomeSchema>;

/**
 * `POST /attempts/:attemptId/cancel` (API-03): the body is empty; the
 * required `Idempotency-Key` header is validated with `idempotencyKeySchema`.
 * A replay on an attempt already cancelled returns the original `closedAt`.
 */
export const cancelAttemptRequestSchema = z.object({}).strict();
export type CancelAttemptRequest = z.infer<typeof cancelAttemptRequestSchema>;

export const cancelAttemptResponseSchema = z
  .object({
    attemptId: z.string().uuid(),
    status: z.literal('ABANDONED'),
    closedReason: z.literal('CANCELLED'),
    closedAt: z.string().datetime(),
  })
  .strict();
export type CancelAttemptResponseDto = z.infer<
  typeof cancelAttemptResponseSchema
>;

/**
 * `error.details` of `409 ATTEMPT_NOT_IN_PROGRESS`: the attempt's persisted
 * status and why it closed (`EXPIRED` is derived for an IN_PROGRESS attempt
 * whose reservation already ran out).
 */
export const attemptNotInProgressDetailsSchema = z
  .object({
    status: attemptStatusSchema,
    closedReason: attemptCloseReasonSchema.nullable(),
  })
  .strict();
export type AttemptNotInProgressDetails = z.infer<
  typeof attemptNotInProgressDetailsSchema
>;
