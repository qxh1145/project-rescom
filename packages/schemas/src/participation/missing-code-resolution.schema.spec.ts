import {
  MISSING_CODE_AUDIT_EVENT_TYPE,
  MISSING_CODE_RESOLUTION_NOTE_MAX,
  MISSING_CODE_RESOLUTION_NOTE_MIN,
  MISSING_CODE_RESOLUTION_OUTCOMES,
  MISSING_CODE_RESOLVED_EVENT_TYPE,
  missingCodeAuditEventPayloadSchema,
  missingCodeAuditKey,
  missingCodeResolutionOutcomeSchema,
  missingCodeResolvedEventKey,
  missingCodeResolvedEventPayloadSchema,
  resolveMissingCodeReportResultSchema,
  resolveMissingCodeReportSchema,
} from "./missing-code-resolution.schema";
import * as rootExports from "../index";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";
const RESPONDENT_ID = "33333333-3333-4333-8333-333333333333";
const PUBLISHER_ID = "44444444-4444-4444-8444-444444444444";
const JOURNAL_ID = "55555555-5555-4555-8555-555555555555";
const SURVEY_ID = "survey-123";
const NOW = "2026-10-18T12:00:00.000Z";

describe("Missing-Code Resolution shared contracts (Story 14.1)", () => {
  it("exports all symbols from package root", () => {
    expect(rootExports.MISSING_CODE_RESOLUTION_OUTCOMES).toBe(
      MISSING_CODE_RESOLUTION_OUTCOMES,
    );
    expect(rootExports.resolveMissingCodeReportSchema).toBe(
      resolveMissingCodeReportSchema,
    );
    expect(rootExports.resolveMissingCodeReportResultSchema).toBe(
      resolveMissingCodeReportResultSchema,
    );
    expect(rootExports.missingCodeAuditKey).toBe(missingCodeAuditKey);
    expect(rootExports.missingCodeResolvedEventKey).toBe(
      missingCodeResolvedEventKey,
    );
    expect(rootExports.MISSING_CODE_AUDIT_EVENT_TYPE).toBe(
      MISSING_CODE_AUDIT_EVENT_TYPE,
    );
    expect(rootExports.missingCodeAuditEventPayloadSchema).toBe(
      missingCodeAuditEventPayloadSchema,
    );
    expect(rootExports.MISSING_CODE_RESOLVED_EVENT_TYPE).toBe(
      MISSING_CODE_RESOLVED_EVENT_TYPE,
    );
    expect(rootExports.missingCodeResolvedEventPayloadSchema).toBe(
      missingCodeResolvedEventPayloadSchema,
    );
  });

  describe("outcomes and note length bounds", () => {
    it("defines exactly CREDIT_RESPONDENT and DISMISSED", () => {
      expect([...MISSING_CODE_RESOLUTION_OUTCOMES]).toEqual([
        "CREDIT_RESPONDENT",
        "DISMISSED",
      ]);
      expect(
        missingCodeResolutionOutcomeSchema.safeParse("CREDIT_RESPONDENT")
          .success,
      ).toBe(true);
      expect(
        missingCodeResolutionOutcomeSchema.safeParse("DISMISSED").success,
      ).toBe(true);
      expect(
        missingCodeResolutionOutcomeSchema.safeParse("OTHER").success,
      ).toBe(false);
    });

    it("has note length limits of 10 and 500", () => {
      expect(MISSING_CODE_RESOLUTION_NOTE_MIN).toBe(10);
      expect(MISSING_CODE_RESOLUTION_NOTE_MAX).toBe(500);
    });
  });

  describe("resolveMissingCodeReportSchema", () => {
    it("accepts valid input and trims note", () => {
      const parsed = resolveMissingCodeReportSchema.parse({
        outcome: "CREDIT_RESPONDENT",
        note: "   Valid resolution note for user.   ",
      });
      expect(parsed.outcome).toBe("CREDIT_RESPONDENT");
      expect(parsed.note).toBe("Valid resolution note for user.");
    });

    it("rejects untrimmed note whose trimmed length < 10", () => {
      expect(
        resolveMissingCodeReportSchema.safeParse({
          outcome: "DISMISSED",
          note: "   12345   ",
        }).success,
      ).toBe(false);
    });

    it("rejects notes longer than 500 characters", () => {
      expect(
        resolveMissingCodeReportSchema.safeParse({
          outcome: "DISMISSED",
          note: "a".repeat(501),
        }).success,
      ).toBe(false);
    });

    it("is strict and rejects unknown fields", () => {
      expect(
        resolveMissingCodeReportSchema.safeParse({
          outcome: "CREDIT_RESPONDENT",
          note: "Valid resolution note for user.",
          extraField: true,
        }).success,
      ).toBe(false);
    });
  });

  describe("resolveMissingCodeReportResultSchema", () => {
    it("validates successful resolution response", () => {
      const valid = {
        attemptId: ATTEMPT_ID,
        outcome: "CREDIT_RESPONDENT",
        attemptStatus: "COMPLETED",
        rewardPoints: 20,
        replayed: false,
      };
      expect(resolveMissingCodeReportResultSchema.safeParse(valid).success).toBe(
        true,
      );
    });

    it("allows null rewardPoints for DISMISSED outcome", () => {
      const valid = {
        attemptId: ATTEMPT_ID,
        outcome: "DISMISSED",
        attemptStatus: "ABANDONED",
        rewardPoints: null,
        replayed: true,
      };
      expect(resolveMissingCodeReportResultSchema.safeParse(valid).success).toBe(
        true,
      );
    });

    it("rejects non-uuid attemptId and negative rewardPoints", () => {
      expect(
        resolveMissingCodeReportResultSchema.safeParse({
          attemptId: "not-a-uuid",
          outcome: "CREDIT_RESPONDENT",
          attemptStatus: "COMPLETED",
          rewardPoints: 20,
          replayed: false,
        }).success,
      ).toBe(false);

      expect(
        resolveMissingCodeReportResultSchema.safeParse({
          attemptId: ATTEMPT_ID,
          outcome: "CREDIT_RESPONDENT",
          attemptStatus: "COMPLETED",
          rewardPoints: -5,
          replayed: false,
        }).success,
      ).toBe(false);
    });
  });

  describe("keys and events", () => {
    it("builds correct idempotency keys", () => {
      expect(missingCodeAuditKey(ATTEMPT_ID)).toBe(
        `admin-audit:missing-code:${ATTEMPT_ID}`,
      );
      expect(missingCodeResolvedEventKey(ATTEMPT_ID)).toBe(
        `missing-code-resolved:${ATTEMPT_ID}`,
      );
    });

    it("validates audit event payload", () => {
      const payload = {
        schemaVersion: 1,
        action: "MISSING_CODE_REPORT_RESOLVED",
        auditCategory: "MODERATION_ADMIN_ACTION",
        adminId: ADMIN_ID,
        attemptId: ATTEMPT_ID,
        surveyId: SURVEY_ID,
        outcome: "CREDIT_RESPONDENT",
        rewardPoints: 20,
        journalId: JOURNAL_ID,
        noteLength: 28,
        correlationId: "req-123",
        occurredAt: NOW,
      };
      expect(missingCodeAuditEventPayloadSchema.safeParse(payload).success).toBe(
        true,
      );

      // Nullable fields
      expect(
        missingCodeAuditEventPayloadSchema.safeParse({
          ...payload,
          rewardPoints: null,
          journalId: null,
          correlationId: null,
        }).success,
      ).toBe(true);

      // Rejects unknown fields
      expect(
        missingCodeAuditEventPayloadSchema.safeParse({
          ...payload,
          unexpected: 123,
        }).success,
      ).toBe(false);
    });

    it("validates resolved event payload", () => {
      const payload = {
        schemaVersion: 1,
        attemptId: ATTEMPT_ID,
        surveyId: SURVEY_ID,
        surveyTitle: "Test Survey",
        respondentId: RESPONDENT_ID,
        publisherId: PUBLISHER_ID,
        outcome: "CREDIT_RESPONDENT",
        rewardPoints: 20,
        note: "Valid resolution note.",
        occurredAt: NOW,
      };
      expect(
        missingCodeResolvedEventPayloadSchema.safeParse(payload).success,
      ).toBe(true);

      // Dismissed outcome with null rewardPoints
      expect(
        missingCodeResolvedEventPayloadSchema.safeParse({
          ...payload,
          outcome: "DISMISSED",
          rewardPoints: null,
        }).success,
      ).toBe(true);

      // Rejects non-uuid respondentId
      expect(
        missingCodeResolvedEventPayloadSchema.safeParse({
          ...payload,
          respondentId: "invalid",
        }).success,
      ).toBe(false);
    });
  });
});
