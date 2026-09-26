import { z } from "zod";

/**
 * Manual Point top-up contracts (Story 6.6, FR-34/FR-35, AD-16).
 *
 * A user creates a transfer request ("Pending Payment" = `PENDING`), pays by
 * bank transfer using the unique transfer syntax, and an Admin approves it.
 * Approval posts exactly one Ledger journal keyed `topup-approval:{topUpId}`.
 * Top-up is one-way: there is no refund or account-to-account transfer.
 */

/** 1 Point = 200 VND when topping up (PRD glossary "Point"). */
export const POINT_VND_RATE = 200;
/** FR-34: minimum purchase is 100 Points (20,000 VND). */
export const TOP_UP_MIN_POINTS = 100;
/** Upper bound per request (10,000,000 VND); an abuse/overflow guard, not a PRD rule. */
export const TOP_UP_MAX_POINTS = 50_000;
/** Open (PENDING) requests a user may hold at once. */
export const TOP_UP_MAX_PENDING_REQUESTS = 3;
export const TOP_UP_PRESET_AMOUNTS = [100, 250, 500, 1000] as const;

export const TOP_UP_REFERENCE_PREFIX = "RESCOM";
/** 32 characters without the ambiguous 0/O/1/I, so `byte % 32` is unbiased. */
export const TOP_UP_REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const TOP_UP_REFERENCE_CODE_LENGTH = 8;

export const TOP_UP_REJECTION_REASON_MIN_LENGTH = 5;
export const TOP_UP_REJECTION_REASON_MAX_LENGTH = 500;
export const TOP_UP_LIST_DEFAULT_LIMIT = 20;
export const TOP_UP_LIST_MAX_LIMIT = 50;

/** Ledger idempotency / notification identity of an approval. */
export function topUpApprovalKey(topUpId: string): string {
  return `topup-approval:${topUpId}`;
}

/** Notification identity of a rejection (no journal is posted). */
export function topUpRejectionKey(topUpId: string): string {
  return `topup-rejection:${topUpId}`;
}

/** Must stay identical to the Prisma `TopUpStatus` enum. `PENDING` is "Pending Payment". */
export const topUpStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type TopUpStatus = z.infer<typeof topUpStatusSchema>;

export const topUpAmountSchema = z
  .number({ invalid_type_error: "Amount must be a number of points" })
  .int("Amount must be a whole number of points")
  .min(TOP_UP_MIN_POINTS, `Minimum top-up is ${TOP_UP_MIN_POINTS} points`)
  .max(TOP_UP_MAX_POINTS, `Maximum top-up is ${TOP_UP_MAX_POINTS} points`);

export const createTopUpRequestSchema = z
  .object({
    amount: topUpAmountSchema,
  })
  .strict();
export type CreateTopUpRequestInput = z.infer<typeof createTopUpRequestSchema>;

export const topUpReferenceSchema = z
  .string()
  .regex(
    new RegExp(
      `^${TOP_UP_REFERENCE_PREFIX}[A-HJ-NP-Z2-9]{${TOP_UP_REFERENCE_CODE_LENGTH}}$`,
    ),
    "Invalid top-up transfer reference",
  );

export const topUpPaymentInstructionsSchema = z.object({
  bankName: z.string().min(1),
  bankBin: z.string().regex(/^\d{6}$/, "bankBin must be a 6-digit bank BIN"),
  accountNumber: z
    .string()
    .regex(/^\d{6,19}$/, "accountNumber must contain 6-19 digits"),
  accountName: z.string().min(1),
  amountVnd: z.number().int().positive(),
  transferContent: topUpReferenceSchema,
  /** EMVCo/NAPAS VietQR payload; a QR encoder turns it into the scannable code. */
  qrPayload: z.string().min(1),
});
export type TopUpPaymentInstructionsDto = z.infer<
  typeof topUpPaymentInstructionsSchema
>;

export const topUpRequestSchema = z.object({
  id: z.string().uuid(),
  amount: topUpAmountSchema,
  amountVnd: z.number().int().positive(),
  status: topUpStatusSchema,
  transferReference: topUpReferenceSchema,
  rejectionReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
  /** Present only while the request is `PENDING` (awaiting payment/review). */
  paymentInstructions: topUpPaymentInstructionsSchema.nullable(),
});
export type TopUpRequestDto = z.infer<typeof topUpRequestSchema>;

export const adminTopUpRequestSchema = topUpRequestSchema.extend({
  userId: z.string().uuid(),
  userEmail: z.string().nullable(),
  adminId: z.string().uuid().nullable(),
  journalId: z.string().uuid().nullable(),
  correlationId: z.string().uuid().nullable(),
});
export type AdminTopUpRequestDto = z.infer<typeof adminTopUpRequestSchema>;

/** Query-string tolerant list parameters. */
export const listTopUpRequestsQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int("limit must be an integer")
      .min(1, "limit must be at least 1")
      .max(TOP_UP_LIST_MAX_LIMIT, `limit must be at most ${TOP_UP_LIST_MAX_LIMIT}`)
      .default(TOP_UP_LIST_DEFAULT_LIMIT),
    offset: z.coerce
      .number()
      .int("offset must be an integer")
      .min(0, "offset cannot be negative")
      .default(0),
    status: topUpStatusSchema.optional(),
  })
  .strict();
export type ListTopUpRequestsQuery = z.infer<
  typeof listTopUpRequestsQuerySchema
>;

export const topUpRequestListSchema = z.object({
  items: z.array(topUpRequestSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type TopUpRequestListDto = z.infer<typeof topUpRequestListSchema>;

export const adminTopUpRequestListSchema = z.object({
  items: z.array(adminTopUpRequestSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type AdminTopUpRequestListDto = z.infer<
  typeof adminTopUpRequestListSchema
>;

export const rejectTopUpRequestSchema = z
  .object({
    reason: z
      .string({ required_error: "A rejection reason is required" })
      .trim()
      .min(
        TOP_UP_REJECTION_REASON_MIN_LENGTH,
        `Rejection reason must be at least ${TOP_UP_REJECTION_REASON_MIN_LENGTH} characters`,
      )
      .max(
        TOP_UP_REJECTION_REASON_MAX_LENGTH,
        `Rejection reason must be at most ${TOP_UP_REJECTION_REASON_MAX_LENGTH} characters`,
      ),
  })
  .strict();
export type RejectTopUpRequestInput = z.infer<typeof rejectTopUpRequestSchema>;

export const topUpReviewResultSchema = z.object({
  topUp: adminTopUpRequestSchema,
  journalId: z.string().uuid().nullable(),
  /** True when the decision already existed and this call returned it unchanged. */
  replayed: z.boolean(),
});
export type TopUpReviewResultDto = z.infer<typeof topUpReviewResultSchema>;

export const TOP_UP_AUDIT_EVENT_TYPES = {
  APPROVED: "AdminTopUpApproved",
  REJECTED: "AdminTopUpRejected",
} as const;

/**
 * Replayable Moderation admin-audit event emitted through the Outbox in the
 * same transaction as the decision (AD-16). Consumers must dedupe by the
 * Outbox idempotency key; replay can never re-credit Points.
 */
export const topUpAdminAuditEventPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  auditCategory: z.literal("MODERATION_ADMIN_ACTION"),
  action: z.enum(["TOPUP_APPROVED", "TOPUP_REJECTED"]),
  topUpId: z.string().uuid(),
  userId: z.string().uuid(),
  adminId: z.string().uuid(),
  amount: z.number().int().positive(),
  amountVnd: z.number().int().positive(),
  transferReference: topUpReferenceSchema,
  journalId: z.string().uuid().nullable(),
  ledgerIdempotencyKey: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  correlationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});
export type TopUpAdminAuditEventPayload = z.infer<
  typeof topUpAdminAuditEventPayloadSchema
>;

/** Converts Points to the VND amount the user must transfer. */
export function pointsToVnd(points: number): number {
  if (!Number.isInteger(points) || points < 0) {
    throw new Error("Points must be a non-negative integer");
  }
  return points * POINT_VND_RATE;
}

/**
 * Builds the unique transfer syntax (e.g. `RESCOMK7Q2M9XA`) from at least
 * `TOP_UP_REFERENCE_CODE_LENGTH` random bytes supplied by the caller.
 */
export function buildTopUpReference(randomBytes: Uint8Array): string {
  if (randomBytes.length < TOP_UP_REFERENCE_CODE_LENGTH) {
    throw new Error(
      `At least ${TOP_UP_REFERENCE_CODE_LENGTH} random bytes are required`,
    );
  }
  let code = "";
  for (let index = 0; index < TOP_UP_REFERENCE_CODE_LENGTH; index += 1) {
    code +=
      TOP_UP_REFERENCE_ALPHABET[
        randomBytes[index] % TOP_UP_REFERENCE_ALPHABET.length
      ];
  }
  return `${TOP_UP_REFERENCE_PREFIX}${code}`;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) as 4 uppercase hex chars. */
export function crc16CcittFalse(text: string): string {
  let crc = 0xffff;
  for (let index = 0; index < text.length; index += 1) {
    crc ^= text.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function emvField(id: string, value: string): string {
  if (value.length > 99) {
    throw new Error(`EMV field ${id} exceeds 99 characters`);
  }
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

export interface VietQrPayloadInput {
  bankBin: string;
  accountNumber: string;
  amountVnd: number;
  transferContent: string;
}

/**
 * Builds a dynamic NAPAS VietQR (EMVCo) bank-transfer payload. Banking apps
 * scan it to prefill the beneficiary, amount and transfer content.
 */
export function buildVietQrPayload(input: VietQrPayloadInput): string {
  if (!/^\d{6}$/.test(input.bankBin)) {
    throw new Error("bankBin must be a 6-digit bank BIN");
  }
  if (!/^\d{6,19}$/.test(input.accountNumber)) {
    throw new Error("accountNumber must contain 6-19 digits");
  }
  if (!Number.isInteger(input.amountVnd) || input.amountVnd <= 0) {
    throw new Error("amountVnd must be a positive integer");
  }
  if (!/^[A-Za-z0-9 ]{1,25}$/.test(input.transferContent)) {
    throw new Error(
      "transferContent must be 1-25 ASCII letters, digits or spaces",
    );
  }

  const beneficiary =
    emvField("00", input.bankBin) + emvField("01", input.accountNumber);
  const merchantAccount =
    emvField("00", "A000000727") +
    emvField("01", beneficiary) +
    emvField("02", "QRIBFTTA");

  const body =
    emvField("00", "01") +
    emvField("01", "12") +
    emvField("38", merchantAccount) +
    emvField("53", "704") +
    emvField("54", String(input.amountVnd)) +
    emvField("58", "VN") +
    emvField("62", emvField("08", input.transferContent)) +
    "6304";

  return `${body}${crc16CcittFalse(body)}`;
}
