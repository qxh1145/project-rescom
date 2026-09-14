import {
  formDefinitionSchema,
  formBlockSchema,
  blockAnswerSchema,
  formSubmissionSchema,
  formAnswerSubmissionSchema,
  FormAnswer,
  FormAnswerSubmission,
  formIntegrityMetadataSchema,
  FormBlockInput,
} from '@rescom/schemas';

describe('Shared Form Schema Validation (Story 2.1)', () => {
  const sampleBlocks: FormBlockInput[] = [
    {
      id: 'block-text-1',
      order: 0,
      type: 'text',
      title: 'What is your name?',
      required: true,
      placeholder: 'John Doe',
      minLength: 2,
      maxLength: 100,
      pattern: '^[a-zA-Z\\s]+$',
    },
    {
      id: 'block-textarea-2',
      order: 1,
      type: 'textarea',
      title: 'Describe your experience:',
      required: false,
      minLength: 10,
      maxLength: 1000,
    },
    {
      id: 'block-number-3',
      order: 2,
      type: 'number',
      title: 'What is your age?',
      required: true,
      min: 18,
      max: 120,
      step: 1,
      integerOnly: true,
    },
    {
      id: 'block-single-4',
      order: 3,
      type: 'single_choice',
      title: 'Select your employment status:',
      required: true,
      options: [
        { id: 'opt-1', label: 'Employed', value: 'EMPLOYED' },
        { id: 'opt-2', label: 'Self-Employed', value: 'SELF_EMPLOYED' },
        { id: 'opt-3', label: 'Student', value: 'STUDENT' },
      ],
      allowOther: true,
    },
    {
      id: 'block-multi-5',
      order: 4,
      type: 'multiple_choice',
      title: 'Select devices you own:',
      required: true,
      options: [
        { id: 'dev-1', label: 'Smartphone', value: 'SMARTPHONE' },
        { id: 'dev-2', label: 'Laptop', value: 'LAPTOP' },
        { id: 'dev-3', label: 'Tablet', value: 'TABLET' },
      ],
      minSelections: 1,
      maxSelections: 3,
    },
    {
      id: 'block-rating-6',
      order: 5,
      type: 'rating',
      title: 'Rate your overall satisfaction:',
      required: true,
      maxRating: 5,
      ratingShape: 'STAR',
    },
    {
      id: 'block-linear-7',
      order: 6,
      type: 'linear_scale',
      title:
        'How likely are you to recommend us? (0 = Not at all, 10 = Extremely likely)',
      required: true,
      min: 0,
      max: 10,
      minLabel: 'Not at all likely',
      maxLabel: 'Extremely likely',
      step: 1,
    },
    {
      id: 'block-date-8',
      order: 7,
      type: 'date',
      title: 'When was your last purchase?',
      required: false,
      minDate: '2020-01-01',
      maxDate: '2026-12-31',
      includeTime: false,
    },
    {
      id: 'block-file-9',
      order: 8,
      type: 'file_upload',
      title: 'Upload proof of purchase:',
      required: false,
      maxFileSizeMb: 10,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
      maxFiles: 2,
    },
  ];

  describe('AC1: Form Definition Structure & Defaults', () => {
    it('should validate a valid complete form definition with all 9 block types', () => {
      const validForm = {
        id: '11111111-1111-1111-1111-111111111111',
        schemaVersion: 1,
        title: 'Customer Satisfaction Survey 2026',
        description: 'Annual customer feedback gathering.',
        blocks: sampleBlocks,
        settings: {
          shuffleBlocks: false,
          progressBar: true,
          requireAuth: false,
          submitButtonText: 'Finish Survey',
        },
        metadata: {
          expectedEffortSeconds: 120,
          minTimeBarrierSeconds: 30,
        },
      };

      const result = formDefinitionSchema.safeParse(validForm);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.blocks.length).toBe(9);
        expect(result.data.settings.submitButtonText).toBe('Finish Survey');
        expect(result.data.metadata.expectedEffortSeconds).toBe(120);
      }
    });

    it('should allow optional top-level id and apply defaults when omitted', () => {
      const minimalForm = {
        title: 'Draft Survey Without ID',
        blocks: [sampleBlocks[0]],
      };

      const result = formDefinitionSchema.safeParse(minimalForm);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBeUndefined();
        expect(result.data.schemaVersion).toBe(1);
        expect(result.data.settings.progressBar).toBe(true);
        expect(result.data.settings.submitButtonText).toBe('Submit');
        expect(result.data.metadata.expectedEffortSeconds).toBe(60);
        expect(result.data.metadata.minTimeBarrierSeconds).toBe(15);
      }
    });

    it('should reject form definitions with empty title or missing blocks', () => {
      expect(
        formDefinitionSchema.safeParse({
          id: '123',
          title: '   ',
          blocks: sampleBlocks,
        }).success,
      ).toBe(false);

      expect(
        formDefinitionSchema.safeParse({
          id: '123',
          title: 'Test',
          blocks: [],
        }).success,
      ).toBe(false);
    });

    it('should reject extra unrecognized fields at the root level (.strict())', () => {
      const formWithExtra = {
        id: '123',
        title: 'Strict Test',
        blocks: [sampleBlocks[0]],
        unrecognizedField: 'malicious_payload',
      };

      const result = formDefinitionSchema.safeParse(formWithExtra);
      expect(result.success).toBe(false);
    });

    it('should reject duplicate block IDs within a form', () => {
      const duplicateForm = {
        id: 'form-dup',
        title: 'Duplicate Blocks Form',
        blocks: [
          sampleBlocks[0],
          { ...sampleBlocks[1], id: sampleBlocks[0].id }, // Duplicate ID!
        ],
      };

      const result = formDefinitionSchema.safeParse(duplicateForm);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('Duplicate block ID');
      }
    });

    it('should reject forms exceeding 200 blocks cap', () => {
      const massiveBlocks = Array.from({ length: 201 }, (_, i) => ({
        ...sampleBlocks[0],
        id: `block-${i}`,
        order: i,
      }));

      const result = formDefinitionSchema.safeParse({
        title: 'Massive Form',
        blocks: massiveBlocks,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'cannot exceed 200 blocks',
        );
      }
    });
  });

  describe('AC2: Comprehensive Form Block Types Validation & Boundaries', () => {
    it('should reject text block with minLength > maxLength or invalid regex pattern', () => {
      expect(
        formBlockSchema.safeParse({
          id: 't-1',
          order: 0,
          type: 'text',
          title: 'Title',
          minLength: 50,
          maxLength: 10,
        }).success,
      ).toBe(false);

      expect(
        formBlockSchema.safeParse({
          id: 't-2',
          order: 0,
          type: 'text',
          title: 'Title',
          pattern: '[a-z(', // Unclosed bracket invalid regex
        }).success,
      ).toBe(false);
    });

    it('should reject textarea block with minLength > maxLength', () => {
      expect(
        formBlockSchema.safeParse({
          id: 'ta-1',
          order: 0,
          type: 'textarea',
          title: 'Title',
          minLength: 500,
          maxLength: 100,
        }).success,
      ).toBe(false);
    });

    it('should reject number block with min > max, non-finite numbers, or non-integer values when integerOnly', () => {
      expect(
        formBlockSchema.safeParse({
          id: 'n-1',
          order: 0,
          type: 'number',
          title: 'Age',
          min: 100,
          max: 10,
        }).success,
      ).toBe(false);

      expect(
        formBlockSchema.safeParse({
          id: 'n-2',
          order: 0,
          type: 'number',
          title: 'Age',
          min: Infinity,
        }).success,
      ).toBe(false);

      expect(
        formBlockSchema.safeParse({
          id: 'n-3',
          order: 0,
          type: 'number',
          title: 'Age',
          min: 1.5,
          integerOnly: true,
        }).success,
      ).toBe(false);
    });

    it('should reject choice blocks with fewer than 2 options or duplicate option IDs/values', () => {
      // Fewer than 2 options
      expect(
        formBlockSchema.safeParse({
          id: 'sc-1',
          order: 0,
          type: 'single_choice',
          title: 'One option',
          options: [{ id: 'opt-1', label: 'Only', value: 'V1' }],
        }).success,
      ).toBe(false);

      // Duplicate option ID
      expect(
        formBlockSchema.safeParse({
          id: 'sc-2',
          order: 0,
          type: 'single_choice',
          title: 'Dup ID',
          options: [
            { id: 'opt-1', label: 'First', value: 'V1' },
            { id: 'opt-1', label: 'Second', value: 'V2' },
          ],
        }).success,
      ).toBe(false);

      // Duplicate option value
      expect(
        formBlockSchema.safeParse({
          id: 'mc-1',
          order: 0,
          type: 'multiple_choice',
          title: 'Dup Value',
          options: [
            { id: 'opt-1', label: 'Option 1', value: 'DUPLICATE' },
            { id: 'opt-2', label: 'Option 2', value: 'DUPLICATE' },
          ],
        }).success,
      ).toBe(false);
    });

    it('should reject multiple choice when minSelections > maxSelections or minSelections > available options', () => {
      expect(
        formBlockSchema.safeParse({
          id: 'mc-range',
          order: 0,
          type: 'multiple_choice',
          title: 'Select',
          options: [
            { id: 'o1', label: 'A', value: 'A' },
            { id: 'o2', label: 'B', value: 'B' },
          ],
          minSelections: 3, // Only 2 options available
        }).success,
      ).toBe(false);

      expect(
        formBlockSchema.safeParse({
          id: 'mc-invert',
          order: 0,
          type: 'multiple_choice',
          title: 'Select',
          options: [
            { id: 'o1', label: 'A', value: 'A' },
            { id: 'o2', label: 'B', value: 'B' },
            { id: 'o3', label: 'C', value: 'C' },
          ],
          minSelections: 3,
          maxSelections: 1, // min > max
        }).success,
      ).toBe(false);
    });

    it('should validate rating block maxRating between 3 and 10', () => {
      expect(
        formBlockSchema.safeParse({
          id: 'r-1',
          order: 0,
          type: 'rating',
          title: 'Rate',
          maxRating: 5,
          ratingShape: 'STAR',
        }).success,
      ).toBe(true);

      expect(
        formBlockSchema.safeParse({
          id: 'r-2',
          order: 0,
          type: 'rating',
          title: 'Rate',
          maxRating: 2,
        }).success,
      ).toBe(false);

      expect(
        formBlockSchema.safeParse({
          id: 'r-3',
          order: 0,
          type: 'rating',
          title: 'Rate',
          maxRating: 15,
        }).success,
      ).toBe(false);
    });

    it('should validate linear scale min, max, and step divisibility', () => {
      expect(
        formBlockSchema.safeParse({
          id: 'ls-1',
          order: 0,
          type: 'linear_scale',
          title: 'Scale',
          min: 1,
          max: 7,
          minLabel: 'Low',
          maxLabel: 'High',
          step: 2, // (7 - 1) = 6, 6 % 2 === 0 -> valid
        }).success,
      ).toBe(true);

      // Step does not evenly divide range: (10 - 1) = 9, 9 % 2 !== 0
      expect(
        formBlockSchema.safeParse({
          id: 'ls-step-err',
          order: 0,
          type: 'linear_scale',
          title: 'Scale',
          min: 1,
          max: 10,
          step: 2,
        }).success,
      ).toBe(false);

      // Step exceeds range
      expect(
        formBlockSchema.safeParse({
          id: 'ls-step-huge',
          order: 0,
          type: 'linear_scale',
          title: 'Scale',
          min: 1,
          max: 5,
          step: 10,
        }).success,
      ).toBe(false);
    });

    it('should validate date block ISO format and minDate <= maxDate', () => {
      expect(
        formBlockSchema.safeParse({
          id: 'd-1',
          order: 0,
          type: 'date',
          title: 'Date',
          minDate: '2026-01-01',
          maxDate: '2026-12-31',
        }).success,
      ).toBe(true);

      // Non-ISO date format
      expect(
        formBlockSchema.safeParse({
          id: 'd-2',
          order: 0,
          type: 'date',
          title: 'Date',
          minDate: '01/01/2026',
        }).success,
      ).toBe(false);

      // Inverted date range
      expect(
        formBlockSchema.safeParse({
          id: 'd-3',
          order: 0,
          type: 'date',
          title: 'Date',
          minDate: '2026-12-31',
          maxDate: '2026-01-01',
        }).success,
      ).toBe(false);
    });

    it('should validate file upload block file size and allowed MIME types', () => {
      expect(
        formBlockSchema.safeParse({
          id: 'fu-1',
          order: 0,
          type: 'file_upload',
          title: 'Upload Doc',
          maxFileSizeMb: 25,
          allowedMimeTypes: ['application/pdf'],
          maxFiles: 5,
        }).success,
      ).toBe(true);

      // Invalid MIME type format
      expect(
        formBlockSchema.safeParse({
          id: 'fu-2',
          order: 0,
          type: 'file_upload',
          title: 'Upload Doc',
          maxFileSizeMb: 25,
          allowedMimeTypes: ['invalid-mime'],
        }).success,
      ).toBe(false);

      // File size exceeds 50MB limit
      expect(
        formBlockSchema.safeParse({
          id: 'fu-3',
          order: 0,
          type: 'file_upload',
          title: 'Upload Doc',
          maxFileSizeMb: 100,
          allowedMimeTypes: ['image/png'],
        }).success,
      ).toBe(false);
    });

    it('should reject block with unknown type', () => {
      const unknownBlock = {
        id: 'u-1',
        order: 0,
        type: 'unsupported_custom_widget',
        title: 'Custom',
      };

      expect(formBlockSchema.safeParse(unknownBlock).success).toBe(false);
    });

    it('should reject extra fields on block definitions (.strict())', () => {
      const blockWithExtra = {
        id: 'text-extra',
        order: 0,
        type: 'text',
        title: 'Extra fields test',
        injectedField: 'hack',
      };

      expect(formBlockSchema.safeParse(blockWithExtra).success).toBe(false);
    });
  });

  describe('AC3: Versioned Integrity Metadata Specification & Cross-Block Rules', () => {
    it('should validate attention check block metadata when expectedValue matches options', () => {
      const formWithAttentionCheck = {
        title: 'Att Check Form',
        blocks: [
          {
            id: 'att-1',
            order: 0,
            type: 'single_choice',
            title: 'Select "Strongly Disagree"',
            options: [
              { id: 'o-1', label: 'Strongly Agree', value: 'SA' },
              { id: 'o-2', label: 'Neutral', value: 'N' },
              { id: 'o-3', label: 'Strongly Disagree', value: 'SD' },
            ],
            integrity: {
              attentionCheck: {
                isAttentionCheck: true,
                expectedValue: 'SD',
                failAction: 'FLAG' as const,
              },
              semanticCategory: 'ATTENTION_CHECK' as const,
            },
          },
        ],
      };

      expect(
        formDefinitionSchema.safeParse(formWithAttentionCheck).success,
      ).toBe(true);
    });

    it('should reject attention check when expectedValue does not exist in block options', () => {
      const formWithBadExpected = {
        title: 'Invalid Att Check',
        blocks: [
          {
            id: 'att-1',
            order: 0,
            type: 'single_choice',
            title: 'Attention Check',
            options: [
              { id: 'o-1', label: 'A', value: 'A' },
              { id: 'o-2', label: 'B', value: 'B' },
            ],
            integrity: {
              attentionCheck: {
                isAttentionCheck: true,
                expectedValue: 'NON_EXISTENT_OPTION_VALUE',
                failAction: 'DISQUALIFY' as const,
              },
            },
          },
        ],
      };

      const result = formDefinitionSchema.safeParse(formWithBadExpected);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'does not match any selectable option',
        );
      }
    });

    it('should validate consistency pairing referencing an existing sibling block', () => {
      const formWithConsistencyPairing = {
        id: 'form-pair',
        title: 'Consistency Survey',
        blocks: [
          {
            id: 'pair-a',
            order: 0,
            type: 'rating',
            title: 'I enjoy interacting with new people.',
            maxRating: 5,
            integrity: {
              semanticCategory: 'PSYCHOGRAPHIC' as const,
            },
          },
          {
            id: 'pair-b',
            order: 1,
            type: 'rating',
            title: 'I prefer to avoid socializing with strangers.',
            maxRating: 5,
            integrity: {
              consistencyPair: {
                pairedBlockId: 'pair-a',
                rule: 'OPPOSITE' as const,
                tolerance: 1,
              },
              semanticCategory: 'PSYCHOGRAPHIC' as const,
            },
          },
        ],
      };

      const result = formDefinitionSchema.safeParse(formWithConsistencyPairing);
      expect(result.success).toBe(true);
    });

    it('should reject consistency pairing referencing a non-existent block ID or self', () => {
      expect(
        formDefinitionSchema.safeParse({
          title: 'Broken Pair',
          blocks: [
            {
              id: 'b-1',
              order: 0,
              type: 'text',
              title: 'Q1',
              integrity: {
                consistencyPair: {
                  pairedBlockId: 'ghost-block',
                  rule: 'EQUIVALENT' as const,
                },
              },
            },
          ],
        }).success,
      ).toBe(false);

      expect(
        formDefinitionSchema.safeParse({
          title: 'Self Pair',
          blocks: [
            {
              id: 'self-1',
              order: 0,
              type: 'text',
              title: 'Q1',
              integrity: {
                consistencyPair: {
                  pairedBlockId: 'self-1',
                  rule: 'EQUIVALENT' as const,
                },
              },
            },
          ],
        }).success,
      ).toBe(false);
    });

    it('should reject mutual circular consistency pairing between two blocks (A -> B and B -> A)', () => {
      const circularForm = {
        title: 'Circular Pair Survey',
        blocks: [
          {
            id: 'block-a',
            order: 0,
            type: 'rating',
            title: 'Q A',
            maxRating: 5,
            integrity: {
              consistencyPair: {
                pairedBlockId: 'block-b',
                rule: 'EQUIVALENT' as const,
              },
            },
          },
          {
            id: 'block-b',
            order: 1,
            type: 'rating',
            title: 'Q B',
            maxRating: 5,
            integrity: {
              consistencyPair: {
                pairedBlockId: 'block-a',
                rule: 'EQUIVALENT' as const,
              },
            },
          },
        ],
      };

      const result = formDefinitionSchema.safeParse(circularForm);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'Mutual circular consistency pair detected',
        );
      }
    });

    it('should reject standalone formIntegrityMetadataSchema with negative effort or barrier > effort', () => {
      // Negative effort seconds
      const negEffortResult = formIntegrityMetadataSchema.safeParse({
        expectedEffortSeconds: -10,
        minTimeBarrierSeconds: 5,
      });
      expect(negEffortResult.success).toBe(false);
      if (!negEffortResult.success) {
        expect(negEffortResult.error.issues[0].message).toContain(
          'Expected effort must be at least 10 seconds',
        );
      }

      // Barrier > Effort on standalone schema
      const invalidBarrierResult = formIntegrityMetadataSchema.safeParse({
        expectedEffortSeconds: 30,
        minTimeBarrierSeconds: 45,
      });
      expect(invalidBarrierResult.success).toBe(false);
      if (!invalidBarrierResult.success) {
        expect(invalidBarrierResult.error.issues[0].message).toContain(
          'minTimeBarrierSeconds cannot exceed expectedEffortSeconds',
        );
      }
    });
  });

  describe('AC4: Form Response & Answer Contracts', () => {
    it('should validate string, numeric, boolean, array, and null block answers', () => {
      expect(
        blockAnswerSchema.safeParse({
          blockId: 'b-1',
          value: 'Hello World',
        }).success,
      ).toBe(true);

      expect(
        blockAnswerSchema.safeParse({
          blockId: 'b-2',
          value: 42,
        }).success,
      ).toBe(true);

      expect(
        blockAnswerSchema.safeParse({
          blockId: 'b-3',
          value: true,
        }).success,
      ).toBe(true);

      expect(
        blockAnswerSchema.safeParse({
          blockId: 'b-4',
          value: ['opt-1', 'opt-2'],
        }).success,
      ).toBe(true);

      expect(
        blockAnswerSchema.safeParse({
          blockId: 'b-5',
          value: null,
        }).success,
      ).toBe(true);
    });

    it('should reject answer with missing blockId, non-finite number, or string exceeding length limit', () => {
      expect(
        blockAnswerSchema.safeParse({
          value: 'Missing block ID',
        }).success,
      ).toBe(false);

      expect(
        blockAnswerSchema.safeParse({
          blockId: 'b-1',
          value: Infinity,
        }).success,
      ).toBe(false);

      expect(
        blockAnswerSchema.safeParse({
          blockId: 'b-1',
          value: 'a'.repeat(10001),
        }).success,
      ).toBe(false);
    });

    it('should validate complete form submission payload via formSubmissionSchema and formAnswerSubmissionSchema alias', () => {
      const validSubmission: FormAnswerSubmission = {
        formId: '11111111-1111-1111-1111-111111111111',
        formVersionId: '22222222-2222-2222-2222-222222222222',
        answers: [
          { blockId: 'block-text-1', value: 'Alice' },
          { blockId: 'block-number-3', value: 29 },
          { blockId: 'block-multi-5', value: ['SMARTPHONE', 'LAPTOP'] },
        ],
      };

      expect(formSubmissionSchema.safeParse(validSubmission).success).toBe(
        true,
      );
      expect(
        formAnswerSubmissionSchema.safeParse(validSubmission).success,
      ).toBe(true);

      // Verify FormAnswer type assignment
      const sampleAnswer: FormAnswer = {
        blockId: 'block-rating-6',
        value: 5,
      };
      expect(blockAnswerSchema.safeParse(sampleAnswer).success).toBe(true);
    });

    it('should reject submission with duplicate blockId answers', () => {
      const duplicateSubmission = {
        formId: 'form-1',
        formVersionId: 'ver-1',
        answers: [
          { blockId: 'b-1', value: 'Answer 1' },
          { blockId: 'b-1', value: 'Answer 2' }, // Duplicate blockId!
        ],
      };

      const result = formSubmissionSchema.safeParse(duplicateSubmission);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          'Duplicate blockId found in submitted answers',
        );
      }
    });
  });
});
