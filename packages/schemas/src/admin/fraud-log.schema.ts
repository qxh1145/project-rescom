import { z } from "zod";
import { userStatusSchema } from "../users/admin-users.schema";
import { keysetCursorSchema } from "./keyset-cursor";

/**
 * Admin · FraudLog (Figma 11e, 62:2195; mock-off plan 4.2): read only
 * ("không sửa, không xoá") view of the append-only `fraud_logs` table.
 *
 * `GET /admin/fraud-log?userId|search&days&type&limit&cursor`, newest first
 * (ties by id descending), keyset `cursor` = `nextCursor` of the previous page.
 */

/** Backend `FraudLogType` (Prisma enum). */
export const fraudLogTypeSchema = z.enum([
  "TIME_BARRIER",
  "RATE_LIMIT",
  "DEMO_MISMATCH",
  "RECAPTCHA_FAIL",
  "SECURITY_VIOLATION",
]);
export type FraudLogType = z.infer<typeof fraudLogTypeSchema>;

/** `details.action` of a wrong completion code (a `SECURITY_VIOLATION` row). */
export const WRONG_COMPLETION_CODE_ACTION = "COMPLETION_CODE_VERIFICATION_FAILED";

/**
 * What the admin filters and reads as the row's kind: the backend type, except
 * that a wrong completion code is `COMPLETION_CODE` (Figma) and is no longer a
 * plain `SECURITY_VIOLATION`. `COMPLAINT_UPHELD` (Figma) belongs to the
 * deferred disputes (Story 8.5): the backend writes no such row yet.
 */
export const fraudLogKindSchema = z.enum([
  ...fraudLogTypeSchema.options,
  "COMPLETION_CODE",
  "COMPLAINT_UPHELD",
]);
export type FraudLogKind = z.infer<typeof fraudLogKindSchema>;

export function fraudLogKindOf(entry: { type: string; details?: Record<string, unknown> | null }): string {
  if (entry.type === "SECURITY_VIOLATION" && entry.details?.action === WRONG_COMPLETION_CODE_ACTION) {
    return "COMPLETION_CODE";
  }
  return entry.type;
}

/** Repeat offender ("Lặp lại"): at least this many entries in the last 14 days. */
export const FRAUD_REPEAT_THRESHOLD = 3;
export const FRAUD_REPEAT_WINDOW_DAYS = 14;

export const FRAUD_LOG_MAX_LIMIT = 100;
/** At most this many accounts in `accounts` (most entries first). */
export const FRAUD_LOG_MAX_ACCOUNTS = 100;
/**
 * Bounded scan: `total` and `accounts` are computed over at most the newest
 * `FRAUD_LOG_SCAN_CAP` matching entries (`totalCapped` / `truncated` say when
 * the cap was hit), so an all-time filter never aggregates the whole table.
 */
export const FRAUD_LOG_SCAN_CAP = 10_000;
/**
 * A `search` is resolved against the accounts that have matching entries:
 * at most this many of them (latest entry first) are checked against the term.
 */
export const FRAUD_LOG_MAX_SEARCH_CANDIDATES = 1_000;

/**
 * `#7f3a` / `7F3A` → `7f3a` when a search term can be an account short code
 * (a prefix of the id's hex digits, at least 2), else null.
 */
export function shortCodePrefixOf(term: string): string | null {
  const hex = term.trim().replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{2,32}$/.test(hex) ? hex : null;
}

export const listFraudLogQuerySchema = z
  .object({
    /** Exact account; takes precedence over `search`. */
    userId: z.string().uuid().optional(),
    /** Short code (`#7F3A`), display name or e-mail fragment. */
    search: z.string().trim().min(1).max(100).optional(),
    /** Window in days; omitted = all time. */
    days: z
      .enum(["7", "14", "30"])
      .transform((value) => Number(value) as 7 | 14 | 30)
      .optional(),
    type: fraudLogKindSchema.optional(),
    limit: z.coerce.number().int().min(1).max(FRAUD_LOG_MAX_LIMIT).default(FRAUD_LOG_MAX_LIMIT),
    cursor: keysetCursorSchema.optional(),
  })
  .strict();
export type ListFraudLogQuery = z.infer<typeof listFraudLogQuerySchema>;

export const fraudLogEntrySchema = z
  .object({
    id: z.string().min(1),
    userId: z.string().uuid(),
    /** Backend type; unknown values still render (raw code). */
    type: z.string().min(1),
    /** The survey the entry is about, when its evidence names one. */
    survey: z.object({ id: z.string().min(1), title: z.string() }).strict().nullable(),
    /** Evidence written by the backend (`elapsedSeconds`, `failureCount`…), never a candidate code. */
    details: z.record(z.unknown()).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type FraudLogEntry = z.infer<typeof fraudLogEntrySchema>;

export const fraudLogAccountSchema = z
  .object({
    userId: z.string().uuid(),
    /** Entries of this account matching the filter (within the scan cap). */
    count: z.number().int().nonnegative(),
    /** Repeat offender over the last 14 days, whatever the filter. */
    repeated: z.boolean(),
    status: userStatusSchema,
  })
  .strict();
export type FraudLogAccount = z.infer<typeof fraudLogAccountSchema>;

export const fraudLogPageSchema = z
  .object({
    items: z.array(fraudLogEntrySchema).max(FRAUD_LOG_MAX_LIMIT),
    /** Entries matching the filter (every page), at most `FRAUD_LOG_SCAN_CAP`. */
    total: z.number().int().nonnegative().max(FRAUD_LOG_SCAN_CAP),
    /** More than `FRAUD_LOG_SCAN_CAP` entries match: `total` is a lower bound ("10 000+"). */
    totalCapped: z.boolean(),
    /**
     * A bound cut the summary or the search: more than `FRAUD_LOG_SCAN_CAP`
     * entries, more than `FRAUD_LOG_MAX_ACCOUNTS` accounts, or more than
     * `FRAUD_LOG_MAX_SEARCH_CANDIDATES` accounts checked by `search`. The
     * screen asks the Admin to narrow the filter ("thu hẹp bộ lọc").
     */
    truncated: z.boolean(),
    windowDays: z.union([z.literal(7), z.literal(14), z.literal(30)]).nullable(),
    accounts: z.array(fraudLogAccountSchema).max(FRAUD_LOG_MAX_ACCOUNTS),
    /** `cursor` of the next page; null on the last page. */
    nextCursor: z.string().nullable(),
  })
  .strict();
export type FraudLogPage = z.infer<typeof fraudLogPageSchema>;
