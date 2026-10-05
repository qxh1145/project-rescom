import {
  internalFormSubmissionInputSchema,
  internalFormSubmissionResponseSchema,
  internalRewardRequestedPayloadSchema,
  integrityAssessmentRequestedPayloadSchema,
  validateAnswersAgainstFormDefinition,
} from './internal-submission.schema';
import { FormBlock } from './form-blocks.schema';
import { validateBlockAnswer } from './form-preview';
import { MAX_ANSWER_STRING_LENGTH } from './form-answer.schema';

describe('Internal Form Submission Schemas & Validation', () => {
  const sampleBlocks: FormBlock[] = [
    {
      id: 'block-text-1',
      order: 0,
      title: 'Your Name',
      type: 'text',
      required: true,
      minLength: 2,
      maxLength: 50,
    },
    {
      id: 'block-num-2',
      order: 1,
      title: 'Your Age',
      type: 'number',
      required: true,
      min: 18,
      max: 100,
      integerOnly: true,
    },
    {
      id: 'block-choice-3',
      order: 2,
      title: 'Favorite Campus Spot',
      type: 'single_choice',
      required: false,
      allowOther: false,
      options: [
        { id: 'opt-1', label: 'Library', value: 'library' },
        { id: 'opt-2', label: 'Cafeteria', value: 'cafeteria' },
      ],
    },
  ];

  describe('internalFormSubmissionInputSchema', () => {
    it('accepts valid submission payload with array of answers', () => {
      const payload = {
        attemptId: '11111111-1111-4111-8111-111111111111',
        answers: [
          { blockId: 'block-text-1', value: 'John Doe' },
          { blockId: 'block-num-2', value: 25 },
        ],
      };
      const result = internalFormSubmissionInputSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('accepts valid submission payload with record of answers', () => {
      const payload = {
        answers: {
          'block-text-1': 'Alice',
          'block-num-2': 21,
        },
      };
      const result = internalFormSubmissionInputSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects invalid attemptId format', () => {
      const payload = {
        attemptId: 'not-a-uuid',
        answers: { 'block-1': 'test' },
      };
      const result = internalFormSubmissionInputSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe('validateAnswersAgainstFormDefinition', () => {
    it('validates successfully when all required questions are answered properly (record format)', () => {
      const answers = {
        'block-text-1': 'John Doe',
        'block-num-2': 25,
      };
      const validation = validateAnswersAgainstFormDefinition(sampleBlocks, answers);
      expect(validation.isValid).toBe(true);
      expect(Object.keys(validation.errors).length).toBe(0);
      expect(validation.answeredCount).toBe(2);
      expect(validation.requiredCount).toBe(2);
      expect(validation.normalizedAnswers['block-text-1']).toBe('John Doe');
    });

    it('validates successfully when answers are passed as BlockAnswer[]', () => {
      const answers = [
        { blockId: 'block-text-1', value: 'Jane Doe' },
        { blockId: 'block-num-2', value: 30 },
      ];
      const validation = validateAnswersAgainstFormDefinition(sampleBlocks, answers);
      expect(validation.isValid).toBe(true);
      expect(validation.normalizedAnswers['block-text-1']).toBe('Jane Doe');
      expect(validation.normalizedAnswers['block-num-2']).toBe(30);
    });

    it('fails when a required block is missing', () => {
      const answers = {
        'block-text-1': 'John Doe',
        // block-num-2 is omitted
      };
      const validation = validateAnswersAgainstFormDefinition(sampleBlocks, answers);
      expect(validation.isValid).toBe(false);
      expect(validation.errors['block-num-2']).toBeDefined();
    });

    it('fails when an answer violates block constraints', () => {
      const answers = {
        'block-text-1': 'J', // too short (< 2)
        'block-num-2': 15,   // below min (< 18)
      };
      const validation = validateAnswersAgainstFormDefinition(sampleBlocks, answers);
      expect(validation.isValid).toBe(false);
      expect(validation.errors['block-text-1']).toContain('Minimum length is 2');
      expect(validation.errors['block-num-2']).toContain('Minimum value is 18');
    });

    it('fails when an unknown blockId is provided in submission', () => {
      const answers = {
        'block-text-1': 'John Doe',
        'block-num-2': 25,
        'unknown-block-id': 'malicious extra answer',
      };
      const validation = validateAnswersAgainstFormDefinition(sampleBlocks, answers);
      expect(validation.isValid).toBe(false);
      expect(validation.errors['unknown-block-id']).toContain('Unrecognized block ID');
    });

    it('fails when duplicate blockIds are provided in array submission', () => {
      const answers = [
        { blockId: 'block-text-1', value: 'John' },
        { blockId: 'block-text-1', value: 'Doe' },
        { blockId: 'block-num-2', value: 25 },
      ];
      const validation = validateAnswersAgainstFormDefinition(sampleBlocks, answers);
      expect(validation.isValid).toBe(false);
      expect(validation.errors['block-text-1']).toContain('Duplicate block ID');
    });
  });

  describe('Outbox Event Schemas', () => {
    it('validates internalRewardRequestedPayloadSchema', () => {
      const payload = {
        responseId: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
        formId: '33333333-3333-4333-8333-333333333333',
        formVersionId: '44444444-4444-4444-8444-444444444444',
        publisherId: '55555555-5555-4555-8555-555555555555',
        respondentId: '66666666-6666-4666-8666-666666666666',
        rewardAmount: 50,
        policyMode: 'SHADOW',
        policyDeploymentId: 'policy-default-v1',
        submittedAt: new Date().toISOString(),
      };
      const res = internalRewardRequestedPayloadSchema.safeParse(payload);
      expect(res.success).toBe(true);
      // Story IR.2b: a free survey's submission pins rewardAmount 0.
      expect(
        internalRewardRequestedPayloadSchema.safeParse({
          ...payload,
          rewardAmount: 0,
        }).success,
      ).toBe(true);
      expect(
        internalRewardRequestedPayloadSchema.safeParse({
          ...payload,
          rewardAmount: -1,
        }).success,
      ).toBe(false);
    });

    it('validates integrityAssessmentRequestedPayloadSchema', () => {
      const payload = {
        responseId: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
        formId: '33333333-3333-4333-8333-333333333333',
        formVersionId: '44444444-4444-4444-8444-444444444444',
        respondentId: null, // guest supported
        policyMode: 'SHADOW',
        policyDeploymentId: 'policy-default-v1',
        answers: { 'block-1': 'answer' },
        submittedAt: new Date().toISOString(),
      };
      const res = integrityAssessmentRequestedPayloadSchema.safeParse(payload);
      expect(res.success).toBe(true);
    });
  });

  describe('internalFormSubmissionResponseSchema', () => {
    it('validates authenticated submission response DTO with reward', () => {
      const dto = {
        responseId: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
        formId: '33333333-3333-4333-8333-333333333333',
        formVersionId: '44444444-4444-4444-8444-444444444444',
        status: 'VALIDATED' as const,
        submittedAt: new Date().toISOString(),
        reward: {
          status: 'SETTLED' as const,
          journalId: '77777777-7777-4777-8777-777777777777',
          amount: 50,
          targetAccountClass: 'USER_AVAILABLE' as const,
          settledAt: new Date().toISOString(),
        },
        policyMode: 'SHADOW' as const,
      };
      const res = internalFormSubmissionResponseSchema.safeParse(dto);
      expect(res.success).toBe(true);
    });

    it('validates guest submission response DTO with null reward', () => {
      const dto = {
        responseId: '11111111-1111-4111-8111-111111111111',
        attemptId: '22222222-2222-4222-8222-222222222222',
        formId: '33333333-3333-4333-8333-333333333333',
        formVersionId: '44444444-4444-4444-8444-444444444444',
        status: 'VALIDATED' as const,
        submittedAt: new Date().toISOString(),
        reward: null,
        policyMode: 'SHADOW' as const,
      };
      const res = internalFormSubmissionResponseSchema.safeParse(dto);
      expect(res.success).toBe(true);
    });
  });
});

/**
 * Epic 5 review P3/P23: the file-answer contract shared by the renderer
 * (client) and the Internal submission (server), and the strict server pass.
 */
describe('Epic 5 review — answer contract (P3/P23)', () => {
  const fileBlock = {
    id: 'q-file',
    order: 0,
    title: 'Evidence',
    type: 'file_upload',
    required: true,
    maxFileSizeMb: 1,
    allowedMimeTypes: ['application/pdf'],
    maxFiles: 2,
  } as unknown as FormBlock;
  const objectId = '11111111-1111-4111-8111-111111111111';
  const uiAnswer = {
    objectId,
    fileName: 'evidence.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
    status: 'CLEAN',
  };

  it('the real UI FileAttachmentAnswer[] passes the client and the server validators', () => {
    expect(validateBlockAnswer(fileBlock, [uiAnswer]).isValid).toBe(true);
    const server = validateAnswersAgainstFormDefinition([fileBlock], {
      'q-file': [uiAnswer],
    });
    expect(server.isValid).toBe(true);
    expect(server.normalizedAnswers['q-file']).toEqual([uiAnswer]);
  });

  it('the builder-preview MockFileValue still passes the client validator only', () => {
    const preview = [{ name: 'a.pdf', size: 10, type: 'application/pdf' }];
    expect(validateBlockAnswer(fileBlock, preview).isValid).toBe(true);
    expect(
      validateAnswersAgainstFormDefinition([fileBlock], { 'q-file': preview })
        .errors['q-file'],
    ).toBe('Invalid file reference');
  });

  it('rejects a bare string, a non-UUID reference and too many files', () => {
    expect(validateBlockAnswer(fileBlock, 'object-id').isValid).toBe(false);
    expect(
      validateAnswersAgainstFormDefinition([fileBlock], {
        'q-file': [{ ...uiAnswer, objectId: 'nope' }],
      }).isValid,
    ).toBe(false);
    expect(
      validateAnswersAgainstFormDefinition([fileBlock], {
        'q-file': [uiAnswer, uiAnswer, uiAnswer],
      }).errors['q-file'],
    ).toMatch(/at most 2 files/);
  });

  it('enforces the size and MIME limits against fileSize/mimeType', () => {
    expect(
      validateBlockAnswer(fileBlock, [{ ...uiAnswer, fileSize: 5 * 1024 * 1024 }])
        .error,
    ).toMatch(/maximum size/);
    expect(
      validateBlockAnswer(fileBlock, [{ ...uiAnswer, mimeType: 'image/png' }])
        .error,
    ).toMatch(/not permitted/);
  });

  describe('strict server pass (P23)', () => {
    const numberBlock = {
      id: 'q-num',
      order: 0,
      title: 'Age',
      type: 'number',
      required: true,
    } as unknown as FormBlock;
    const ratingBlock = {
      id: 'q-rating',
      order: 1,
      title: 'Rating',
      type: 'rating',
      required: true,
      maxRating: 5,
    } as unknown as FormBlock;
    const multiBlock = {
      id: 'q-multi',
      order: 2,
      title: 'Pick',
      type: 'multiple_choice',
      required: true,
      allowOther: true,
      options: [
        { id: 'o1', label: 'A', value: 'a' },
        { id: 'o2', label: 'B', value: 'b' },
      ],
    } as unknown as FormBlock;

    it('does not coerce numeric strings (number, rating)', () => {
      const result = validateAnswersAgainstFormDefinition(
        [numberBlock, ratingBlock],
        { 'q-num': '42', 'q-rating': '4' },
      );
      expect(result.errors).toEqual({
        'q-num': 'Answer must be a number',
        'q-rating': 'Answer must be a number',
      });
      expect(
        validateAnswersAgainstFormDefinition([numberBlock, ratingBlock], {
          'q-num': 42,
          'q-rating': 4,
        }).isValid,
      ).toBe(true);
    });

    it('requires unique choices and at most one bounded "Other" value', () => {
      const check = (value: unknown) =>
        validateAnswersAgainstFormDefinition([multiBlock], { 'q-multi': value })
          .errors['q-multi'];
      expect(check(['a', 'a'])).toMatch(/only once/);
      expect(check(['a', 'x', 'y'])).toMatch(/one "Other"/);
      expect(check(['a', 'x'.repeat(501)])).toMatch(/1-500/);
      expect(check(['a', 'my own answer'])).toBeUndefined();
    });

    it('caps free text at MAX_ANSWER_STRING_LENGTH even without a block maxLength', () => {
      const textBlock = {
        id: 'q-text',
        order: 0,
        title: 'Comment',
        type: 'textarea',
        required: true,
      } as unknown as FormBlock;
      const check = (value: unknown) =>
        validateAnswersAgainstFormDefinition([textBlock], { 'q-text': value })
          .errors['q-text'];
      expect(check('x'.repeat(MAX_ANSWER_STRING_LENGTH))).toBeUndefined();
      expect(check('x'.repeat(MAX_ANSWER_STRING_LENGTH + 1))).toMatch(
        /Maximum length is 10000/,
      );
      // Whitespace padding is not trimmed away by the strict server pass.
      expect(
        check('x'.repeat(MAX_ANSWER_STRING_LENGTH - 1) + ' '.repeat(10)),
      ).toBe(`Answer must not exceed ${MAX_ANSWER_STRING_LENGTH} characters`);
    });

    it('rejects impossible calendar dates', () => {
      const dateBlock = {
        id: 'q-date',
        order: 0,
        title: 'When',
        type: 'date',
        required: true,
        includeTime: false,
      } as unknown as FormBlock;
      const check = (value: unknown) =>
        validateAnswersAgainstFormDefinition([dateBlock], { 'q-date': value })
          .errors['q-date'];
      expect(check('2026-02-29')).toMatch(/valid date/);
      expect(check('2026-05-01-2026')).toMatch(/valid date/);
      expect(check('2024-02-29')).toBeUndefined();
      expect(check('2026-05-01T10:00+07:00')).toBeUndefined();
    });
  });
});
