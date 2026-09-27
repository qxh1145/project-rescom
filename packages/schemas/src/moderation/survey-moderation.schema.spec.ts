import {
  MODERATION_QUEUE_MAX_LIMIT,
  MODERATION_QUEUE_MAX_OFFSET,
  SURVEY_MODERATION_AUDIT_EVENT_TYPES,
  approveSurveyModerationSchema,
  listModerationQueueQuerySchema,
  moderationQueueItemSchema,
  moderationSurveyPreviewSchema,
  rejectSurveyModerationSchema,
  surveyModerationAuditEventPayloadSchema,
  surveyModerationKey,
  surveyModerationOutcomeSchema,
  surveyModerationResultSchema,
} from "./survey-moderation.schema";
import * as rootExports from "../index";

const FORM_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PUBLISHER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const CORRELATION_ID = "55555555-5555-4555-8555-555555555555";

const queueItem = {
  formId: FORM_ID,
  formVersionId: VERSION_ID,
  versionNumber: 1,
  title: "Khảo sát thói quen học tập",
  description: null,
  type: "INTERNAL",
  status: "MODERATION_QUEUE",
  publisherId: PUBLISHER_ID,
  publisherEmail: "publisher@fpt.edu.vn",
  rewardPerResponse: 10,
  expectedCompletions: 50,
  effectiveRewardPerResponse: 8,
  escrowAmount: 400,
  estimatedEffortSeconds: 120,
  blocksCount: 3,
  externalUrl: null,
  targetingJson: null,
  isResubmission: false,
  submittedAt: "2026-09-26T10:00:00.000Z",
};

const decision = {
  id: "66666666-6666-4666-8666-666666666666",
  formId: FORM_ID,
  formVersionId: VERSION_ID,
  versionNumber: 1,
  outcome: "REJECTED",
  adminId: ADMIN_ID,
  reason: "Nội dung vi phạm quy định",
  refundAmount: 400,
  refundJournalId: "77777777-7777-4777-8777-777777777777",
  correlationId: CORRELATION_ID,
  decidedAt: "2026-09-26T11:00:00.000Z",
};

describe("Story 8.1: survey moderation contracts", () => {
  it("is exported from the package root", () => {
    expect(rootExports.surveyModerationKey).toBe(surveyModerationKey);
    expect(rootExports.moderationQueueListSchema).toBeDefined();
  });

  it("builds the per-version moderation key", () => {
    expect(surveyModerationKey(VERSION_ID)).toBe(`moderation:${VERSION_ID}`);
  });

  it("mirrors the Prisma SurveyModerationOutcome enum", () => {
    expect(surveyModerationOutcomeSchema.options).toEqual(["APPROVED", "REJECTED"]);
  });

  describe("listModerationQueueQuerySchema", () => {
    it("applies defaults and coerces query strings", () => {
      expect(listModerationQueueQuerySchema.parse({})).toEqual({ limit: 20, offset: 0 });
      expect(listModerationQueueQuerySchema.parse({ limit: "5", offset: "10" })).toEqual({
        limit: 5,
        offset: 10,
      });
    });

    it("rejects out-of-range and unknown parameters", () => {
      expect(
        listModerationQueueQuerySchema.safeParse({ limit: MODERATION_QUEUE_MAX_LIMIT + 1 }).success,
      ).toBe(false);
      expect(listModerationQueueQuerySchema.safeParse({ offset: -1 }).success).toBe(false);
      expect(listModerationQueueQuerySchema.safeParse({ status: "PENDING" }).success).toBe(false);
    });

    it("bounds the offset so a huge value is a 400, never a database error (review P7)", () => {
      expect(MODERATION_QUEUE_MAX_OFFSET).toBe(10_000);
      expect(listModerationQueueQuerySchema.safeParse({ offset: "1e20" }).success).toBe(false);
      expect(
        listModerationQueueQuerySchema.safeParse({ offset: MODERATION_QUEUE_MAX_OFFSET + 1 }).success,
      ).toBe(false);
      expect(
        listModerationQueueQuerySchema.parse({ offset: String(MODERATION_QUEUE_MAX_OFFSET) }),
      ).toEqual({ limit: 20, offset: MODERATION_QUEUE_MAX_OFFSET });
    });
  });

  it("validates queue items and previews", () => {
    expect(moderationQueueItemSchema.safeParse(queueItem).success).toBe(true);
    expect(
      moderationQueueItemSchema.safeParse({ ...queueItem, formVersionId: "nope" }).success,
    ).toBe(false);
    const preview = moderationSurveyPreviewSchema.safeParse({
      ...queueItem,
      schemaJson: { schemaVersion: 1, title: "x", blocks: [] },
      decision,
      escrowHeld: null,
      fundingShortfall: null,
    });
    expect(preview.success).toBe(true);
    expect(
      moderationSurveyPreviewSchema.safeParse({
        ...queueItem,
        schemaJson: null,
        decision: null,
        escrowHeld: 400,
        fundingShortfall: 0,
      }).success,
    ).toBe(true);
    expect(
      moderationSurveyPreviewSchema.safeParse({
        ...queueItem,
        schemaJson: null,
        decision: null,
        escrowHeld: -1,
        fundingShortfall: 0,
      }).success,
    ).toBe(false);
  });

  it("flags invalid stored targeting and defaults the flag to false (review P6)", () => {
    expect(moderationQueueItemSchema.parse(queueItem).targetingInvalid).toBe(false);
    expect(
      moderationQueueItemSchema.parse({ ...queueItem, targetingInvalid: true }).targetingInvalid,
    ).toBe(true);
  });

  describe("approveSurveyModerationSchema", () => {
    it("requires the previewed formVersionId and accepts an optional note", () => {
      expect(approveSurveyModerationSchema.safeParse({ formVersionId: VERSION_ID }).success).toBe(
        true,
      );
      expect(
        approveSurveyModerationSchema.safeParse({ formVersionId: VERSION_ID, note: "  OK  " }),
      ).toEqual({ success: true, data: { formVersionId: VERSION_ID, note: "OK" } });
      expect(approveSurveyModerationSchema.safeParse({}).success).toBe(false);
      expect(
        approveSurveyModerationSchema.safeParse({ formVersionId: VERSION_ID, extra: 1 }).success,
      ).toBe(false);
    });
  });

  describe("rejectSurveyModerationSchema", () => {
    it("requires a trimmed reason of 5-500 characters", () => {
      expect(
        rejectSurveyModerationSchema.parse({ formVersionId: VERSION_ID, reason: "  Spam link  " }),
      ).toEqual({ formVersionId: VERSION_ID, reason: "Spam link" });
      expect(
        rejectSurveyModerationSchema.safeParse({ formVersionId: VERSION_ID, reason: "  abc  " })
          .success,
      ).toBe(false);
      expect(
        rejectSurveyModerationSchema.safeParse({
          formVersionId: VERSION_ID,
          reason: "x".repeat(501),
        }).success,
      ).toBe(false);
      expect(rejectSurveyModerationSchema.safeParse({ formVersionId: VERSION_ID }).success).toBe(
        false,
      );
    });
  });

  it("validates the decision result envelope", () => {
    expect(
      surveyModerationResultSchema.safeParse({
        decision,
        form: {
          id: FORM_ID,
          status: "CLOSED",
          currentVersionId: VERSION_ID,
          isPublished: false,
          publishedAt: null,
        },
        replayed: false,
      }).success,
    ).toBe(true);
  });

  it("defines the replayable admin-audit event contract", () => {
    expect(SURVEY_MODERATION_AUDIT_EVENT_TYPES).toEqual({
      APPROVED: "AdminSurveyApproved",
      REJECTED: "AdminSurveyRejected",
    });
    const payload = {
      schemaVersion: 1,
      auditCategory: "MODERATION_ADMIN_ACTION",
      action: "SURVEY_REJECTED",
      decisionId: decision.id,
      formId: FORM_ID,
      formVersionId: VERSION_ID,
      versionNumber: 1,
      publisherId: PUBLISHER_ID,
      adminId: ADMIN_ID,
      reason: decision.reason,
      refundAmount: 400,
      refundJournalId: decision.refundJournalId,
      ledgerIdempotencyKey: `close-refund:${FORM_ID}:1`,
      correlationId: CORRELATION_ID,
      occurredAt: decision.decidedAt,
    };
    expect(surveyModerationAuditEventPayloadSchema.safeParse(payload).success).toBe(true);
    expect(
      surveyModerationAuditEventPayloadSchema.safeParse({ ...payload, action: "TOPUP_APPROVED" })
        .success,
    ).toBe(false);
  });
});
