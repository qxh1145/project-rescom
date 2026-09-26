import { FormsController } from './forms.controller';
import { FormsService } from '../application/forms.service';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { CompletionCodeService } from '../infrastructure/completion-code.service';
import type { EnvService } from '../../../common/config/env.service';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { FormModerationCommands } from '../application/form-moderation.commands';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';

const TEST_COMPLETION_CODE_ENV = {
  completionCodeHmacSecret: 'unit_test_completion_code_hmac_secret_0123456789',
} as EnvService;

describe('FormsController', () => {
  let controller: FormsController;
  let service: FormsService;
  let repository: InMemoryFormRepository;

  /** Story 8.1: the Admin approval that turns a queued survey PUBLISHED. */
  async function approveQueued(formId: string) {
    const snapshot = await repository.findById(formId);
    await new FormModerationCommands(repository).approvePublication(
      snapshot!,
      new Date(),
    );
  }

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'publisher@example.com',
    role: 'PUBLISHER',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    repository = new InMemoryFormRepository();
    const completionCodeService = new CompletionCodeService(
      TEST_COMPLETION_CODE_ENV,
    );
    service = new FormsService(repository, completionCodeService);
    controller = new FormsController(service);
  });

  it('should create a form draft and return wrapped success envelope', async () => {
    const response = await controller.createDraft(mockUser, {
      title: 'New Student Survey',
      type: 'INTERNAL',
      rewardPerResponse: 10,
      expectedCompletions: 25,
    });

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();
    expect(response.data!.title).toBe('New Student Survey');
    expect(response.data!.status).toBe('DRAFT');
    expect(response.meta.message).toBe('Form draft created successfully');
  });

  it('should list forms for current user', async () => {
    await controller.createDraft(mockUser, { title: 'Survey 1' });
    await controller.createDraft(mockUser, { title: 'Survey 2' });

    const response = await controller.listForms(mockUser, {
      page: 1,
      limit: 10,
    });

    expect(response.error).toBeNull();
    expect(response.data!.total).toBe(2);
    expect(response.data!.forms).toHaveLength(2);
  });

  it('should get a specific form by ID', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Specific Survey',
    });

    const response = await controller.getForm(mockUser, created.data!.id);

    expect(response.error).toBeNull();
    expect(response.data!.id).toBe(created.data!.id);
    expect(response.data!.title).toBe('Specific Survey');
  });

  it('should autosave/update a form draft', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Initial Title',
    });

    const response = await controller.updateDraft(mockUser, created.data!.id, {
      clientUpdatedAt: created.data!.updatedAt, // echo back server's updatedAt
      title: 'Autosaved Title',
      description: 'Added description during draft edit',
    });

    expect(response.error).toBeNull();
    expect(response.data!.title).toBe('Autosaved Title');
    expect(response.data!.description).toBe(
      'Added description during draft edit',
    );
    expect(response.meta.message).toBe('Form draft autosaved successfully');
  });

  it('should autosave/update a form draft with valid targeting criteria', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Targeting Controller Survey',
    });

    const response = await controller.updateDraft(mockUser, created.data!.id, {
      clientUpdatedAt: created.data!.updatedAt,
      targetingJson: {
        ageRange: { min: 18, max: 30 },
        locations: ['Hanoi'],
        genders: ['MALE', 'FEMALE'],
      },
    });

    expect(response.error).toBeNull();
    expect(response.data!.currentVersion.targetingJson).toEqual({
      ageRange: { min: 18, max: 30 },
      locations: ['Hanoi'],
      genders: ['MALE', 'FEMALE'],
    });
  });

  it('should reject updateDraft when targeting criteria is invalid', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Targeting Error Survey',
    });

    await expect(
      controller.updateDraft(mockUser, created.data!.id, {
        clientUpdatedAt: created.data!.updatedAt,
        targetingJson: {
          ageRange: { min: 50, max: 20 },
        },
      }),
    ).rejects.toThrow('Invalid survey targeting criteria');
  });

  it('should delete a form draft', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Draft to delete',
    });

    const response = await controller.deleteDraft(mockUser, created.data!.id);

    expect(response.error).toBeNull();
    expect(response.data!.id).toBe(created.data!.id);
    expect(response.meta.message).toBe('Form draft deleted successfully');
  });

  it('should publish a form and return wrapped success envelope', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Survey to Publish',
      type: 'INTERNAL',
      rewardPerResponse: 0,
      schema: {
        schemaVersion: 1,
        title: 'Survey to Publish',
        blocks: [
          {
            id: 'b-1',
            type: 'text',
            order: 0,
            title: 'Your feedback',
            required: false,
          },
        ],
      },
    });

    const response = await controller.publishForm(mockUser, created.data!.id);

    expect(response.error).toBeNull();
    // Story 8.1: publishing submits the survey to the moderation queue.
    expect(response.data!.status).toBe('MODERATION_QUEUE');
    expect(response.data!.currentVersion.isPublished).toBe(false);
    expect(response.meta.message).toBe('Form published successfully');
  });

  it('should close a published form and return wrapped success envelope', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Survey to Close',
      type: 'INTERNAL',
      rewardPerResponse: 0,
      schema: {
        schemaVersion: 1,
        title: 'Survey to Close',
        blocks: [
          {
            id: 'b-1',
            type: 'text',
            order: 0,
            title: 'Your feedback',
            required: false,
          },
        ],
      },
    });

    await controller.publishForm(mockUser, created.data!.id);
    await approveQueued(created.data!.id);

    const response = await controller.closeForm(mockUser, created.data!.id, {
      reason: 'Campaign ended',
    });

    expect(response.error).toBeNull();
    expect(response.data!.status).toBe('CLOSED');
    expect(response.meta.message).toBe('Form closed successfully');
  });

  it('should transition form status and return wrapped success envelope', async () => {
    // Story 8.1: the generic endpoint only moves legacy ESCROW_LOCKED rows
    // into the moderation queue.
    const now = new Date();
    const legacy = new FormEntity(
      '33333333-3333-4333-8333-333333333333',
      mockUser.id,
      'INTERNAL',
      'ESCROW_LOCKED',
      'Legacy Escrow Survey',
      null,
      10,
      50,
      now,
      now,
    );
    await repository.create(
      legacy,
      new FormVersionEntity(
        '44444444-4444-4444-8444-444444444444',
        legacy.id,
        1,
        {
          schemaVersion: 1,
          title: 'Legacy Escrow Survey',
          // Epic 8 review P2: the legacy move re-runs the publish validations.
          blocks: [
            {
              id: 'legacy-q1',
              type: 'text',
              order: 0,
              title: 'Question',
              required: false,
            },
          ],
          settings: {
            shuffleBlocks: false,
            progressBar: true,
            requireAuth: false,
            allowPublicAccess: true,
            submitButtonText: 'Submit',
          },
          metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
        },
        null,
        false,
        null,
        null,
        null,
        now,
      ),
    );

    const adminUser: AuthenticatedUser = {
      ...mockUser,
      id: '22222222-2222-4222-8222-222222222222',
      role: 'ADMIN',
    };

    const response = await controller.transitionStatus(adminUser, legacy.id, {
      targetStatus: 'MODERATION_QUEUE',
    });

    expect(response.error).toBeNull();
    expect(response.data!.status).toBe('MODERATION_QUEUE');
    expect(response.meta.message).toBe('Form status updated successfully');
  });

  it('should create a new version of a published form and return wrapped success envelope', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Survey to Version',
      type: 'INTERNAL',
      rewardPerResponse: 0,
      schema: {
        schemaVersion: 1,
        title: 'Survey to Version',
        blocks: [
          {
            id: 'b-1',
            type: 'text',
            order: 0,
            title: 'Your feedback',
            required: false,
          },
        ],
      },
    });

    await controller.publishForm(mockUser, created.data!.id);
    await approveQueued(created.data!.id);

    const response = await controller.createNewVersion(
      mockUser,
      created.data!.id,
    );

    expect(response.error).toBeNull();
    expect(response.data!.status).toBe('DRAFT');
    expect(response.data!.currentVersion.versionNumber).toBe(2);
    expect(response.meta.message).toBe(
      'New form version created successfully. The form is now in DRAFT status for editing.',
    );
    expect(response.data!.interruptedAttempts).toBe(0);
  });

  it('warns the Publisher about in-progress attempts before and after "Create New Version" (decision E5-D4)', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Live Survey',
      type: 'INTERNAL',
      rewardPerResponse: 0,
      schema: {
        schemaVersion: 1,
        title: 'Live Survey',
        blocks: [
          {
            id: 'b-1',
            type: 'text',
            order: 0,
            title: 'Your feedback',
            required: false,
          },
        ],
      },
    });
    await controller.publishForm(mockUser, created.data!.id);
    await approveQueued(created.data!.id);
    repository.useInProgressAttemptsSource(() => 4);

    const impact = await controller.getInProgressAttempts(
      mockUser,
      created.data!.id,
    );
    expect(impact.data).toEqual({
      formId: created.data!.id,
      status: 'PUBLISHED',
      inProgressAttempts: 4,
      reservationWindowMinutes: 30,
    });

    const response = await controller.createNewVersion(
      mockUser,
      created.data!.id,
    );
    expect(response.data!.interruptedAttempts).toBe(4);
    expect(response.meta.message).toMatch(
      /4 in-progress attempt\(s\) on the previous version were cut off/,
    );
  });

  it('should list all versions of a form and return wrapped success envelope', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Survey for Version List',
      type: 'INTERNAL',
      rewardPerResponse: 0,
      schema: {
        schemaVersion: 1,
        title: 'Survey for Version List',
        blocks: [
          {
            id: 'b-1',
            type: 'text',
            order: 0,
            title: 'Your feedback',
            required: false,
          },
        ],
      },
    });

    await controller.publishForm(mockUser, created.data!.id);
    await approveQueued(created.data!.id);
    await controller.createNewVersion(mockUser, created.data!.id);

    const response = await controller.listVersions(mockUser, created.data!.id);

    expect(response.error).toBeNull();
    expect(response.data).toHaveLength(2);
    expect(response.data![0].versionNumber).toBe(1);
    expect(response.data![1].versionNumber).toBe(2);
  });

  it('should create an external survey and return wrapped success envelope with plaintext code', async () => {
    const response = await controller.createExternalSurvey(mockUser, {
      title: 'Google Form Study',
      externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
      rewardPerResponse: 15,
      expectedCompletions: 30,
      autoPublish: false,
    });

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();
    expect(response.data!.type).toBe('EXTERNAL');
    expect(response.data!.plaintextCompletionCode).toMatch(/^\d{6}$/);
    expect(response.data!.hasCompletionCode).toBe(true);
    expect(response.meta.message).toBe('External survey created successfully');
  });

  it('should rotate completion code for external survey and return wrapped success envelope with new code', async () => {
    const created = await controller.createExternalSurvey(mockUser, {
      title: 'Rotatable Google Form',
      externalUrl: 'https://forms.gle/test1234',
      autoPublish: false,
    });

    const response = await controller.rotateCompletionCode(
      mockUser,
      created.data!.id,
      { reason: 'Periodic rotation' },
    );

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();
    expect(response.data!.currentVersion.versionNumber).toBe(2);
    expect(response.data!.plaintextCompletionCode).toMatch(/^\d{6}$/);
    expect(response.data!.hasCompletionCode).toBe(true);
    expect(response.meta.message).toBe('Completion code rotated successfully');
  });

  it('should reopen a closed form with additional quota and return wrapped success envelope (FR-33)', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Survey to Reopen',
      type: 'INTERNAL',
      rewardPerResponse: 0,
      schema: {
        schemaVersion: 1,
        title: 'Survey to Reopen',
        blocks: [
          {
            id: 'b-1',
            type: 'text',
            order: 0,
            title: 'Your feedback',
            required: false,
          },
        ],
      },
    });

    await controller.publishForm(mockUser, created.data!.id);
    await approveQueued(created.data!.id);
    await controller.closeForm(mockUser, created.data!.id);

    const response = await controller.reopenForm(mockUser, created.data!.id, {
      additionalCompletions: 30,
    });

    expect(response.error).toBeNull();
    expect(response.data).toBeDefined();
    expect(response.data!.status).toBe('PUBLISHED');
    expect(response.data!.expectedCompletions).toBe(
      created.data!.expectedCompletions + 30,
    );
    expect(response.meta.message).toBe(
      'Form reopened successfully with additional quota',
    );
  });

  it('should get pricing quote for a form with 20% internal discount comparison (FR-14, FR-19)', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Quote Survey',
      type: 'INTERNAL',
      rewardPerResponse: 20,
      expectedCompletions: 50,
      estimatedDurationMinutes: 16,
    });

    const response = await controller.getPricingQuote(
      mockUser,
      created.data!.id,
    );

    expect(response.error).toBeNull();
    expect(response.data).toEqual({
      type: 'INTERNAL',
      expectedCompletions: 50,
      baseRewardPerResponse: 20,
      effectiveRewardPerResponse: 16,
      baseCost: 1000,
      effectiveCost: 800,
      discountPercent: 20,
      discountAmount: 200,
      // Decision E6-D2: the pricing band of the estimated duration.
      estimatedDurationMinutes: 16,
      pricingBand: {
        min: 20,
        max: 40,
        suggested: 20,
        durationBand: '> 15 min',
      },
      bandCheck: 'WITHIN_BAND',
    });
  });
});
