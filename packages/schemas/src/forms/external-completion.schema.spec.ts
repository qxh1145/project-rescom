import {
  verifyExternalCompletionCodeInputSchema,
  verifyExternalCompletionCodeResponseSchema,
  reportMissingCompletionCodeInputSchema,
  reportMissingCompletionCodeResponseSchema,
} from './external-completion.schema';

describe('External Completion Schemas', () => {
  describe('verifyExternalCompletionCodeInputSchema', () => {
    it('should validate valid 6-digit numeric code', () => {
      const valid = {
        attemptId: '123e4567-e89b-12d3-a456-426614174000',
        completionCode: '123456',
      };
      const res = verifyExternalCompletionCodeInputSchema.safeParse(valid);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.completionCode).toBe('123456');
      }
    });

    it('should trim whitespace from completionCode', () => {
      const valid = {
        completionCode: '  654321  ',
      };
      const res = verifyExternalCompletionCodeInputSchema.safeParse(valid);
      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.completionCode).toBe('654321');
      }
    });

    it('should reject non-6-digit codes', () => {
      expect(
        verifyExternalCompletionCodeInputSchema.safeParse({
          completionCode: '12345',
        }).success,
      ).toBe(false);

      expect(
        verifyExternalCompletionCodeInputSchema.safeParse({
          completionCode: '1234567',
        }).success,
      ).toBe(false);

      expect(
        verifyExternalCompletionCodeInputSchema.safeParse({
          completionCode: '123-56',
        }).success,
      ).toBe(false);

      // Admin surveys use the fixed alphanumeric code (2026-10-10).
      expect(
        verifyExternalCompletionCodeInputSchema.safeParse({
          completionCode: 'ABC123',
        }).success,
      ).toBe(true);
    });

    it('should reject invalid attemptId UUID if provided', () => {
      const invalid = {
        attemptId: 'not-a-uuid',
        completionCode: '123456',
      };
      const res = verifyExternalCompletionCodeInputSchema.safeParse(invalid);
      expect(res.success).toBe(false);
    });
  });

  describe('verifyExternalCompletionCodeResponseSchema', () => {
    it('should validate a complete external completion response payload', () => {
      const payload = {
        attemptId: '123e4567-e89b-12d3-a456-426614174000',
        formId: '223e4567-e89b-12d3-a456-426614174000',
        formVersionId: '323e4567-e89b-12d3-a456-426614174000',
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        reward: {
          status: 'PENDING',
          journalId: '423e4567-e89b-12d3-a456-426614174000',
          amount: 50,
          targetAccountClass: 'PENDING',
          settledAt: new Date().toISOString(),
        },
        message: 'Completion code verified successfully. Reward credited to Pending balance.',
      };

      const res = verifyExternalCompletionCodeResponseSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });
  });

  describe('reportMissingCompletionCodeInputSchema', () => {
    it('should validate valid report reasons', () => {
      const valid = {
        attemptId: '123e4567-e89b-12d3-a456-426614174000',
        reason: 'The confirmation page at the end did not display any 6-digit code.',
      };
      const res = reportMissingCompletionCodeInputSchema.safeParse(valid);
      expect(res.success).toBe(true);
    });

    it('should reject reasons that are too short (< 5 chars) or empty', () => {
      expect(
        reportMissingCompletionCodeInputSchema.safeParse({
          reason: 'abc',
        }).success,
      ).toBe(false);

      expect(
        reportMissingCompletionCodeInputSchema.safeParse({
          reason: '   ',
        }).success,
      ).toBe(false);
    });
  });

  describe('reportMissingCompletionCodeResponseSchema', () => {
    it('should validate report response', () => {
      const payload = {
        attemptId: '123e4567-e89b-12d3-a456-426614174000',
        reportedAt: new Date().toISOString(),
        status: 'REPORTED',
        message: 'Your report has been submitted to RESCOM admin for review.',
      };

      const res = reportMissingCompletionCodeResponseSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });
  });
});
