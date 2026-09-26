import {
  clientContextSchema,
  startSurveyAttemptInputSchema,
  surveyAttemptResponseSchema,
  StartSurveyAttemptInput,
  SurveyAttemptResponseDto,
} from './survey-attempt.schema';

describe('Survey Attempt Schemas', () => {
  describe('startSurveyAttemptInputSchema', () => {
    it('should validate empty payload as valid', () => {
      const result = startSurveyAttemptInputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate valid clientContext', () => {
      const payload: StartSurveyAttemptInput = {
        clientContext: {
          userAgent: 'Mozilla/5.0',
          locale: 'en-US',
          screenResolution: '1920x1080',
        },
      };
      const result = startSurveyAttemptInputSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe('surveyAttemptResponseSchema', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    const formUuid = '22222222-2222-4222-8222-222222222222';
    const versionUuid = '33333333-3333-4333-8333-333333333333';
    const responseUuid = '44444444-4444-4444-8444-444444444444';

    it('should validate a complete internal attempt response with responseId', () => {
      const payload: SurveyAttemptResponseDto = {
        attemptId: validUuid,
        responseId: responseUuid,
        formId: formUuid,
        formVersionId: versionUuid,
        type: 'INTERNAL',
        status: 'IN_PROGRESS',
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        storageCapability: '1234567890abcdef1234567890abcdef',
      };

      const result = surveyAttemptResponseSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responseId).toBe(responseUuid);
        expect(result.data.type).toBe('INTERNAL');
      }
    });

    it('should validate an external attempt response with null responseId and externalUrl', () => {
      const payload: SurveyAttemptResponseDto = {
        attemptId: validUuid,
        responseId: null,
        formId: formUuid,
        formVersionId: versionUuid,
        type: 'EXTERNAL',
        status: 'IN_PROGRESS',
        startedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        storageCapability: '1234567890abcdef1234567890abcdef',
        externalUrl: 'https://docs.google.com/forms/d/e/sample/viewform',
      };

      const result = surveyAttemptResponseSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.responseId).toBeNull();
        expect(result.data.type).toBe('EXTERNAL');
        expect(result.data.externalUrl).toBe('https://docs.google.com/forms/d/e/sample/viewform');
      }
    });

    it('should fail validation if attemptId is not a valid UUID', () => {
      const payload = {
        attemptId: 'invalid-id',
        responseId: null,
        formId: formUuid,
        formVersionId: versionUuid,
        type: 'EXTERNAL',
        status: 'IN_PROGRESS',
        startedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
      };

      const result = surveyAttemptResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('Epic 5 review P2 — bounded clientContext', () => {
    it('accepts a flat context of primitives', () => {
      expect(
        clientContextSchema.safeParse({
          device: 'desktop',
          width: 1920,
          touch: false,
          referrer: null,
        }).success,
      ).toBe(true);
    });

    it('rejects nested objects, long values, too many keys and oversized payloads', () => {
      expect(
        clientContextSchema.safeParse({
          reportedMissingCode: { reportedAt: '2020-01-01' },
        }).success,
      ).toBe(false);
      expect(clientContextSchema.safeParse({ a: 'x'.repeat(257) }).success).toBe(
        false,
      );
      expect(clientContextSchema.safeParse({ ['k'.repeat(65)]: 1 }).success).toBe(
        false,
      );
      const manyKeys = Object.fromEntries(
        Array.from({ length: 21 }, (_, i) => [`k${i}`, i]),
      );
      expect(clientContextSchema.safeParse(manyKeys).success).toBe(false);
      const large = Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`key${i}`, 'v'.repeat(250)]),
      );
      expect(clientContextSchema.safeParse(large).success).toBe(false);
    });

    it('is enforced on attempt start', () => {
      expect(
        startSurveyAttemptInputSchema.safeParse({
          clientContext: { nested: { deep: true } },
        }).success,
      ).toBe(false);
    });
  });

  describe('Epic 5 review P27 — attempt DTO contract', () => {
    const dto = {
      attemptId: '11111111-1111-4111-8111-111111111111',
      responseId: null,
      formId: '22222222-2222-4222-8222-222222222222',
      formVersionId: '33333333-3333-4333-8333-333333333333',
      type: 'EXTERNAL',
      status: 'IN_PROGRESS',
      startedAt: '2026-09-26T10:00:00.000Z',
      expiresAt: '2026-09-26T10:30:00.000Z',
      storageCapability: 'c'.repeat(43),
    };

    it('only allows IN_PROGRESS and ISO timestamps', () => {
      expect(surveyAttemptResponseSchema.safeParse(dto).success).toBe(true);
      expect(
        surveyAttemptResponseSchema.safeParse({ ...dto, status: 'LOCKED' })
          .success,
      ).toBe(false);
      expect(
        surveyAttemptResponseSchema.safeParse({ ...dto, startedAt: 'yesterday' })
          .success,
      ).toBe(false);
    });
  });
});
