import { Test, TestingModule } from '@nestjs/testing';
import { AiPromptService } from './ai-prompt.service';
import { AiPromptSubmissionInput } from '@rescom/schemas';

describe('AiPromptService (Story 3.1)', () => {
  let service: AiPromptService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AiPromptService],
    }).compile();

    service = module.get<AiPromptService>(AiPromptService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('buildPromptPayload', () => {
    it('should construct a complete AiGatewayPromptPayload with Form Definition rules', () => {
      const input: AiPromptSubmissionInput = {
        prompt:
          'Create a survey to gather student satisfaction with campus cafeteria food.',
        targetQuestionCount: 5,
        preferredBlockTypes: ['single_choice', 'rating', 'textarea'],
      };

      const payload = service.buildPromptPayload(input);

      expect(payload).toBeDefined();
      expect(payload.userPrompt).toBe(input.prompt);
      expect(payload.options?.targetQuestionCount).toBe(5);

      // Verify contract metadata
      expect(payload.formSchemaContract.schemaVersion).toBe(1);
      expect(payload.formSchemaContract.supportedBlockTypes).toContain('text');
      expect(payload.formSchemaContract.supportedBlockTypes).toContain(
        'rating',
      );
      expect(payload.formSchemaContract.supportedBlockTypes).toContain(
        'single_choice',
      );
      expect(payload.formSchemaContract.supportedBlockTypes).toHaveLength(9);

      // Verify system prompt contains key Form Definition constraints
      expect(payload.systemPrompt).toContain('Form Definition JSON');
      expect(payload.systemPrompt).toContain('schemaVersion');
      expect(payload.systemPrompt).toContain('blocks');
      expect(payload.systemPrompt).toContain('single_choice');
      expect(payload.systemPrompt).toContain('rating');
      expect(payload.systemPrompt).toContain('textarea');
      expect(payload.systemPrompt).toContain('Target Questions: 5');
      expect(payload.systemPrompt).toContain(
        'Preferred Question Types: single_choice, rating, textarea',
      );
    });

    it('should handle prompt submission without optional fields', () => {
      const input: AiPromptSubmissionInput = {
        prompt:
          'Gather feedback from beta testers regarding app performance and UI bugs.',
      };

      const payload = service.buildPromptPayload(input);

      expect(payload.userPrompt).toBe(input.prompt);
      expect(payload.options?.targetQuestionCount).toBeUndefined();
      expect(payload.systemPrompt).toContain('Form Definition JSON');
      expect(payload.systemPrompt).not.toContain('Preferred Question Types:');
    });
  });
});
