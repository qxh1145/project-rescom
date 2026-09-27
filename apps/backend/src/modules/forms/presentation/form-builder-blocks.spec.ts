import {
  formBlockTypeEnum,
  formBlockSchema,
  formDefinitionSchema,
  createDefaultBlock,
  FormBlockType,
} from '@rescom/schemas';

describe('Story 2.3: Form Builder Blocks & Factory Specification', () => {
  const allBlockTypes: FormBlockType[] = formBlockTypeEnum.options;

  it('should have exactly 9 supported block types in formBlockTypeEnum', () => {
    expect(allBlockTypes).toHaveLength(9);
    expect(allBlockTypes).toEqual([
      'text',
      'textarea',
      'number',
      'single_choice',
      'multiple_choice',
      'rating',
      'linear_scale',
      'date',
      'file_upload',
    ]);
  });

  describe('createDefaultBlock factory for all 9 block types', () => {
    allBlockTypes.forEach((type, index) => {
      it(`should create a valid default block for type: "${type}" satisfying formBlockSchema`, () => {
        const block = createDefaultBlock(type, index);

        expect(block.type).toBe(type);
        expect(block.order).toBe(index);
        expect(block.id).toBeDefined();
        expect(typeof block.id).toBe('string');
        expect(block.title).toBeDefined();
        expect(block.title.length).toBeGreaterThan(0);
        expect(block.required).toBe(false);

        // Crucial: Must parse cleanly without throwing ZodError
        const parsed = formBlockSchema.safeParse(block);
        expect(parsed.success).toBe(true);
      });
    });

    it('should create unique IDs when called multiple times', () => {
      const block1 = createDefaultBlock('text', 0);
      const block2 = createDefaultBlock('text', 1);
      expect(block1.id).not.toBe(block2.id);
    });

    it('should allow overriding title and required in createDefaultBlock', () => {
      const customBlock = createDefaultBlock('rating', 4, {
        title: 'How satisfied are you with RESCOM?',
        required: true,
      });

      expect(customBlock.type).toBe('rating');
      expect(customBlock.order).toBe(4);
      expect(customBlock.title).toBe('How satisfied are you with RESCOM?');
      expect(customBlock.required).toBe(true);

      const parsed = formBlockSchema.safeParse(customBlock);
      expect(parsed.success).toBe(true);
    });

    it('should instantiate single_choice with at least 2 distinct options', () => {
      const block = createDefaultBlock('single_choice', 0);
      if (block.type === 'single_choice') {
        expect(block.options.length).toBeGreaterThanOrEqual(2);
        const ids = block.options.map((o: { id: string }) => o.id);
        const values = block.options.map((o: { value: string }) => o.value);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(values).size).toBe(values.length);
      }
    });

    it('should instantiate multiple_choice with at least 2 distinct options', () => {
      const block = createDefaultBlock('multiple_choice', 0);
      if (block.type === 'multiple_choice') {
        expect(block.options.length).toBeGreaterThanOrEqual(2);
        const ids = block.options.map((o: { id: string }) => o.id);
        const values = block.options.map((o: { value: string }) => o.value);
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(values).size).toBe(values.length);
      }
    });

    it('should instantiate linear_scale with valid range and step divisibility', () => {
      const block = createDefaultBlock('linear_scale', 0);
      if (block.type === 'linear_scale') {
        expect(block.min).toBe(1);
        expect(block.max).toBe(5);
        expect(block.step).toBe(1);
        expect((block.max - block.min) % block.step).toBe(0);
      }
    });

    it('should instantiate file_upload with valid MIME types and max size', () => {
      const block = createDefaultBlock('file_upload', 0);
      if (block.type === 'file_upload') {
        expect(block.maxFileSizeMb).toBeGreaterThan(0);
        expect(block.maxFiles).toBeGreaterThanOrEqual(1);
        expect(block.allowedMimeTypes.length).toBeGreaterThan(0);
        block.allowedMimeTypes.forEach((mime: string) => {
          expect(mime).toMatch(/^[-\w.]+\/[-\w.+]+$/);
        });
      }
    });
  });

  describe('Form Builder Canvas Operations & State Synchronization', () => {
    it('should support inserting a block at any index and re-indexing sequentially', () => {
      const initialBlocks = [
        createDefaultBlock('text', 0),
        createDefaultBlock('number', 1),
      ];

      // Insert at middle (index 1)
      const insertedBlock = createDefaultBlock('rating', 1);
      const updated = [...initialBlocks];
      updated.splice(1, 0, insertedBlock);
      const reindexed = updated.map((b, idx) => ({ ...b, order: idx }));

      expect(reindexed).toHaveLength(3);
      expect(reindexed[0].type).toBe('text');
      expect(reindexed[0].order).toBe(0);
      expect(reindexed[1].type).toBe('rating');
      expect(reindexed[1].order).toBe(1);
      expect(reindexed[2].type).toBe('number');
      expect(reindexed[2].order).toBe(2);

      reindexed.forEach((block) => {
        expect(formBlockSchema.safeParse(block).success).toBe(true);
      });
    });

    it('should support deleting a block and maintaining valid sequential order', () => {
      const blocks = [
        createDefaultBlock('text', 0),
        createDefaultBlock('single_choice', 1),
        createDefaultBlock('file_upload', 2),
      ];

      // Delete block at index 1
      const next = blocks.filter((_, idx) => idx !== 1);
      const reindexed = next.map((b, idx) => ({ ...b, order: idx }));

      expect(reindexed).toHaveLength(2);
      expect(reindexed[0].type).toBe('text');
      expect(reindexed[0].order).toBe(0);
      expect(reindexed[1].type).toBe('file_upload');
      expect(reindexed[1].order).toBe(1);

      reindexed.forEach((block) => {
        expect(formBlockSchema.safeParse(block).success).toBe(true);
      });
    });

    it('should compose a complete multi-block form with all 9 types and validate against formDefinitionSchema', () => {
      const allNineBlocks = allBlockTypes.map((type, idx) =>
        createDefaultBlock(type, idx, {
          title: `Sample question ${idx + 1} (${type})`,
        }),
      );

      const formPayload = {
        schemaVersion: 1,
        title: 'Comprehensive 9-Block Survey',
        description: 'Testing all block types on builder canvas',
        blocks: allNineBlocks,
        settings: {
          shuffleBlocks: false,
          progressBar: true,
          requireAuth: false,
          submitButtonText: 'Complete Survey',
        },
        metadata: {
          expectedEffortSeconds: 120,
          minTimeBarrierSeconds: 30,
        },
      };

      const parsed = formDefinitionSchema.safeParse(formPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.blocks).toHaveLength(9);
      }
    });
  });
});
