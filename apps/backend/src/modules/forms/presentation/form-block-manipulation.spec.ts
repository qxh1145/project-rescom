import {
  FormBlock,
  createDefaultBlock,
  formBlockSchema,
  formDefinitionSchema,
  reorderBlocks,
  moveBlockUp,
  moveBlockDown,
  duplicateBlock,
  deleteBlock,
  updateBlockInList,
  SingleChoiceBlock,
  MultipleChoiceBlock,
  RatingBlock,
  LinearScaleBlock,
  DateBlock,
  FileUploadBlock,
  NumberBlock,
  TextBlock,
} from '@rescom/schemas';

describe('Story 2.4: Form Block Editing & Manipulation Specification', () => {
  describe('Block Reordering Operations', () => {
    let initialBlocks: FormBlock[];

    beforeEach(() => {
      initialBlocks = [
        createDefaultBlock('text', 0, { title: 'Question 1' }),
        createDefaultBlock('number', 1, { title: 'Question 2' }),
        createDefaultBlock('rating', 2, { title: 'Question 3' }),
      ];
    });

    it('should move a block up by one position and re-index sequentially', () => {
      const updated = moveBlockUp(initialBlocks, 1);

      expect(updated).toHaveLength(3);
      expect(updated[0].title).toBe('Question 2');
      expect(updated[0].order).toBe(0);
      expect(updated[1].title).toBe('Question 1');
      expect(updated[1].order).toBe(1);
      expect(updated[2].title).toBe('Question 3');
      expect(updated[2].order).toBe(2);

      updated.forEach((b) => {
        expect(formBlockSchema.safeParse(b).success).toBe(true);
      });
    });

    it('should do nothing when trying to move the first block up', () => {
      const updated = moveBlockUp(initialBlocks, 0);

      expect(updated[0].title).toBe('Question 1');
      expect(updated[0].order).toBe(0);
      expect(updated[1].title).toBe('Question 2');
      expect(updated[2].title).toBe('Question 3');
    });

    it('should move a block down by one position and re-index sequentially', () => {
      const updated = moveBlockDown(initialBlocks, 1);

      expect(updated).toHaveLength(3);
      expect(updated[0].title).toBe('Question 1');
      expect(updated[0].order).toBe(0);
      expect(updated[1].title).toBe('Question 3');
      expect(updated[1].order).toBe(1);
      expect(updated[2].title).toBe('Question 2');
      expect(updated[2].order).toBe(2);
    });

    it('should do nothing when trying to move the last block down', () => {
      const updated = moveBlockDown(initialBlocks, 2);

      expect(updated[2].title).toBe('Question 3');
      expect(updated[2].order).toBe(2);
    });

    it('should arbitrarily reorder a block across multiple positions (drag reorder)', () => {
      // Move from index 2 (rating) to index 0
      const moved = reorderBlocks(initialBlocks, 2, 0);

      expect(moved).toHaveLength(3);
      expect(moved[0].title).toBe('Question 3');
      expect(moved[0].order).toBe(0);
      expect(moved[1].title).toBe('Question 1');
      expect(moved[1].order).toBe(1);
      expect(moved[2].title).toBe('Question 2');
      expect(moved[2].order).toBe(2);
    });

    it('should handle invalid bounds gracefully during reordering', () => {
      const invalidSource = reorderBlocks(initialBlocks, -1, 1);
      expect(invalidSource).toEqual(initialBlocks);

      const invalidTarget = reorderBlocks(initialBlocks, 1, 99);
      expect(invalidTarget).toEqual(initialBlocks);

      const sameIndex = reorderBlocks(initialBlocks, 1, 1);
      expect(sameIndex).toEqual(initialBlocks);
    });
  });

  describe('Block Duplication Operations', () => {
    it('should clone a text block with a new unique ID and sequential order', () => {
      const blocks: FormBlock[] = [
        createDefaultBlock('text', 0, {
          title: 'Your Name',
          placeholder: 'Jane Doe',
          required: true,
        }),
        createDefaultBlock('date', 1, { title: 'Event Date' }),
      ];

      const { updatedBlocks, newBlockIndex, newBlock } = duplicateBlock(
        blocks,
        0,
      );

      expect(updatedBlocks).toHaveLength(3);
      expect(newBlockIndex).toBe(1);
      expect(newBlock.id).not.toBe(blocks[0].id);
      expect(newBlock.id).toMatch(/^blk-/);
      expect(newBlock.title).toBe('Your Name (Copy)');
      expect(newBlock.order).toBe(1);
      expect((newBlock as TextBlock).placeholder).toBe('Jane Doe');
      expect(newBlock.required).toBe(true);

      // The original should remain unchanged at 0
      expect(updatedBlocks[0].id).toBe(blocks[0].id);
      expect(updatedBlocks[0].order).toBe(0);

      // The subsequent block should be shifted to 2
      expect(updatedBlocks[2].title).toBe('Event Date');
      expect(updatedBlocks[2].order).toBe(2);

      updatedBlocks.forEach((b) => {
        expect(formBlockSchema.safeParse(b).success).toBe(true);
      });
    });

    it('should clone single_choice block with brand new unique option IDs and values', () => {
      const originalChoice = createDefaultBlock(
        'single_choice',
        0,
      ) as SingleChoiceBlock;
      const blocks: FormBlock[] = [originalChoice];

      const { newBlock } = duplicateBlock(blocks, 0);
      const clonedChoice = newBlock as SingleChoiceBlock;

      expect(clonedChoice.type).toBe('single_choice');
      expect(clonedChoice.id).not.toBe(originalChoice.id);
      expect(clonedChoice.options).toHaveLength(originalChoice.options.length);

      // Option IDs must be distinct from original to prevent collisions
      const origOptIds = new Set(originalChoice.options.map((o) => o.id));
      clonedChoice.options.forEach((opt) => {
        expect(origOptIds.has(opt.id)).toBe(false);
      });

      // Must validate against formBlockSchema with unique choice options
      const parsed = formBlockSchema.safeParse(clonedChoice);
      expect(parsed.success).toBe(true);
    });

    it('should clone multiple_choice block preserving option count and allowOther', () => {
      const originalMc = createDefaultBlock('multiple_choice', 0, {
        allowOther: true,
      }) as MultipleChoiceBlock;
      const blocks: FormBlock[] = [originalMc];

      const { newBlock } = duplicateBlock(blocks, 0);
      const cloned = newBlock as MultipleChoiceBlock;

      expect(cloned.allowOther).toBe(true);
      expect(cloned.options.length).toBe(originalMc.options.length);

      const parsed = formBlockSchema.safeParse(cloned);
      expect(parsed.success).toBe(true);
    });

    it('should throw an error when attempting to duplicate out of range', () => {
      const blocks = [createDefaultBlock('text', 0)];
      expect(() => duplicateBlock(blocks, 5)).toThrow();
    });

    it('should keep duplicated titles and option values within schema limits', () => {
      const block = createDefaultBlock('single_choice', 0, {
        title: 'T'.repeat(500),
        options: [
          { id: 'one', label: 'One', value: 'a'.repeat(300) },
          { id: 'two', label: 'Two', value: 'b'.repeat(300) },
        ],
      });
      const { newBlock } = duplicateBlock([block], 0);

      expect(formBlockSchema.safeParse(newBlock).success).toBe(true);
    });
  });

  describe('Block Deletion Operations', () => {
    it('should remove target block and reindex remaining blocks sequentially', () => {
      const blocks: FormBlock[] = [
        createDefaultBlock('text', 0, { title: 'Block 0' }),
        createDefaultBlock('number', 1, { title: 'Block 1' }),
        createDefaultBlock('rating', 2, { title: 'Block 2' }),
      ];

      const updated = deleteBlock(blocks, 1);

      expect(updated).toHaveLength(2);
      expect(updated[0].title).toBe('Block 0');
      expect(updated[0].order).toBe(0);
      expect(updated[1].title).toBe('Block 2');
      expect(updated[1].order).toBe(1);

      updated.forEach((b) => {
        expect(formBlockSchema.safeParse(b).success).toBe(true);
      });
    });

    it('should return unchanged array if index is out of bounds', () => {
      const blocks = [createDefaultBlock('text', 0)];
      expect(deleteBlock(blocks, -1)).toEqual(blocks);
      expect(deleteBlock(blocks, 10)).toEqual(blocks);
    });
  });

  describe('Block Properties Manipulation for All 9 Block Types', () => {
    it('should update common block properties (title, description, required)', () => {
      const block = createDefaultBlock('text', 0);
      const updated: FormBlock = {
        ...block,
        title: 'Updated Question Title',
        description: 'Please provide a detailed response',
        required: true,
      };

      const result = updateBlockInList([block], 0, updated);
      expect(result[0].title).toBe('Updated Question Title');
      expect(result[0].description).toBe('Please provide a detailed response');
      expect(result[0].required).toBe(true);

      expect(formBlockSchema.safeParse(result[0]).success).toBe(true);
    });

    it('should update text & textarea block properties (placeholder, minLength, maxLength)', () => {
      const textBlock = createDefaultBlock('text', 0) as TextBlock;
      const updatedText: TextBlock = {
        ...textBlock,
        placeholder: 'Type something...',
        minLength: 5,
        maxLength: 50,
      };
      expect(formBlockSchema.safeParse(updatedText).success).toBe(true);

      // Invalid case: minLength > maxLength
      const invalidText: TextBlock = {
        ...textBlock,
        minLength: 100,
        maxLength: 10,
      };
      expect(formBlockSchema.safeParse(invalidText).success).toBe(false);
    });

    it('should update number block properties (min, max, step, integerOnly)', () => {
      const numBlock = createDefaultBlock('number', 0) as NumberBlock;
      const updatedNum: NumberBlock = {
        ...numBlock,
        min: 10,
        max: 100,
        step: 5,
        integerOnly: true,
      };
      expect(formBlockSchema.safeParse(updatedNum).success).toBe(true);

      // Invalid case: min > max
      const invalidNum: NumberBlock = {
        ...numBlock,
        min: 100,
        max: 10,
      };
      expect(formBlockSchema.safeParse(invalidNum).success).toBe(false);
    });

    it('should manage choices on single_choice block (add, edit, remove, allowOther)', () => {
      const choiceBlock = createDefaultBlock(
        'single_choice',
        0,
      ) as SingleChoiceBlock;

      // Add a third option
      const withThreeOptions: SingleChoiceBlock = {
        ...choiceBlock,
        options: [
          ...choiceBlock.options,
          { id: 'opt-3', label: 'Third Option', value: 'opt_3' },
        ],
        allowOther: true,
      };
      expect(formBlockSchema.safeParse(withThreeOptions).success).toBe(true);

      // Edit option label
      const edited: SingleChoiceBlock = {
        ...withThreeOptions,
        options: withThreeOptions.options.map((o) =>
          o.id === 'opt-1' ? { ...o, label: 'Updated First Choice' } : o,
        ),
      };
      expect(formBlockSchema.safeParse(edited).success).toBe(true);
      expect(edited.options[0].label).toBe('Updated First Choice');

      // Removing down to 1 option should violate schema (minimum 2 options required)
      const invalidFewOptions: SingleChoiceBlock = {
        ...choiceBlock,
        options: [{ id: 'opt-1', label: 'Only One', value: 'only_one' }],
      };
      expect(formBlockSchema.safeParse(invalidFewOptions).success).toBe(false);
    });

    it('should update rating block properties (maxRating, ratingShape)', () => {
      const ratingBlock = createDefaultBlock('rating', 0) as RatingBlock;
      const updatedRating: RatingBlock = {
        ...ratingBlock,
        maxRating: 10,
        ratingShape: 'HEART',
      };
      expect(formBlockSchema.safeParse(updatedRating).success).toBe(true);
      expect(updatedRating.ratingShape).toBe('HEART');
      expect(updatedRating.maxRating).toBe(10);
    });

    it('should update linear_scale block properties with step validation', () => {
      const scaleBlock = createDefaultBlock(
        'linear_scale',
        0,
      ) as LinearScaleBlock;
      const updatedScale: LinearScaleBlock = {
        ...scaleBlock,
        min: 0,
        max: 10,
        step: 2,
        minLabel: 'Poor',
        maxLabel: 'Exceptional',
      };
      expect(formBlockSchema.safeParse(updatedScale).success).toBe(true);

      // Invalid step: (10 - 0) % 3 !== 0
      const invalidScale: LinearScaleBlock = {
        ...scaleBlock,
        min: 0,
        max: 10,
        step: 3,
      };
      expect(formBlockSchema.safeParse(invalidScale).success).toBe(false);
    });

    it('should update date block properties (minDate, maxDate, includeTime)', () => {
      const dateBlock = createDefaultBlock('date', 0) as DateBlock;
      const updatedDate: DateBlock = {
        ...dateBlock,
        minDate: '2026-01-01',
        maxDate: '2026-12-31',
        includeTime: true,
      };
      expect(formBlockSchema.safeParse(updatedDate).success).toBe(true);

      // Invalid date range: minDate > maxDate
      const invalidDate: DateBlock = {
        ...dateBlock,
        minDate: '2026-12-31',
        maxDate: '2026-01-01',
      };
      expect(formBlockSchema.safeParse(invalidDate).success).toBe(false);
    });

    it('should update file_upload block properties (maxFileSizeMb, maxFiles, allowedMimeTypes)', () => {
      const uploadBlock = createDefaultBlock(
        'file_upload',
        0,
      ) as FileUploadBlock;
      const updatedUpload: FileUploadBlock = {
        ...uploadBlock,
        maxFileSizeMb: 25,
        maxFiles: 5,
        allowedMimeTypes: ['application/pdf', 'image/png'],
      };
      expect(formBlockSchema.safeParse(updatedUpload).success).toBe(true);

      // Invalid mime type format
      const invalidUpload: FileUploadBlock = {
        ...uploadBlock,
        allowedMimeTypes: ['not-a-valid-mime'],
      };
      expect(formBlockSchema.safeParse(invalidUpload).success).toBe(false);
    });

    it('should serialize multi-block form after diverse edits and validate against formDefinitionSchema', () => {
      let blocks: FormBlock[] = [
        createDefaultBlock('text', 0),
        createDefaultBlock('single_choice', 1),
        createDefaultBlock('rating', 2),
      ];

      // 1. Reorder rating to position 0
      blocks = reorderBlocks(blocks, 2, 0);

      // 2. Duplicate single_choice
      const dup = duplicateBlock(blocks, 2);
      blocks = dup.updatedBlocks;

      // 3. Edit text block properties
      blocks = updateBlockInList(blocks, 1, {
        ...blocks[1],
        title: 'Edited Text Question',
        required: true,
      });

      // 4. Delete the first rating block
      blocks = deleteBlock(blocks, 0);

      const formPayload = {
        schemaVersion: 1,
        title: 'Edited Survey',
        description: 'Form after editing and manipulations',
        blocks,
        settings: {
          shuffleBlocks: false,
          progressBar: true,
          requireAuth: false,
          submitButtonText: 'Submit',
        },
        metadata: {
          expectedEffortSeconds: 90,
          minTimeBarrierSeconds: 20,
        },
      };

      const parsed = formDefinitionSchema.safeParse(formPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.blocks).toHaveLength(3);
        expect(parsed.data.blocks[0].order).toBe(0);
        expect(parsed.data.blocks[1].order).toBe(1);
        expect(parsed.data.blocks[2].order).toBe(2);
      }
    });
  });
});
