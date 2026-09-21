import { FormsController } from './forms.controller';
import { FormsService } from '../application/forms.service';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { CompletionCodeService } from '../infrastructure/completion-code.service';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('FormsController', () => {
  let controller: FormsController;
  let service: FormsService;

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'publisher@example.com',
    role: 'PUBLISHER',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    const repository = new InMemoryFormRepository();
    const completionCodeService = new CompletionCodeService();
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
    expect(response.data!.status).toBe('PUBLISHED');
    expect(response.data!.currentVersion.isPublished).toBe(true);
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

    const response = await controller.closeForm(mockUser, created.data!.id, {
      reason: 'Campaign ended',
    });

    expect(response.error).toBeNull();
    expect(response.data!.status).toBe('CLOSED');
    expect(response.meta.message).toBe('Form closed successfully');
  });

  it('should transition form status and return wrapped success envelope', async () => {
    const created = await controller.createDraft(mockUser, {
      title: 'Survey to Escrow',
      type: 'INTERNAL',
      rewardPerResponse: 10,
      schema: {
        schemaVersion: 1,
        title: 'Survey to Escrow',
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

    const adminUser: AuthenticatedUser = {
      ...mockUser,
      id: '22222222-2222-4222-8222-222222222222',
      role: 'ADMIN',
    };

    const response = await controller.transitionStatus(
      adminUser,
      created.data!.id,
      { targetStatus: 'MODERATION_QUEUE' },
    );

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
});
