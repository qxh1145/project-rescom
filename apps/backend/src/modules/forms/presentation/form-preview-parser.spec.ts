import {
  parseFormDefinitionDraft,
  validateBlockAnswer,
  validateAllAnswers,
  createMockSubmission,
} from '@rescom/schemas';
import type {
  FileUploadBlock,
  FormBlock,
  LinearScaleBlock,
  TextBlock,
} from '@rescom/schemas';

describe('Form Preview Parser & Validator', () => {
  const sampleBlocks: FormBlock[] = [
    {
      id: 'blk-1',
      type: 'text',
      title: 'What is your name?',
      required: true,
      order: 0,
      minLength: 2,
      maxLength: 50,
      placeholder: 'e.g. John Doe',
    },
    {
      id: 'blk-2',
      type: 'number',
      title: 'What is your age?',
      required: true,
      order: 1,
      min: 18,
      max: 120,
      integerOnly: true,
    },
    {
      id: 'blk-3',
      type: 'single_choice',
      title: 'Preferred platform?',
      required: false,
      order: 2,
      options: [
        { id: 'opt-1', value: 'Web', label: 'Web' },
        { id: 'opt-2', value: 'Mobile', label: 'Mobile' },
        { id: 'opt-3', value: 'Desktop', label: 'Desktop' },
      ],
      allowOther: true,
    },
    {
      id: 'blk-4',
      type: 'multiple_choice',
      title: 'Interests?',
      required: true,
      order: 3,
      options: [
        { id: 'opt-ai', value: 'AI', label: 'AI' },
        { id: 'opt-crypto', value: 'Crypto', label: 'Crypto' },
        { id: 'opt-gaming', value: 'Gaming', label: 'Gaming' },
      ],
      minSelections: 1,
      maxSelections: 2,
      allowOther: false,
    },
    {
      id: 'blk-5',
      type: 'rating',
      title: 'Rate your experience',
      required: true,
      order: 4,
      maxRating: 5,
      ratingShape: 'STAR',
    },
    {
      id: 'blk-6',
      type: 'linear_scale',
      title: 'How likely are you to recommend us?',
      required: false,
      order: 5,
      min: 1,
      max: 10,
      step: 1,
      minLabel: 'Not likely',
      maxLabel: 'Extremely likely',
    },
    {
      id: 'blk-7',
      type: 'date',
      title: 'Date of birth',
      required: false,
      order: 6,
      includeTime: false,
    },
    {
      id: 'blk-8',
      type: 'file_upload',
      title: 'Upload your resume',
      required: false,
      order: 7,
      allowedMimeTypes: ['application/pdf'],
      maxFileSizeMb: 5,
      maxFiles: 1,
    },
  ];

  describe('parseFormDefinitionDraft', () => {
    it('should successfully parse and sort draft blocks by order', () => {
      const unorderedBlocks = [
        sampleBlocks[2],
        sampleBlocks[0],
        sampleBlocks[1],
      ];
      const rawDraft = {
        title: 'Test Draft Survey',
        description: 'Preview description',
        blocks: unorderedBlocks,
        settings: {
          progressBar: true,
          submitButtonText: 'Finish Survey',
        },
      };

      const result = parseFormDefinitionDraft(rawDraft);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Test Draft Survey');
        expect(result.data.blocks).toHaveLength(3);
        expect(result.data.blocks[0].id).toBe('blk-1');
        expect(result.data.blocks[1].id).toBe('blk-2');
        expect(result.data.blocks[2].id).toBe('blk-3');
      }
    });

    it('should default title if omitted', () => {
      const result = parseFormDefinitionDraft({
        blocks: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Untitled Survey');
        expect(result.data.blocks).toEqual([]);
      }
    });
  });

  describe('validateBlockAnswer', () => {
    it('should reject required fields when empty or undefined', () => {
      const textBlock = sampleBlocks[0];
      expect(validateBlockAnswer(textBlock, undefined).isValid).toBe(false);
      expect(validateBlockAnswer(textBlock, '').isValid).toBe(false);
      expect(validateBlockAnswer(textBlock, '   ').isValid).toBe(false);

      const multipleChoiceBlock = sampleBlocks[3];
      expect(validateBlockAnswer(multipleChoiceBlock, []).isValid).toBe(false);
    });

    it('should pass optional fields when empty', () => {
      const optionalBlock = sampleBlocks[2];
      expect(validateBlockAnswer(optionalBlock, '').isValid).toBe(true);
      expect(validateBlockAnswer(optionalBlock, undefined).isValid).toBe(true);
    });

    it('should validate string length constraints', () => {
      const textBlock = sampleBlocks[0];
      expect(validateBlockAnswer(textBlock, 'A').isValid).toBe(false);
      expect(validateBlockAnswer(textBlock, 'Alice').isValid).toBe(true);
      expect(validateBlockAnswer(textBlock, 'A'.repeat(51)).isValid).toBe(
        false,
      );
    });

    it('should enforce text patterns', () => {
      const patternBlock: TextBlock = {
        ...(sampleBlocks[0] as TextBlock),
        pattern: '^[A-Z]+$',
      };
      expect(validateBlockAnswer(patternBlock, 'ABC').isValid).toBe(true);
      expect(validateBlockAnswer(patternBlock, 'Abc').isValid).toBe(false);
    });

    it('should validate number range constraints', () => {
      const numBlock = sampleBlocks[1];
      expect(validateBlockAnswer(numBlock, 16).isValid).toBe(false);
      expect(validateBlockAnswer(numBlock, 25).isValid).toBe(true);
      expect(validateBlockAnswer(numBlock, 150).isValid).toBe(false);
    });

    it('should validate single choice selections including other', () => {
      const singleChoice = sampleBlocks[2];
      expect(validateBlockAnswer(singleChoice, 'Web').isValid).toBe(true);
      expect(validateBlockAnswer(singleChoice, 'Custom OS').isValid).toBe(true); // allowOther is true
      expect(validateBlockAnswer(singleChoice, '__OTHER__').isValid).toBe(
        false,
      );
    });

    it('should validate multiple choice min/max selections', () => {
      const mcBlock = sampleBlocks[3];
      expect(validateBlockAnswer(mcBlock, []).isValid).toBe(false);
      expect(validateBlockAnswer(mcBlock, ['AI']).isValid).toBe(true);
      expect(validateBlockAnswer(mcBlock, ['AI', 'Gaming']).isValid).toBe(true);
      expect(
        validateBlockAnswer(mcBlock, ['AI', 'Crypto', 'Gaming']).isValid,
      ).toBe(false); // exceeds max 2
    });

    it('should validate rating scale bounds', () => {
      const ratingBlock = sampleBlocks[4];
      expect(validateBlockAnswer(ratingBlock, 0).isValid).toBe(false);
      expect(validateBlockAnswer(ratingBlock, 4).isValid).toBe(true);
      expect(validateBlockAnswer(ratingBlock, 6).isValid).toBe(false);
    });

    it('should validate linear scale bounds', () => {
      const scaleBlock = sampleBlocks[5];
      expect(validateBlockAnswer(scaleBlock, 1).isValid).toBe(true);
      expect(validateBlockAnswer(scaleBlock, 10).isValid).toBe(true);
      expect(validateBlockAnswer(scaleBlock, 11).isValid).toBe(false);
      const steppedBlock: LinearScaleBlock = {
        ...(scaleBlock as LinearScaleBlock),
        min: 0,
        max: 10,
        step: 2,
      };
      expect(validateBlockAnswer(steppedBlock, 4).isValid).toBe(true);
      expect(validateBlockAnswer(steppedBlock, 5).isValid).toBe(false);
    });

    it('should validate date format', () => {
      const dateBlock = sampleBlocks[6];
      expect(validateBlockAnswer(dateBlock, 'invalid-date').isValid).toBe(
        false,
      );
      expect(validateBlockAnswer(dateBlock, '2026-09-14').isValid).toBe(true);
    });

    it('should validate file upload constraints', () => {
      const fileBlock = sampleBlocks[7];
      expect(
        validateBlockAnswer(fileBlock, {
          name: 'resume.pdf',
          size: 2 * 1024 * 1024,
          type: 'application/pdf',
        }).isValid,
      ).toBe(true);

      // Exceeds max size 5MB
      expect(
        validateBlockAnswer(fileBlock, {
          name: 'large.pdf',
          size: 10 * 1024 * 1024,
          type: 'application/pdf',
        }).isValid,
      ).toBe(false);

      const multiFileBlock: FileUploadBlock = {
        ...(fileBlock as FileUploadBlock),
        maxFiles: 2,
      };
      expect(
        validateBlockAnswer(multiFileBlock, [
          { name: 'one.pdf', size: 100, type: 'application/pdf' },
          { name: 'two.pdf', size: 100, type: 'application/pdf' },
        ]).isValid,
      ).toBe(true);
      expect(
        validateBlockAnswer(multiFileBlock, [
          { name: 'one.pdf', size: 100, type: 'application/pdf' },
          { name: 'two.pdf', size: 100, type: 'application/pdf' },
          { name: 'three.pdf', size: 100, type: 'application/pdf' },
        ]).isValid,
      ).toBe(false);

      // Invalid mime type
      expect(
        validateBlockAnswer(fileBlock, {
          name: 'image.png',
          size: 1 * 1024 * 1024,
          type: 'image/png',
        }).isValid,
      ).toBe(false);
    });
  });

  describe('validateAllAnswers', () => {
    it('should detect invalid/missing required answers across whole form', () => {
      const answers = {
        'blk-1': 'Bob',
        // "blk-2" (age) missing
        'blk-3': 'Web',
        // "blk-4" (interests) missing
        'blk-5': 5,
      };

      const result = validateAllAnswers(sampleBlocks, answers);
      expect(result.isValid).toBe(false);
      expect(result.errors['blk-2']).toBeDefined();
      expect(result.errors['blk-4']).toBeDefined();
      expect(result.errors['blk-1']).toBeUndefined();
      expect(result.requiredCount).toBe(4);
      expect(result.answeredCount).toBe(3);
    });

    it('should report valid when all required fields are satisfied', () => {
      const answers = {
        'blk-1': 'Bob',
        'blk-2': 30,
        'blk-4': ['AI'],
        'blk-5': 4,
      };

      const result = validateAllAnswers(sampleBlocks, answers);
      expect(result.isValid).toBe(true);
      expect(Object.keys(result.errors)).toHaveLength(0);
      expect(result.answeredCount).toBe(4);
    });
  });

  describe('createMockSubmission', () => {
    it('should construct a valid FormSubmission without database side-effects', () => {
      const answers = {
        'blk-1': 'Bob',
        'blk-2': 30,
      };

      const submission = createMockSubmission('form-123', 'ver-1', answers);
      expect(submission.formId).toBe('form-123');
      expect(submission.formVersionId).toBe('ver-1');
      expect(submission.answers).toEqual([
        { blockId: 'blk-1', value: 'Bob' },
        { blockId: 'blk-2', value: 30 },
      ]);
    });
  });
});
