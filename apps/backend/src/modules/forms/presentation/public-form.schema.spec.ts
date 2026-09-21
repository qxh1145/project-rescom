import {
  formSettingsSchema,
  publicFormDetailsSchema,
  guestSubmissionSchema,
  guestSubmissionResponseSchema,
  PublicFormDetailsDto,
  GuestSubmissionInput,
  GuestSubmissionResponseDto,
} from '@rescom/schemas';

describe('Story 4.4: Public Form & Guest Submission Schemas', () => {
  describe('formSettingsSchema with allowPublicAccess', () => {
    it('should default allowPublicAccess to true', () => {
      const parsed = formSettingsSchema.parse({});
      expect(parsed.allowPublicAccess).toBe(true);
      expect(parsed.requireAuth).toBe(false);
    });

    it('should allow setting allowPublicAccess to false', () => {
      const parsed = formSettingsSchema.parse({ allowPublicAccess: false });
      expect(parsed.allowPublicAccess).toBe(false);
    });
  });

  describe('publicFormDetailsSchema', () => {
    const validPublicForm: PublicFormDetailsDto = {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Community Survey',
      description: 'A survey for everyone in the neighborhood',
      type: 'INTERNAL',
      versionNumber: 1,
      blocks: [
        {
          id: 'b1',
          type: 'text',
          title: 'What is your feedback?',
          required: true,
          order: 0,
        },
      ],
      settings: {
        shuffleBlocks: false,
        progressBar: true,
        requireAuth: false,
        allowPublicAccess: true,
        submitButtonText: 'Submit',
      },
      metadata: {
        expectedEffortSeconds: 120,
        minTimeBarrierSeconds: 20,
      },
      publicUrl: 'https://rescom.app/f/11111111-1111-4111-8111-111111111111',
      publishedAt: '2026-09-15T00:00:00.000Z',
    };

    it('should validate a complete public form payload', () => {
      const parsed = publicFormDetailsSchema.parse(validPublicForm);
      expect(parsed.id).toBe(validPublicForm.id);
      expect(parsed.type).toBe('INTERNAL');
      expect(parsed.blocks).toHaveLength(1);
      expect(parsed.settings.allowPublicAccess).toBe(true);
    });

    it('should reject non-INTERNAL form type', () => {
      expect(() =>
        publicFormDetailsSchema.parse({
          ...validPublicForm,
          type: 'EXTERNAL',
        }),
      ).toThrow();
    });
  });

  describe('guestSubmissionSchema', () => {
    it('should validate guest submission with answers and captcha token', () => {
      const validSubmission: GuestSubmissionInput = {
        answers: {
          b1: 'Great product!',
          b2: 5,
        },
        captchaToken: 'test-turnstile-token-12345',
        telemetry: {
          timeSpentSeconds: 45,
        },
      };

      const parsed = guestSubmissionSchema.parse(validSubmission);
      expect(parsed.captchaToken).toBe('test-turnstile-token-12345');
      expect(parsed.answers.b1).toBe('Great product!');
      expect(parsed.telemetry?.timeSpentSeconds).toBe(45);
    });

    it('should reject missing or empty captchaToken', () => {
      expect(() =>
        guestSubmissionSchema.parse({
          answers: { b1: 'test' },
          captchaToken: '',
        }),
      ).toThrow();

      expect(() =>
        guestSubmissionSchema.parse({
          answers: { b1: 'test' },
        }),
      ).toThrow();
    });
  });

  describe('guestSubmissionResponseSchema', () => {
    it('should validate guest response with zero reward and NOT_AVAILABLE reliability', () => {
      const validResponse: GuestSubmissionResponseDto = {
        submissionId: '22222222-2222-4222-8222-222222222222',
        formId: '11111111-1111-4111-8111-111111111111',
        status: 'SUBMITTED',
        isGuest: true,
        rewardEarned: 0,
        integrityStatus: 'ASSESSED',
        respondentReliability: 'NOT_AVAILABLE',
        submittedAt: '2026-09-15T09:40:00.000Z',
      };

      const parsed = guestSubmissionResponseSchema.parse(validResponse);
      expect(parsed.isGuest).toBe(true);
      expect(parsed.rewardEarned).toBe(0);
      expect(parsed.respondentReliability).toBe('NOT_AVAILABLE');
    });

    it('should reject guest response awarding non-zero reward', () => {
      expect(() =>
        guestSubmissionResponseSchema.parse({
          submissionId: '22222222-2222-4222-8222-222222222222',
          formId: '11111111-1111-4111-8111-111111111111',
          status: 'SUBMITTED',
          isGuest: true,
          rewardEarned: 10, // Invalid for guest
          integrityStatus: 'ASSESSED',
          respondentReliability: 'NOT_AVAILABLE',
          submittedAt: '2026-09-15T09:40:00.000Z',
        }),
      ).toThrow();
    });
  });
});
