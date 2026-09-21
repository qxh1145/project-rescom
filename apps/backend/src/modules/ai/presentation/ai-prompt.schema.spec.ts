import {
  aiPromptSubmissionSchema,
  aiGatewayPromptPayloadSchema,
  AiPromptSubmissionInput,
  AiGatewayPromptPayload,
} from '@rescom/schemas';

describe('AI Prompt Submission & Gateway Payload Schemas (Story 3.1)', () => {
  describe('aiPromptSubmissionSchema', () => {
    it('should validate a valid prompt submission input', () => {
      const valid: AiPromptSubmissionInput = {
        prompt:
          'Create a survey for customer feedback on our e-commerce mobile app.',
        targetQuestionCount: 5,
        preferredBlockTypes: ['rating', 'single_choice', 'textarea'],
      };

      const parsed = aiPromptSubmissionSchema.parse(valid);
      expect(parsed.prompt).toBe(valid.prompt);
      expect(parsed.targetQuestionCount).toBe(5);
      expect(parsed.preferredBlockTypes).toEqual([
        'rating',
        'single_choice',
        'textarea',
      ]);
    });

    it('should allow prompt with only required fields and trimmed whitespace', () => {
      const input = {
        prompt:
          '   Evaluate user satisfaction with our new delivery speed and options.   ',
      };

      const parsed = aiPromptSubmissionSchema.parse(input);
      expect(parsed.prompt).toBe(
        'Evaluate user satisfaction with our new delivery speed and options.',
      );
      expect(parsed.targetQuestionCount).toBeUndefined();
      expect(parsed.preferredBlockTypes).toBeUndefined();
    });

    it('should reject prompt shorter than 10 characters', () => {
      const input = { prompt: 'Too short' };
      expect(() => aiPromptSubmissionSchema.parse(input)).toThrow();
    });

    it('should reject prompt exceeding 4000 characters', () => {
      const input = { prompt: 'a'.repeat(4001) };
      expect(() => aiPromptSubmissionSchema.parse(input)).toThrow();
    });

    it('should reject targetQuestionCount outside 1..30', () => {
      expect(() =>
        aiPromptSubmissionSchema.parse({
          prompt: 'Valid prompt describing the survey.',
          targetQuestionCount: 0,
        }),
      ).toThrow();

      expect(() =>
        aiPromptSubmissionSchema.parse({
          prompt: 'Valid prompt describing the survey.',
          targetQuestionCount: 31,
        }),
      ).toThrow();
    });

    it('should reject invalid block types in preferredBlockTypes', () => {
      expect(() =>
        aiPromptSubmissionSchema.parse({
          prompt: 'Valid prompt describing the survey.',
          preferredBlockTypes: ['invalid_type' as any],
        }),
      ).toThrow();
    });

    it('should reject extra unrecognized fields (.strict())', () => {
      expect(() =>
        aiPromptSubmissionSchema.parse({
          prompt: 'Valid prompt describing the survey.',
          unrecognizedKey: 'malicious or unexpected value',
        }),
      ).toThrow();
    });
  });

  describe('aiGatewayPromptPayloadSchema', () => {
    it('should validate structured AI gateway prompt payload', () => {
      const payload: AiGatewayPromptPayload = {
        systemPrompt:
          'You are an AI assistant generating survey forms in Form Definition JSON.',
        formSchemaContract: {
          schemaVersion: 1,
          supportedBlockTypes: [
            'text',
            'textarea',
            'number',
            'single_choice',
            'multiple_choice',
            'rating',
            'linear_scale',
            'date',
            'file_upload',
          ],
          constraints: {
            minBlocks: 1,
            maxTitleLength: 200,
          },
        },
        userPrompt:
          'Create a survey for employee satisfaction with remote work.',
        options: {
          temperature: 0.2,
          maxTokens: 4000,
          targetQuestionCount: 6,
        },
      };

      const parsed = aiGatewayPromptPayloadSchema.parse(payload);
      expect(parsed.systemPrompt).toBe(payload.systemPrompt);
      expect(parsed.formSchemaContract.schemaVersion).toBe(1);
      expect(parsed.formSchemaContract.supportedBlockTypes).toHaveLength(9);
      expect(parsed.userPrompt).toBe(payload.userPrompt);
      expect(parsed.options?.targetQuestionCount).toBe(6);
    });

    it('should reject payload missing required fields or having extra properties', () => {
      expect(() =>
        aiGatewayPromptPayloadSchema.parse({
          systemPrompt: 'Only system prompt',
        }),
      ).toThrow();

      expect(() =>
        aiGatewayPromptPayloadSchema.parse({
          systemPrompt: 'System',
          formSchemaContract: {
            schemaVersion: 1,
            supportedBlockTypes: ['text'],
          },
          userPrompt: 'User',
          extraPayloadProperty: 'unexpected',
        }),
      ).toThrow();
    });
  });
});
