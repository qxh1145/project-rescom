import { FormsService } from './forms.service';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { CompletionCodeService } from '../infrastructure/completion-code.service';
import {
  FormForbiddenException,
  FormNotFoundException,
  FormNotInDraftStatusException,
  FormConflictException,
  FormValidationException,
  InvalidFormStatusTransitionException,
  FormAlreadyClosedException,
  FormHasPublishedVersionsException,
  FormNotPublishedException,
  TargetingValidationException,
} from './exceptions/form.exceptions';
import { FormBlock } from '@rescom/schemas';

describe('FormsService', () => {
  let service: FormsService;
  let repository: InMemoryFormRepository;
  let completionCodeService: CompletionCodeService;

  const publisherId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const adminId = '99999999-9999-4999-8999-999999999999';

  beforeEach(() => {
    repository = new InMemoryFormRepository();
    completionCodeService = new CompletionCodeService();
    service = new FormsService(repository, completionCodeService);
  });

  describe('createDraft', () => {
    it('creates a draft with default values when fields are omitted', async () => {
      const result = await service.createDraft(publisherId, {});

      expect(result.id).toBeDefined();
      expect(result.publisherId).toBe(publisherId);
      expect(result.title).toBe('Untitled Survey');
      expect(result.status).toBe('DRAFT');
      expect(result.type).toBe('INTERNAL');
      expect(result.rewardPerResponse).toBe(10);
      expect(result.expectedCompletions).toBe(50);
      expect(result.currentVersion).toBeDefined();
      expect(result.currentVersion.versionNumber).toBe(1);
      expect(result.currentVersion.isPublished).toBe(false);
      expect(result.currentVersion.schemaJson.blocks).toEqual([]);
    });

    it('creates a draft with custom properties and initial schema', async () => {
      const result = await service.createDraft(publisherId, {
        title: 'Campus Experience Survey',
        description: 'Survey about campus facilities',
        type: 'INTERNAL',
        rewardPerResponse: 20,
        expectedCompletions: 100,
        schema: {
          schemaVersion: 1,
          title: 'Campus Experience Survey',
          blocks: [
            {
              id: 'block-1',
              type: 'text',
              order: 0,
              title: 'What is your major?',
              required: true,
            },
          ],
          settings: {
            shuffleBlocks: false,
            progressBar: true,
            requireAuth: true,
            submitButtonText: 'Submit Survey',
          },
          metadata: {
            expectedEffortSeconds: 120,
            minTimeBarrierSeconds: 30,
          },
        },
      });

      expect(result.title).toBe('Campus Experience Survey');
      expect(result.description).toBe('Survey about campus facilities');
      expect(result.rewardPerResponse).toBe(20);
      expect(result.expectedCompletions).toBe(100);
      expect(result.currentVersion.schemaJson.blocks).toHaveLength(1);
      expect(result.currentVersion.schemaJson.blocks[0].title).toBe(
        'What is your major?',
      );
    });
  });

  describe('getFormById', () => {
    it('returns form draft when requested by owner', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'My Survey',
      });

      const fetched = await service.getFormById(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(fetched.id).toBe(created.id);
      expect(fetched.title).toBe('My Survey');
    });

    it('returns form draft when requested by an admin', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'My Survey',
      });

      const fetched = await service.getFormById(created.id, {
        userId: adminId,
        role: 'ADMIN',
      });

      expect(fetched.id).toBe(created.id);
    });

    it('throws FormNotFoundException when form does not exist', async () => {
      await expect(
        service.getFormById('00000000-0000-4000-8000-000000000000', {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormNotFoundException);
    });

    it('throws FormForbiddenException when requested by another non-admin user', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Private Survey',
      });

      await expect(
        service.getFormById(created.id, {
          userId: otherUserId,
          role: 'RESPONDENT',
        }),
      ).rejects.toThrow(FormForbiddenException);
    });
  });

  describe('listForms', () => {
    it('returns paginated list of forms owned by publisher', async () => {
      await service.createDraft(publisherId, { title: 'Survey 1' });
      await service.createDraft(publisherId, { title: 'Survey 2' });
      await service.createDraft(otherUserId, { title: 'Other Survey' });

      const result = await service.listForms(publisherId, {
        page: 1,
        limit: 10,
      });

      expect(result.total).toBe(2);
      expect(result.forms).toHaveLength(2);
      expect(result.forms.every((f) => f.publisherId === publisherId)).toBe(
        true,
      );
    });

    it('filters forms by status', async () => {
      const draft = await service.createDraft(publisherId, {
        title: 'Draft Survey',
      });

      const result = await service.listForms(publisherId, {
        page: 1,
        limit: 10,
        status: 'DRAFT',
      });

      expect(result.total).toBe(1);
      expect(result.forms[0].id).toBe(draft.id);

      const publishedResult = await service.listForms(publisherId, {
        page: 1,
        limit: 10,
        status: 'PUBLISHED',
      });

      expect(publishedResult.total).toBe(0);
    });
  });

  describe('updateDraft', () => {
    it('updates draft details and schema incrementally', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Initial Title',
      });

      const updated = await service.updateDraft(
        created.id,
        { userId: publisherId, role: 'PUBLISHER' },
        {
          clientUpdatedAt: created.updatedAt, // echo back the server's updatedAt
          title: 'Updated Title',
          description: 'Updated description',
          rewardPerResponse: 15,
          schema: {
            schemaVersion: 1,
            title: 'Updated Title',
            blocks: [
              {
                id: 'b-1',
                type: 'number',
                order: 0,
                title: 'Your age?',
                required: false,
                integerOnly: false,
              },
            ],
            settings: {
              shuffleBlocks: true,
              progressBar: true,
              requireAuth: false,
              submitButtonText: 'Done',
            },
            metadata: {
              expectedEffortSeconds: 45,
              minTimeBarrierSeconds: 10,
            },
          },
        },
      );

      expect(updated.title).toBe('Updated Title');
      expect(updated.description).toBe('Updated description');
      expect(updated.rewardPerResponse).toBe(15);
      expect(updated.currentVersion.schemaJson.blocks).toHaveLength(1);
      expect(updated.currentVersion.schemaJson.blocks[0].id).toBe('b-1');
    });

    it('throws FormConflictException (optimistic lock) when clientUpdatedAt is stale', async () => {
      // Simulate a race: client A loaded the form 2 seconds ago (T0).
      // Since then, client B's autosave already committed (advancing server
      // updatedAt to T1 > T0). Client A now tries to autosave with the old T0.
      const created = await service.createDraft(publisherId, {
        title: 'Race Condition Survey',
      });

      // Manufacture a stale timestamp: 2 seconds before the server record
      const serverUpdatedAt = new Date(created.updatedAt);
      const staleTimestamp = new Date(
        serverUpdatedAt.getTime() - 2000,
      ).toISOString();

      // Client A arrives with the stale T0 — must be rejected with 409
      await expect(
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          {
            clientUpdatedAt: staleTimestamp,
            title: 'Stale write from Client A',
          },
        ),
      ).rejects.toThrow(FormConflictException);
    });

    it('rejects future client timestamps instead of bypassing the lock', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Survey',
      });
      const futureTimestamp = new Date(
        new Date(created.updatedAt).getTime() + 60_000,
      ).toISOString();

      await expect(
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          { clientUpdatedAt: futureTimestamp, title: 'Future write' },
        ),
      ).rejects.toThrow(FormConflictException);
    });

    it('allows only one concurrent update with the same version token', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Survey',
      });
      const results = await Promise.allSettled([
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          { clientUpdatedAt: created.updatedAt, title: 'Writer A' },
        ),
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          { clientUpdatedAt: created.updatedAt, title: 'Writer B' },
        ),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    });

    it('rejects update if form is not in DRAFT status (e.g. PUBLISHED)', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Survey',
      });

      // Manually set status to PUBLISHED in repository to test immutability guard
      const existing = await repository.findById(created.id);
      const publishedForm = existing!.form.copyWith({ status: 'PUBLISHED' });
      await repository.update(publishedForm);

      await expect(
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          {
            clientUpdatedAt: created.updatedAt,
            title: 'Illegal Edit',
          },
        ),
      ).rejects.toThrow(FormNotInDraftStatusException);
    });

    it('checks immutable status before reporting invalid targeting', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Published Targeted Survey',
      });
      const existing = await repository.findById(created.id);
      await repository.update(existing!.form.copyWith({ status: 'PUBLISHED' }));

      await expect(
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          {
            clientUpdatedAt: created.updatedAt,
            targetingJson: { ageRange: { min: 40, max: 20 } },
          },
        ),
      ).rejects.toThrow(FormNotInDraftStatusException);
    });

    it('throws FormForbiddenException if another user attempts update', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Survey',
      });

      await expect(
        service.updateDraft(
          created.id,
          { userId: otherUserId, role: 'PUBLISHER' },
          {
            clientUpdatedAt: created.updatedAt,
            title: 'Hijacked',
          },
        ),
      ).rejects.toThrow(FormForbiddenException);
    });

    it('checks ownership before reporting invalid targeting', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Private Targeted Survey',
      });

      await expect(
        service.updateDraft(
          created.id,
          { userId: otherUserId, role: 'PUBLISHER' },
          {
            clientUpdatedAt: created.updatedAt,
            targetingJson: { ageRange: { min: 40, max: 20 } },
          },
        ),
      ).rejects.toThrow(FormForbiddenException);
    });

    it('saves valid demographic targeting criteria to form version', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Targeted Survey',
      });

      const updated = await service.updateDraft(
        created.id,
        { userId: publisherId, role: 'PUBLISHER' },
        {
          clientUpdatedAt: created.updatedAt,
          targetingJson: {
            ageRange: { min: 20, max: 35 },
            locations: ['Hanoi', 'Da Nang'],
            genders: ['FEMALE'],
            occupations: ['Software Engineer'],
            fieldOfStudy: ['Computer Science'],
          },
        },
      );

      expect(updated.currentVersion.targetingJson).toEqual({
        ageRange: { min: 20, max: 35 },
        locations: ['Hanoi', 'Da Nang'],
        genders: ['FEMALE'],
        occupations: ['Software Engineer'],
        fieldOfStudy: ['Computer Science'],
      });
    });

    it('clears targeting criteria when null is passed', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Targeted Survey',
        targetingJson: {
          locations: ['Hanoi'],
        },
      });

      const updated = await service.updateDraft(
        created.id,
        { userId: publisherId, role: 'PUBLISHER' },
        {
          clientUpdatedAt: created.updatedAt,
          targetingJson: null,
        },
      );

      expect(updated.currentVersion.targetingJson).toBeNull();
    });

    it('preserves targeting criteria when targetingJson is omitted', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Targeted Survey',
        targetingJson: { locations: ['Hanoi'] },
      });

      const updated = await service.updateDraft(
        created.id,
        { userId: publisherId, role: 'PUBLISHER' },
        {
          clientUpdatedAt: created.updatedAt,
          title: 'Renamed Targeted Survey',
        },
      );

      expect(updated.currentVersion.targetingJson).toEqual({
        locations: ['Hanoi'],
      });
    });

    it('throws TargetingValidationException when ageRange.min > ageRange.max', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Invalid Targeting Survey',
      });

      await expect(
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          {
            clientUpdatedAt: created.updatedAt,
            targetingJson: {
              ageRange: { min: 40, max: 20 },
            },
          },
        ),
      ).rejects.toThrow(TargetingValidationException);
    });

    it('throws TargetingValidationException when gender contains invalid value', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Invalid Gender Survey',
      });

      await expect(
        service.updateDraft(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          {
            clientUpdatedAt: created.updatedAt,
            targetingJson: {
              genders: ['INVALID_GENDER' as any],
            },
          },
        ),
      ).rejects.toThrow(TargetingValidationException);
    });
  });

  describe('deleteDraft', () => {
    it('deletes a form in DRAFT status', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Temporary Draft',
      });

      await service.deleteDraft(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        service.getFormById(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormNotFoundException);
    });

    it('rejects deletion if form is not in DRAFT status', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Published Survey',
      });

      const existing = await repository.findById(created.id);
      const publishedForm = existing!.form.copyWith({ status: 'PUBLISHED' });
      await repository.update(publishedForm);

      await expect(
        service.deleteDraft(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormNotInDraftStatusException);
    });

    it('preserves published version history when a newer draft exists', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Versioned Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Versioned Survey',
          blocks: [
            {
              id: 'question-1',
              type: 'text',
              order: 0,
              title: 'Question',
              required: true,
            },
          ],
        },
      });
      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      await service.createNewVersion(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        service.deleteDraft(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormHasPublishedVersionsException);
      expect(await repository.findAllVersions(created.id)).toHaveLength(2);
    });
  });

  describe('publishForm', () => {
    const validBlock: FormBlock = {
      id: 'block-q1',
      type: 'text',
      order: 0,
      title: 'What is your department?',
      required: true,
    };

    it('successfully publishes internal non-reward survey directly to PUBLISHED', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Academic Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Academic Survey',
          blocks: [validBlock],
        },
      });

      const published = await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(published.id).toBe(created.id);
      expect(published.status).toBe('PUBLISHED');
      expect(published.currentVersion.isPublished).toBe(true);
      expect(published.currentVersion.publishedAt).toBeDefined();
    });

    it('successfully publishes survey with rewards to ESCROW_LOCKED', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Incentivized Feedback Survey',
        type: 'INTERNAL',
        rewardPerResponse: 20,
        expectedCompletions: 100,
        schema: {
          schemaVersion: 1,
          title: 'Incentivized Feedback Survey',
          blocks: [validBlock],
        },
      });

      const published = await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(published.status).toBe('ESCROW_LOCKED');
      expect(published.currentVersion.isPublished).toBe(false);
      expect(published.currentVersion.publishedAt).toBeNull();
    });

    it('successfully publishes external survey to ESCROW_LOCKED', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'External Google Form Survey',
        type: 'EXTERNAL',
        rewardPerResponse: 10,
        externalUrl: 'https://forms.google.com/test-survey',
        schema: {
          schemaVersion: 1,
          title: 'External Google Form Survey',
          blocks: [validBlock],
        },
      });

      const published = await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(published.status).toBe('ESCROW_LOCKED');
      expect(published.type).toBe('EXTERNAL');
    });

    it('allows publishing with explicit targetStatus matching lifecycle state machine', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Moderated Survey',
        schema: {
          schemaVersion: 1,
          title: 'Moderated Survey',
          blocks: [validBlock],
        },
      });

      const published = await service.publishForm(
        created.id,
        { userId: publisherId, role: 'PUBLISHER' },
        { targetStatus: 'MODERATION_QUEUE' },
      );

      expect(published.status).toBe('MODERATION_QUEUE');
    });

    it('rejects publishing an empty form draft without question blocks', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Empty Draft',
        schema: {
          schemaVersion: 1,
          title: 'Empty Draft',
          blocks: [], // Empty blocks
        },
      });

      await expect(
        service.publishForm(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormValidationException);
    });

    it('rejects publishing external survey without externalUrl', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Missing URL External Survey',
        type: 'EXTERNAL',
        schema: {
          schemaVersion: 1,
          title: 'Missing URL External Survey',
          blocks: [validBlock],
        },
      });

      await expect(
        service.publishForm(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormValidationException);
    });

    it('rejects publishing when form is not in DRAFT status', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Already Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Already Published Survey',
          blocks: [validBlock],
        },
      });

      // First publish
      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      // Second publish must be rejected
      await expect(
        service.publishForm(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormNotInDraftStatusException);
    });

    it('rejects publishing by non-owner without ADMIN role', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Protected Survey',
        schema: {
          schemaVersion: 1,
          title: 'Protected Survey',
          blocks: [validBlock],
        },
      });

      await expect(
        service.publishForm(created.id, {
          userId: otherUserId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormForbiddenException);
    });
  });

  describe('closeForm', () => {
    const validBlock: FormBlock = {
      id: 'block-q1',
      type: 'text',
      order: 0,
      title: 'Question',
      required: false,
    };

    it('successfully closes a PUBLISHED form', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Active Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Active Survey',
          blocks: [validBlock],
        },
      });

      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      const closed = await service.closeForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(closed.status).toBe('CLOSED');
    });

    it('rejects closing a DRAFT form', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Draft Survey',
      });

      await expect(
        service.closeForm(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(InvalidFormStatusTransitionException);
    });

    it('rejects closing an already CLOSED form', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Active Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Active Survey',
          blocks: [validBlock],
        },
      });

      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await service.closeForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        service.closeForm(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormAlreadyClosedException);
    });
  });

  describe('transitionStatus', () => {
    const validBlock: FormBlock = {
      id: 'block-q1',
      type: 'text',
      order: 0,
      title: 'Question',
      required: false,
    };

    it('allows valid lifecycle transitions from ESCROW_LOCKED to MODERATION_QUEUE to PUBLISHED', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Escrow Survey',
        type: 'INTERNAL',
        rewardPerResponse: 10,
        schema: {
          schemaVersion: 1,
          title: 'Escrow Survey',
          blocks: [validBlock],
        },
      });

      const published = await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      expect(published.status).toBe('ESCROW_LOCKED');

      const inModeration = await service.transitionStatus(
        created.id,
        { userId: adminId, role: 'ADMIN' },
        { targetStatus: 'MODERATION_QUEUE' },
      );
      expect(inModeration.status).toBe('MODERATION_QUEUE');

      const approved = await service.transitionStatus(
        created.id,
        { userId: adminId, role: 'ADMIN' },
        { targetStatus: 'PUBLISHED' },
      );
      expect(approved.status).toBe('PUBLISHED');
      expect(approved.currentVersion.isPublished).toBe(true);
    });

    it('rejects illegal transition from PUBLISHED back to DRAFT', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Survey',
          blocks: [validBlock],
        },
      });

      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        service.transitionStatus(
          created.id,
          { userId: adminId, role: 'ADMIN' },
          { targetStatus: 'DRAFT' },
        ),
      ).rejects.toThrow(InvalidFormStatusTransitionException);
    });

    it('forbids publishers from using the generic transition endpoint', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Survey',
      });

      await expect(
        service.transitionStatus(
          created.id,
          { userId: publisherId, role: 'PUBLISHER' },
          { targetStatus: 'PUBLISHED' },
        ),
      ).rejects.toThrow(FormForbiddenException);
    });
  });

  describe('createNewVersion', () => {
    const validBlock: FormBlock = {
      id: 'block-q1',
      type: 'text',
      order: 0,
      title: 'Initial Question',
      required: true,
    };

    it('creates a new DRAFT version incrementing versionNumber from a PUBLISHED form', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Published Survey',
          blocks: [validBlock],
        },
      });

      const published = await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      expect(published.status).toBe('PUBLISHED');
      expect(published.currentVersion.versionNumber).toBe(1);
      expect(published.currentVersion.isPublished).toBe(true);

      const newVersion = await service.createNewVersion(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(newVersion.status).toBe('DRAFT');
      expect(newVersion.currentVersion.versionNumber).toBe(2);
      expect(newVersion.currentVersion.isPublished).toBe(false);
      expect(newVersion.currentVersion.schemaJson.blocks).toEqual([validBlock]);

      // Verify the previous version (v1) remains published and intact
      const versions = await service.listVersions(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      expect(versions).toHaveLength(2);
      expect(versions[0].versionNumber).toBe(1);
      expect(versions[0].isPublished).toBe(true);
      expect(versions[1].versionNumber).toBe(2);
      expect(versions[1].isPublished).toBe(false);
    });

    it('allows ADMIN to create a new version', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Published Survey',
          blocks: [validBlock],
        },
      });

      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      const newVersion = await service.createNewVersion(created.id, {
        userId: adminId,
        role: 'ADMIN',
      });

      expect(newVersion.status).toBe('DRAFT');
      expect(newVersion.currentVersion.versionNumber).toBe(2);
    });

    it('allows only one concurrent new-version request to win', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Published Survey',
          blocks: [validBlock],
        },
      });
      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      const results = await Promise.allSettled([
        service.createNewVersion(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
        service.createNewVersion(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ]);

      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
      expect(await repository.findAllVersions(created.id)).toHaveLength(2);
    });

    it('throws FormForbiddenException if caller is not owner or admin', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Published Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Published Survey',
          blocks: [validBlock],
        },
      });

      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        service.createNewVersion(created.id, {
          userId: otherUserId,
          role: 'RESPONDENT',
        }),
      ).rejects.toThrow(FormForbiddenException);
    });

    it('throws FormNotPublishedException if form is not in PUBLISHED status', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Draft Survey',
      });

      await expect(
        service.createNewVersion(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormNotPublishedException);
    });

    it('throws FormNotFoundException if form does not exist', async () => {
      await expect(
        service.createNewVersion('00000000-0000-4000-8000-000000000000', {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormNotFoundException);
    });
  });

  describe('listVersions', () => {
    it('returns all versions ordered ascending', async () => {
      const validBlock: FormBlock = {
        id: 'block-q1',
        type: 'text',
        order: 0,
        title: 'Initial Question',
        required: true,
      };

      const created = await service.createDraft(publisherId, {
        title: 'Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Survey',
          blocks: [validBlock],
        },
      });

      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await service.createNewVersion(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      const versions = await service.listVersions(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(versions).toHaveLength(2);
      expect(versions[0].versionNumber).toBe(1);
      expect(versions[1].versionNumber).toBe(2);
    });

    it('throws FormForbiddenException if unauthorized user requests versions', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Survey',
      });

      await expect(
        service.listVersions(created.id, {
          userId: otherUserId,
          role: 'RESPONDENT',
        }),
      ).rejects.toThrow(FormForbiddenException);
    });

    it('throws FormNotFoundException if form does not exist', async () => {
      await expect(
        service.listVersions('00000000-0000-4000-8000-000000000000', {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormNotFoundException);
    });
  });

  describe('createExternalSurvey (Story 4.5)', () => {
    it('creates external survey with valid HTTPS Google Form URL and generates 6-digit completion code', async () => {
      const result = await service.createExternalSurvey(publisherId, {
        title: 'Developer Ergonomics Study',
        description: 'Google Forms user experience survey',
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        rewardPerResponse: 20,
        expectedCompletions: 100,
        autoPublish: false,
      });

      expect(result.id).toBeDefined();
      expect(result.type).toBe('EXTERNAL');
      expect(result.title).toBe('Developer Ergonomics Study');
      expect(result.status).toBe('DRAFT');
      expect(result.rewardPerResponse).toBe(20);
      expect(result.expectedCompletions).toBe(100);

      // Verify 6-digit plaintext code returned exactly once in creation response
      expect(result.plaintextCompletionCode).toMatch(/^\d{6}$/);
      expect(result.hasCompletionCode).toBe(true);
      expect(result.currentVersion.externalUrl).toBe(
        'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
      );
      expect(result.currentVersion.completionCode).toBeNull();
      expect(result.currentVersion.hasCompletionCode).toBe(true);

      // Verify stored repository version contains keyed HMAC verifier, NOT plaintext
      const stored = await repository.findById(result.id);
      expect(stored).not.toBeNull();
      const rawStoredCode = stored!.currentVersion.completionCode;
      expect(rawStoredCode).not.toBeNull();
      expect(rawStoredCode).toMatch(/^v1:[a-f0-9]{64}$/);
      expect(rawStoredCode).not.toContain(result.plaintextCompletionCode);

      // Verify HMAC verifier validates using completionCodeService
      const isValid = completionCodeService.verifyCode(
        result.currentVersion.id,
        result.plaintextCompletionCode,
        rawStoredCode,
      );
      expect(isValid).toBe(true);

      // Verify incorrect candidate fails verification
      const isInvalid = completionCodeService.verifyCode(
        result.currentVersion.id,
        '000000',
        rawStoredCode,
      );
      expect(isInvalid).toBe(false);
    });

    it('sanitizes completionCode in subsequent getFormById query (never discloses hash or plaintext)', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Quick Feedback',
        externalUrl: 'https://forms.gle/shortLink1',
      });

      const fetched = await service.getFormById(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(fetched.id).toBe(created.id);
      expect(fetched.type).toBe('EXTERNAL');
      expect(fetched.currentVersion.completionCode).toBeNull();
      expect(fetched.currentVersion.hasCompletionCode).toBe(true);
      expect((fetched as any).plaintextCompletionCode).toBeUndefined();
    });

    it('rejects creation with non-HTTPS external survey URL', async () => {
      await expect(
        service.createExternalSurvey(publisherId, {
          title: 'Insecure URL Form',
          externalUrl: 'http://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        }),
      ).rejects.toThrow();
    });
  });

  describe('rotateCompletionCode (Story 4.5)', () => {
    it('rotates completion code, creating a new immutable FormVersion and preserving prior verifier', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Rotatable External Form',
        externalUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSc/viewform',
        autoPublish: false,
      });

      const initialCode = created.plaintextCompletionCode;
      const initialVersionId = created.currentVersion.id;

      const storedV1 = await repository.findById(created.id);
      const v1Verifier = storedV1!.currentVersion.completionCode;

      // Rotate completion code
      const rotated = await service.rotateCompletionCode(
        created.id,
        {
          userId: publisherId,
          role: 'PUBLISHER',
        },
        { reason: 'Suspected code leak on public forum' },
      );

      expect(rotated.id).toBe(created.id);
      expect(rotated.currentVersion.versionNumber).toBe(2);
      expect(rotated.currentVersion.id).not.toBe(initialVersionId);
      expect(rotated.plaintextCompletionCode).toMatch(/^\d{6}$/);
      expect(rotated.hasCompletionCode).toBe(true);
      expect(rotated.currentVersion.completionCode).toBeNull();

      // Retrieve form with all versions from repository
      const stored = await repository.findById(created.id);
      expect(stored).not.toBeNull();
      expect(stored!.versions).toBeDefined();
      expect(stored!.versions!.length).toBe(2);

      const v1Stored = stored!.versions!.find((v) => v.versionNumber === 1);
      const v2Stored = stored!.versions!.find((v) => v.versionNumber === 2);

      expect(v1Stored).toBeDefined();
      expect(v2Stored).toBeDefined();

      // AC6: Immutability check - V1 verifier is preserved exactly as it was
      expect(v1Stored!.completionCode).toBe(v1Verifier);
      expect(v2Stored!.completionCode).toMatch(/^v1:[a-f0-9]{64}$/);
      expect(v2Stored!.completionCode).not.toBe(v1Stored!.completionCode);

      // Verify V1 code validates only against V1 version ID
      expect(
        completionCodeService.verifyCode(
          v1Stored!.id,
          initialCode,
          v1Stored!.completionCode,
        ),
      ).toBe(true);

      // Verify V2 code validates only against V2 version ID
      expect(
        completionCodeService.verifyCode(
          v2Stored!.id,
          rotated.plaintextCompletionCode,
          v2Stored!.completionCode,
        ),
      ).toBe(true);

      // Cross-verification fails
      expect(
        completionCodeService.verifyCode(
          v2Stored!.id,
          initialCode,
          v2Stored!.completionCode,
        ),
      ).toBe(false);
    });

    it('throws FormForbiddenException if non-owner attempts to rotate code', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Owner-only Survey',
        externalUrl: 'https://forms.gle/xyz',
      });

      await expect(
        service.rotateCompletionCode(created.id, {
          userId: otherUserId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormForbiddenException);
    });

    it('throws FormValidationException if attempting to rotate code on non-external survey', async () => {
      const internalDraft = await service.createDraft(publisherId, {
        title: 'Internal Native Survey',
        type: 'INTERNAL',
      });

      await expect(
        service.rotateCompletionCode(internalDraft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormValidationException);
    });

    it('throws FormAlreadyClosedException if attempting to rotate code on closed survey', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Closing External Survey',
        externalUrl: 'https://forms.gle/xyz',
        autoPublish: true,
      });

      // Close the form
      await service.closeForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        service.rotateCompletionCode(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormAlreadyClosedException);
    });
  });
});
