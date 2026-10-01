import { z } from "zod";

/**
 * Admin console aggregates (Story IR.4b part C, mock-off plan 4.1):
 * `GET /admin/queue-counts` (sidebar badges) and `GET /admin/overview`
 * ("Tổng quan", Figma 11 62:4070). One shared contract for the backend
 * controller, the frontend services and the MSW handlers.
 *
 * Deliberate override of IR.4b AC C3/C4 (decision Q1, 2026-10-01): disputes
 * and quality reviews stay on MSW in the hybrid mode and the real backend has
 * no case table behind them. Instead of omitting the fields (C3/C4), it
 * answers `disputes: 0` and `quality: 0` in the queue counts and
 * `openIssues.disputes: 0` in the overview, and never emits `DISPUTE` /
 * `MISSING_CODE` to-do items, while the mock pages of those queues still show
 * their sample cases. `openIssues.missingCodeReports` is real data (see
 * below).
 */

const count = z.number().int().nonnegative();

/**
 * - `surveys`: forms waiting in `MODERATION_QUEUE` (Duyệt khảo sát)
 * - `topUps`: `PENDING` top-up requests (Duyệt nạp điểm)
 * - `disputes`: open disputes + missing-code reports (0 on the real backend, see above)
 * - `quality`: rewards held for quality review (0 on the real backend, see above)
 */
export const adminQueueCountsSchema = z
  .object({
    surveys: count,
    topUps: count,
    disputes: count,
    quality: count,
  })
  .strict();
export type AdminQueueCounts = z.infer<typeof adminQueueCountsSchema>;
export type AdminQueue = keyof AdminQueueCounts;

const todoBase = {
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  /** Other items waiting in the same queue ("+2 khảo sát khác"). */
  moreCount: count,
  /** "Ưu tiên": the respondent's points are waiting on this item. */
  priority: z.boolean(),
};

export const adminTodoItemSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("DISPUTE"),
      ...todoBase,
      /** Short attempt reference ("7F3A"). */
      attemptRef: z.string().min(1),
      respondentName: z.string().min(1),
      surveyTitle: z.string().min(1),
      /** When the disputed pending reward would have been released (48h review). */
      pendingReleasesAt: z.string().datetime().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("SURVEY_REVIEW"),
      ...todoBase,
      surveyTitle: z.string().min(1),
      /** Publisher label: display name, else e-mail. */
      publisherName: z.string().min(1),
      surveyType: z.enum(["INTERNAL", "EXTERNAL"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("TOP_UP"),
      ...todoBase,
      points: z.number().int().positive(),
      amountVnd: count,
      /** Requester label: display name, else e-mail. */
      requesterName: z.string().min(1),
      transferReference: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("MISSING_CODE"),
      ...todoBase,
      surveyTitle: z.string().min(1),
      reporterRole: z.enum(["RESPONDENT", "PUBLISHER"]),
    })
    .strict(),
]);
export type AdminTodoItem = z.infer<typeof adminTodoItemSchema>;
export type AdminTodoKind = AdminTodoItem["kind"];

/**
 * An account with FraudLog entries in the last `windowDays` days
 * ("Tài khoản cần xem"). `types` are FraudLog kinds (`fraudLogKindSchema`:
 * the backend `FraudLogType`, with a wrong completion code shown as
 * `COMPLETION_CODE`); `repeated` = repeat offender (the system only flags,
 * an Admin decides the lock).
 */
export const flaggedAccountSchema = z
  .object({
    userId: z.string().uuid(),
    /** Short public reference ("7F3A"): the first 4 hex digits of the id. */
    reference: z.string().min(1),
    violationCount: z.number().int().positive(),
    windowDays: z.number().int().positive(),
    types: z.array(z.string().min(1)),
    repeated: z.boolean(),
  })
  .strict();
export type FlaggedAccount = z.infer<typeof flaggedAccountSchema>;

/** At most this many flagged accounts on the overview (most entries first). */
export const ADMIN_OVERVIEW_FLAGGED_LIMIT = 5;

export const adminOverviewSchema = z
  .object({
    pendingSurveys: z.object({ count }).strict(),
    pendingTopUps: z
      .object({
        count,
        points: count,
        amountVnd: count,
      })
      .strict(),
    /**
     * `disputes`: 0 (deferred, see above). `missingCodeReports`: unresolved
     * FR-23 reports — attempts whose `missing_code_reported_at` is set, that
     * did not complete, and whose respondent got no completion-code limit
     * reset for that form version since the report.
     */
    openIssues: z
      .object({
        disputes: count,
        missingCodeReports: count,
      })
      .strict(),
    /**
     * `points`: sum of every ESCROW ledger balance (ledger truth; it also holds
     * the escrow of surveys waiting for moderation); `runningSurveys`: forms
     * in `PUBLISHED`.
     */
    escrow: z
      .object({
        points: count,
        runningSurveys: count,
      })
      .strict(),
    /** The oldest item of each non-empty queue ("Việc cần làm · cũ nhất trước"). */
    todo: z.array(adminTodoItemSchema),
    flaggedAccounts: z.array(flaggedAccountSchema).max(ADMIN_OVERVIEW_FLAGGED_LIMIT),
  })
  .strict();
export type AdminOverview = z.infer<typeof adminOverviewSchema>;
