import { z } from 'zod';
import { ledgerAccountClassSchema } from './ledger-account.schema';
import { asciiToBase64Url, base64UrlToAscii } from './starter-points.schema';

export const rewardPolicyModeSchema = z.enum(['SHADOW', 'ADVISORY', 'ENFORCED']);
export type RewardPolicyMode = z.infer<typeof rewardPolicyModeSchema>;

export const creditInternalRewardSchema = z.object({
  responseId: z.string().uuid(),
  publisherId: z.string().uuid(),
  respondentId: z.string().uuid().nullable(),
  amount: z.number().int().positive(),
  policyMode: rewardPolicyModeSchema.default('SHADOW'),
});
export type CreditInternalRewardInput = z.input<typeof creditInternalRewardSchema>;
export type CreditInternalRewardDto = z.infer<typeof creditInternalRewardSchema>;

export const creditPendingRewardSchema = z.object({
  attemptId: z.string().uuid(),
  publisherId: z.string().uuid(),
  respondentId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type CreditPendingRewardInput = z.infer<typeof creditPendingRewardSchema>;

export const releasePendingRewardSchema = z.object({
  attemptId: z.string().uuid(),
  respondentId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type ReleasePendingRewardInput = z.infer<typeof releasePendingRewardSchema>;

/**
 * Body of `POST /economy/rewards/release-pending/:attemptId` (Epic 6 review
 * P2). The respondent, the amount and the 48-hour maturity all come from the
 * `external-completion:{attemptId}` credit journal server-side; an Admin may
 * name the expected respondent, which must then match.
 */
export const releasePendingRewardRequestSchema = z
  .object({
    respondentId: z.string().uuid().optional(),
  })
  .strict();
export type ReleasePendingRewardRequest = z.infer<
  typeof releasePendingRewardRequestSchema
>;

export const MATURED_PENDING_RELEASE_MAX_LIMIT = 500;

/**
 * Body of the Admin/worker trigger `POST /economy/rewards/release-matured`
 * (FR-24 scan, Epic 6 review P2). `cutoffDate` is clamped server-side to
 * now − 48 h, so it can only narrow the scan.
 */
/**
 * Story IR.2b Task 6.2: keyset position `(createdAt, journalId)` in the FR-24
 * maturity scan, so persistently failing credits cannot block newer mature
 * ones. Opaque base64url token, server-issued only (same scheme as the
 * starter expiry cursor).
 */
const maturedReleaseCursorSchema = z
  .object({
    createdAt: z.string().datetime(),
    journalId: z.string().uuid(),
  })
  .strict();
export type MaturedReleaseCursor = z.infer<typeof maturedReleaseCursorSchema>;

export function encodeMaturedReleaseCursor(cursor: MaturedReleaseCursor): string {
  return asciiToBase64Url(
    JSON.stringify({ createdAt: cursor.createdAt, journalId: cursor.journalId }),
  );
}

/** The cursor in a token, or `null` unless the token is exactly one we issue. */
export function decodeMaturedReleaseCursor(
  token: string,
): MaturedReleaseCursor | null {
  const json = base64UrlToAscii(token);
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = maturedReleaseCursorSchema.safeParse(value);
  if (!parsed.success) return null;
  return encodeMaturedReleaseCursor(parsed.data) === token ? parsed.data : null;
}

export const maturedReleaseCursorTokenSchema = z
  .string()
  .max(256, 'Invalid release cursor')
  .refine((token) => decodeMaturedReleaseCursor(token) !== null, {
    message: 'Invalid release cursor',
  });

export const releaseMaturedPendingRewardsSchema = z
  .object({
    cutoffDate: z.string().datetime().optional(),
    /** `nextCursor` of the previous batch; omit to scan from the oldest credit. */
    after: maturedReleaseCursorTokenSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MATURED_PENDING_RELEASE_MAX_LIMIT)
      .optional(),
  })
  .strict();
export type ReleaseMaturedPendingRewardsInput = z.infer<
  typeof releaseMaturedPendingRewardsSchema
>;

/**
 * Body of the Admin re-drive endpoints `POST /economy/rewards/internal/:responseId`
 * and `POST /economy/rewards/external/:attemptId` (Epic 6 review P1): every
 * settlement parameter is derived server-side, so the body must be empty.
 */
export const rewardRedriveRequestSchema = z.object({}).strict();
export type RewardRedriveRequest = z.infer<typeof rewardRedriveRequestSchema>;

export const disputeHoldSchema = z.object({
  caseId: z.string().uuid(),
  attemptId: z.string().uuid(),
  respondentId: z.string().uuid(),
  amount: z.number().int().positive(),
});
export type DisputeHoldInput = z.infer<typeof disputeHoldSchema>;

export const disputeHoldOutcomeSchema = z.enum([
  'RELEASE_TO_RESPONDENT',
  'REFUND_TO_PUBLISHER',
]);
export type DisputeHoldOutcome = z.infer<typeof disputeHoldOutcomeSchema>;

export const resolveDisputeHoldSchema = z.object({
  caseId: z.string().uuid(),
  respondentId: z.string().uuid(),
  publisherId: z.string().uuid(),
  amount: z.number().int().positive(),
  outcome: disputeHoldOutcomeSchema,
});
export type ResolveDisputeHoldInput = z.infer<typeof resolveDisputeHoldSchema>;

export const rewardSettlementStatusSchema = z.enum([
  'SETTLED',
  'HELD_IN_INTEGRITY',
  'PENDING',
  'SKIPPED_GUEST',
]);
export type RewardSettlementStatus = z.infer<typeof rewardSettlementStatusSchema>;

export const rewardSettlementResultSchema = z.object({
  status: rewardSettlementStatusSchema,
  journalId: z.string().uuid().nullable(),
  amount: z.number().int().nonnegative(),
  targetAccountClass: ledgerAccountClassSchema.nullable(),
  settledAt: z.string().datetime(),
});
export type RewardSettlementResultDto = z.infer<typeof rewardSettlementResultSchema>;
