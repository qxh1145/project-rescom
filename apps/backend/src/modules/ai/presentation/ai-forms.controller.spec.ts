import { AiFormsController } from './ai-forms.controller';
import { AiPromptService } from '../application/ai-prompt.service';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { AiPromptSubmissionInput } from '@rescom/schemas';

describe('AiFormsController (Story 3.1)', () => {
  let controller: AiFormsController;
  let service: AiPromptService;

  // RBAC note: As of the fix for Story 3.1, the AI endpoint is gated only by
  // SessionAuthGuard — any ACTIVE authenticated user (including RESPONDENT role)
  // may call it. We test with both a RESPONDENT and a PUBLISHER to confirm the
  // endpoint is not role-restricted at the controller level.
  const mockPublisher: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'publisher@rescom.io',
    role: 'PUBLISHER',
    status: 'ACTIVE',
  };

  const mockRespondent: AuthenticatedUser = {
    id: '22222222-2222-4222-8222-222222222222',
    email: 'respondent@rescom.io',
    role: 'RESPONDENT', // default DB role — must also be able to use AI generation
    status: 'ACTIVE',
  };

  beforeEach(() => {
    service = new AiPromptService();
    controller = new AiFormsController(service);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should accept a valid prompt from a PUBLISHER and return success envelope with prepared payload', async () => {
    const input: AiPromptSubmissionInput = {
      prompt:
        'Design an employee satisfaction survey regarding work-from-home policy.',
      targetQuestionCount: 6,
      preferredBlockTypes: ['single_choice', 'rating', 'textarea'],
    };

    const response = await controller.preparePrompt(mockPublisher, input);

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();
    expect(response.data!.userPrompt).toBe(input.prompt);
    expect(response.data!.formSchemaContract.supportedBlockTypes).toHaveLength(
      9,
    );
    // All 9 block types including file_upload must be present in the AI contract
    expect(response.data!.formSchemaContract.supportedBlockTypes).toContain(
      'file_upload',
    );
    expect(response.data!.systemPrompt).toContain('Form Definition JSON');
    expect(response.meta.message).toBe(
      'AI prompt payload prepared successfully',
    );
  });

  it('should accept a valid prompt from a RESPONDENT-role user (RBAC fix: all active users have publisher capability)', async () => {
    const input: AiPromptSubmissionInput = {
      prompt:
        'Create a short survey about campus dining experience at FPT University.',
      targetQuestionCount: 5,
    };

    // This call must NOT throw — the endpoint is not role-restricted
    const response = await controller.preparePrompt(mockRespondent, input);

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();
    expect(response.data!.userPrompt).toBe(input.prompt);
  });

  it('should include all 9 block types in formSchemaContract.supportedBlockTypes (Story 3.1: file_upload must not be missing)', async () => {
    const input: AiPromptSubmissionInput = {
      prompt:
        'Generate a comprehensive research survey for a university thesis project.',
    };

    const response = await controller.preparePrompt(mockPublisher, input);

    const supported = response.data!.formSchemaContract.supportedBlockTypes;
    const expectedTypes = [
      'text',
      'textarea',
      'number',
      'single_choice',
      'multiple_choice',
      'rating',
      'linear_scale',
      'date',
      'file_upload', // previously missing from preferredBlockTypes contract
    ];

    expect(supported).toHaveLength(9);
    expectedTypes.forEach((type) => {
      expect(supported).toContain(type);
    });
  });
});
