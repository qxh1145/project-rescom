import { z } from "zod";

export const STARTER_POINTS_DEFAULT_AMOUNT = 100;
export const STARTER_POINTS_EXPIRY_DAYS = 30;

export const grantStarterPointsSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
  amount: z
    .number()
    .int("Amount must be an integer")
    .positive("Amount must be positive")
    .default(STARTER_POINTS_DEFAULT_AMOUNT),
});

export type GrantStarterPointsInput = z.infer<typeof grantStarterPointsSchema>;

export const unlockStarterPointsSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
});

export type UnlockStarterPointsInput = z.infer<typeof unlockStarterPointsSchema>;

// ---------------------------------------------------------------------------
// Expiry sweep batches: candidates are scanned oldest registration first,
// ordered by (registeredAt, userId), at most `limit` per request. The opaque
// `nextCursor` / `after` token is base64url JSON of the last scanned candidate.
// ---------------------------------------------------------------------------

export const STARTER_POINTS_EXPIRY_BATCH_DEFAULT_LIMIT = 100;
export const STARTER_POINTS_EXPIRY_BATCH_MAX_LIMIT = 500;

/** Position of the expiry sweep: the last candidate a batch scanned. */
export const starterPointsExpiryCursorSchema = z
  .object({
    registeredAt: z.string().datetime(),
    userId: z.string().uuid(),
  })
  .strict();

export type StarterPointsExpiryCursor = z.infer<
  typeof starterPointsExpiryCursorSchema
>;

const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url of an ASCII string (no Buffer/btoa: runs anywhere). */
export function asciiToBase64Url(ascii: string): string {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < ascii.length; i++) {
    buffer = (buffer << 8) | (ascii.charCodeAt(i) & 0xff);
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      output += BASE64URL_ALPHABET[(buffer >> bits) & 0x3f];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) {
    output += BASE64URL_ALPHABET[(buffer << (6 - bits)) & 0x3f];
  }
  return output;
}

export function base64UrlToAscii(encoded: string): string | null {
  let output = "";
  let buffer = 0;
  let bits = 0;
  for (const char of encoded) {
    const value = BASE64URL_ALPHABET.indexOf(char);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
    buffer &= (1 << bits) - 1;
  }
  return output;
}

export function encodeStarterPointsExpiryCursor(
  cursor: StarterPointsExpiryCursor,
): string {
  return asciiToBase64Url(
    JSON.stringify({ registeredAt: cursor.registeredAt, userId: cursor.userId }),
  );
}

/** The cursor in a token, or `null` unless the token is exactly one we issue. */
export function decodeStarterPointsExpiryCursor(
  token: string,
): StarterPointsExpiryCursor | null {
  const json = base64UrlToAscii(token);
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = starterPointsExpiryCursorSchema.safeParse(value);
  if (!parsed.success) return null;
  return encodeStarterPointsExpiryCursor(parsed.data) === token
    ? parsed.data
    : null;
}

export const starterPointsExpiryCursorTokenSchema = z
  .string()
  .max(256, "Invalid expiry cursor")
  .refine((token) => decodeStarterPointsExpiryCursor(token) !== null, {
    message: "Invalid expiry cursor",
  });

export const expireStarterPointsSchema = z.object({
  cutoffDate: z.string().datetime().optional(),
  /** Candidates scanned by this request. */
  limit: z
    .number()
    .int("limit must be an integer")
    .min(1, "limit must be at least 1")
    .max(
      STARTER_POINTS_EXPIRY_BATCH_MAX_LIMIT,
      `limit must be at most ${STARTER_POINTS_EXPIRY_BATCH_MAX_LIMIT}`,
    )
    .default(STARTER_POINTS_EXPIRY_BATCH_DEFAULT_LIMIT),
  /** `nextCursor` of the previous batch; omit to start from the oldest registration. */
  after: starterPointsExpiryCursorTokenSchema.optional(),
});

export type ExpireStarterPointsInput = z.infer<typeof expireStarterPointsSchema>;

// ---------------------------------------------------------------------------
// Marketplace activation step (Story 7.2, FR-7/FR-8). The rule itself lives in
// `starter-activation.ts` (`evaluateStarterActivation`).
// ---------------------------------------------------------------------------

/** FR-24: External completions stay under Publisher review for 48 hours. */
export const EXTERNAL_COMPLETION_REVIEW_HOURS = 48;

/**
 * Decision E7-DN2 (option B(1)): only a survey paying at least this many
 * points per response counts toward activation, so every qualifying External
 * completion has a reversible Pending credit and a colluding zero-reward
 * survey cannot farm starter points.
 */
export const STARTER_ACTIVATION_MIN_SURVEY_REWARD = 1;

/** Human-readable onboarding steps kept stable for API consumers (Story 6.5). */
export const STARTER_ACTIVATION_MISSING_STEPS = {
  DEMOGRAPHICS: "Complete Mandatory Demographic Survey",
  MARKETPLACE_SURVEY: "Complete 1 Marketplace Survey",
} as const;

export const STARTER_ACTIVATION_STATES = [
  "NOT_GRANTED",
  "DEMOGRAPHICS_REQUIRED",
  "SURVEY_REQUIRED",
  "PENDING_CONFIRMATION",
  "READY_TO_UNLOCK",
  "ACTIVATED",
  "EXPIRED",
] as const;

export const starterActivationStateSchema = z.enum(STARTER_ACTIVATION_STATES);
export type StarterActivationState = z.infer<typeof starterActivationStateSchema>;

export const activationSurveySourceSchema = z.enum(["INTERNAL", "EXTERNAL"]);
export type ActivationSurveySource = z.infer<typeof activationSurveySourceSchema>;

export const activationSurveyStatusSchema = z.enum(["CONFIRMED", "PENDING_REVIEW"]);
export type ActivationSurveyStatus = z.infer<typeof activationSurveyStatusSchema>;

/** The Marketplace survey that activated (or will activate) the account. */
export const activationSurveySchema = z.object({
  source: activationSurveySourceSchema,
  formId: z.string().min(1),
  completedAt: z.string().datetime(),
  /** When the completion counts: Internal = completedAt, External = +48 h. */
  confirmsAt: z.string().datetime(),
  status: activationSurveyStatusSchema,
});
export type ActivationSurveyDto = z.infer<typeof activationSurveySchema>;

export const starterPointsStatusSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
  isGranted: z.boolean(),
  frozenBalance: z.number().int().min(0, "frozenBalance cannot be negative"),
  isDemographicComplete: z.boolean(),
  hasCompletedMarketplaceSurvey: z.boolean(),
  isUnlocked: z.boolean(),
  isExpired: z.boolean(),
  registeredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  daysRemaining: z.number().int().min(0, "daysRemaining cannot be negative"),
  unlockEligibility: z.object({
    eligible: z.boolean(),
    missingSteps: z.array(z.string()),
  }),
  /** Story 7.2: where the respondent is in the activation step. */
  activationState: starterActivationStateSchema,
  /** When the `starter-unlock` journal was posted (the starter points unlocked). */
  activatedAt: z.string().datetime().nullable(),
  /**
   * FR-7 "Verified Member" (decision E7-DN3): both onboarding steps are done —
   * a complete demographic profile and a confirmed eligible Marketplace
   * completion at any time — or the starter points were unlocked. Independent
   * of the 30-day window: expiry forfeits only the points (FR-5).
   */
  isVerifiedMember: z.boolean(),
  /** The survey that activated / will activate the account, if any. */
  activationSurvey: activationSurveySchema.nullable(),
});

export type StarterPointsStatusDto = z.infer<typeof starterPointsStatusSchema>;

/** `POST /economy/starter-points/unlock` result (Story 6.5, extended by 7.2). */
export const starterPointsUnlockResultSchema = z.object({
  unlocked: z.boolean(),
  amount: z.number().int().positive().optional(),
  journalId: z.string().min(1).optional(),
  missingSteps: z.array(z.string()).optional(),
  reason: z.string().optional(),
  activationState: starterActivationStateSchema.optional(),
});

export type StarterPointsUnlockResultDto = z.infer<
  typeof starterPointsUnlockResultSchema
>;

export const expireStarterPointsResultSchema = z.object({
  scannedCount: z.number().int().min(0),
  expiredCount: z.number().int().min(0),
  expiredUserIds: z.array(z.string().uuid()),
  totalPointsVoided: z.number().int().min(0),
  /** Story 7.2: users with an in-window qualifying survey are unlocked, not expired. */
  unlockedUserIds: z.array(z.string().uuid()),
  /** Story 7.2: users whose in-window External survey is still under review. */
  deferredCount: z.number().int().min(0),
  /** Candidates whose unlock/expiry failed; retried by the next sweep. */
  failedCount: z.number().int().min(0),
  timestamp: z.string().datetime(),
  /**
   * Pass as `after` to scan the next batch; `null` once the sweep has reached
   * the newest eligible registration. Every scanned candidate (including
   * deferred and failed ones) is behind it.
   */
  nextCursor: starterPointsExpiryCursorTokenSchema.nullable().optional(),
});

export type ExpireStarterPointsResultDto = z.infer<
  typeof expireStarterPointsResultSchema
>;
