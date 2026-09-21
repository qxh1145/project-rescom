import {
  createExternalSurveySchema,
  rotateCompletionCodeSchema,
  externalSurveyResponseSchema,
  isGoogleFormsUrl,
} from '@rescom/schemas';

describe('Story 4.5: External Form Schemas Unit Tests', () => {
  describe('isGoogleFormsUrl', () => {
    it('returns true for docs.google.com/forms URLs', () => {
      expect(
        isGoogleFormsUrl(
          'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        ),
      ).toBe(true);
    });

    it('returns true for forms.google.com URLs', () => {
      expect(isGoogleFormsUrl('https://forms.google.com/test-survey')).toBe(
        true,
      );
    });

    it('returns true for forms.gle short links', () => {
      expect(isGoogleFormsUrl('https://forms.gle/xYz12345')).toBe(true);
    });

    it('returns false for other domains', () => {
      expect(isGoogleFormsUrl('https://surveymonkey.com/r/xyz')).toBe(false);
      expect(isGoogleFormsUrl('https://example.com/survey')).toBe(false);
    });

    it('returns false for invalid URL strings', () => {
      expect(isGoogleFormsUrl('not-a-url')).toBe(false);
      expect(isGoogleFormsUrl('')).toBe(false);
    });
  });

  describe('createExternalSurveySchema', () => {
    it('parses valid external survey payload with defaults', () => {
      const parsed = createExternalSurveySchema.parse({
        title: 'Developer Experience Survey',
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
      });

      expect(parsed.title).toBe('Developer Experience Survey');
      expect(parsed.rewardPerResponse).toBe(10);
      expect(parsed.expectedCompletions).toBe(50);
      expect(parsed.autoPublish).toBe(false);
    });

    it('accepts custom reward, quota, and description', () => {
      const parsed = createExternalSurveySchema.parse({
        title: 'UX Study',
        description: 'Testing external flow',
        externalUrl: 'https://forms.gle/xYz12345',
        rewardPerResponse: 25,
        expectedCompletions: 100,
        autoPublish: true,
      });

      expect(parsed.rewardPerResponse).toBe(25);
      expect(parsed.expectedCompletions).toBe(100);
      expect(parsed.autoPublish).toBe(true);
    });

    it('rejects non-HTTPS URLs', () => {
      expect(() =>
        createExternalSurveySchema.parse({
          title: 'Insecure Form',
          externalUrl: 'http://docs.google.com/forms/d/xyz',
        }),
      ).toThrow(/External survey URL must use HTTPS/);
    });

    it('rejects invalid URL strings', () => {
      expect(() =>
        createExternalSurveySchema.parse({
          title: 'Bad URL',
          externalUrl: 'docs.google.com/forms',
        }),
      ).toThrow(/Invalid external survey URL/);
    });

    it('rejects empty title', () => {
      expect(() =>
        createExternalSurveySchema.parse({
          title: '   ',
          externalUrl: 'https://forms.gle/test',
        }),
      ).toThrow(/Title is required/);
    });

    it('rejects negative reward', () => {
      expect(() =>
        createExternalSurveySchema.parse({
          title: 'Valid Title',
          externalUrl: 'https://forms.gle/test',
          rewardPerResponse: -5,
        }),
      ).toThrow(/Reward cannot be negative/);
    });
  });

  describe('rotateCompletionCodeSchema', () => {
    it('accepts empty object', () => {
      const parsed = rotateCompletionCodeSchema.parse({});
      expect(parsed).toEqual({});
    });

    it('accepts optional reason', () => {
      const parsed = rotateCompletionCodeSchema.parse({
        reason: 'Suspected code leak on social media',
      });
      expect(parsed.reason).toBe('Suspected code leak on social media');
    });

    it('rejects reason over 500 characters', () => {
      expect(() =>
        rotateCompletionCodeSchema.parse({
          reason: 'a'.repeat(501),
        }),
      ).toThrow(/Reason cannot exceed 500 characters/);
    });
  });

  describe('externalSurveyResponseSchema', () => {
    it('validates response with 6-digit plaintext completion code', () => {
      const parsed = externalSurveyResponseSchema.parse({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'External Google Form',
        type: 'EXTERNAL',
        plaintextCompletionCode: '849201',
        hasCompletionCode: true,
        externalUrl: 'https://forms.gle/test',
        currentVersionNumber: 1,
        status: 'DRAFT',
      });

      expect(parsed.plaintextCompletionCode).toBe('849201');
      expect(parsed.hasCompletionCode).toBe(true);
    });

    it('rejects non-numeric or non-6-digit completion code', () => {
      expect(() =>
        externalSurveyResponseSchema.parse({
          id: '11111111-1111-4111-8111-111111111111',
          title: 'External Google Form',
          type: 'EXTERNAL',
          plaintextCompletionCode: '12345', // 5 digits
          hasCompletionCode: true,
          externalUrl: 'https://forms.gle/test',
          currentVersionNumber: 1,
          status: 'DRAFT',
        }),
      ).toThrow(/exactly 6 numeric digits/);

      expect(() =>
        externalSurveyResponseSchema.parse({
          id: '11111111-1111-4111-8111-111111111111',
          title: 'External Google Form',
          type: 'EXTERNAL',
          plaintextCompletionCode: '12345A', // alphanumeric
          hasCompletionCode: true,
          externalUrl: 'https://forms.gle/test',
          currentVersionNumber: 1,
          status: 'DRAFT',
        }),
      ).toThrow(/exactly 6 numeric digits/);
    });
  });
});
