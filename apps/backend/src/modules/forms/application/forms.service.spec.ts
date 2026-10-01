import { randomUUID } from 'crypto';
import { FormsService } from './forms.service';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { CompletionCodeService } from '../infrastructure/completion-code.service';
import type { EnvService } from '../../../common/config/env.service';
import { FormsEscrowCoordinator } from './forms-escrow.coordinator';
import { FormModerationCommands } from './form-moderation.commands';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../../economy/application/ledger.service';
import { InsufficientEscrowBalanceException } from '../../economy/application/exceptions/economy.exceptions';
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
  FormInModerationException,
  FormPublishedFieldsImmutableException,
  TargetingValidationException,
  FormModerationRequiredException,
  FormNotReopenableException,
  ModerationEscrowNotFundedException,
  PricingRewardOutOfBandException,
  IdempotencyKeyConflictException,
} from './exceptions/form.exceptions';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { FormBlock } from '@rescom/schemas';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';

const TEST_COMPLETION_CODE_ENV = {
  completionCodeHmacSecret: 'unit_test_completion_code_hmac_secret_0123456789',
} as EnvService;

describe('FormsService', () => {
  let service: FormsService;
  let repository: InMemoryFormRepository;
  let completionCodeService: CompletionCodeService;

  const publisherId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '22222222-2222-4222-8222-222222222222';
  const adminId = '99999999-9999-4999-8999-999999999999';

  beforeEach(() => {
    repository = new InMemoryFormRepository();
    completionCodeService = new CompletionCodeService(TEST_COMPLETION_CODE_ENV);
    service = new FormsService(repository, completionCodeService);
  });

  /**
   * Story 8.1: publishing only queues a survey; an Admin approval (Research
   * command used by the Moderation coordinator) makes it PUBLISHED.
   */
  async function approveQueued(
    formId: string,
    repo: InMemoryFormRepository = repository,
  ) {
    const snapshot = await repo.findById(formId);
    const approved = await new FormModerationCommands(repo).approvePublication(
      snapshot!,
      new Date(),
    );
    if (!approved) throw new Error(`Form ${formId} could not be approved`);
    return approved;
  }

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
      await approveQueued(created.id);
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

    it('queues a free internal survey for moderation instead of publishing it (Story 8.1)', async () => {
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
      expect(published.status).toBe('MODERATION_QUEUE');
      expect(published.currentVersion.isPublished).toBe(false);
      expect(published.currentVersion.publishedAt).toBeNull();

      const approved = await approveQueued(created.id);
      expect(approved.form.status).toBe('PUBLISHED');
      expect(approved.currentVersion.isPublished).toBe(true);
      expect(approved.currentVersion.publishedAt).toBeInstanceOf(Date);
    });

    it('queues a rewarded survey for moderation (Story 8.1)', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Incentivized Feedback Survey',
        type: 'INTERNAL',
        rewardPerResponse: 20,
        estimatedDurationMinutes: 8,
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

      expect(published.status).toBe('MODERATION_QUEUE');
      expect(published.currentVersion.isPublished).toBe(false);
      expect(published.currentVersion.publishedAt).toBeNull();
    });

    it('queues an external survey (no question blocks) for moderation and keeps its verifier (Story 8.1, review P1)', async () => {
      // External surveys never carry RESCOM blocks; the standard publish path
      // must not require them.
      const created = await service.createExternalSurvey(publisherId, {
        title: 'External Google Form Survey',
        rewardPerResponse: 10,
        estimatedDurationMinutes: 8,
        externalUrl: 'https://docs.google.com/forms/d/e/abc/viewform',
        autoPublish: false,
      });
      const storedVerifier = (await repository.findById(created.id))!
        .currentVersion.completionCode;
      expect(created.currentVersion.schemaJson.blocks).toEqual([]);

      const published = await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(published.status).toBe('MODERATION_QUEUE');
      expect(published.type).toBe('EXTERNAL');
      expect(published.currentVersion.isPublished).toBe(false);
      const stored = await repository.findById(created.id);
      expect(stored!.currentVersion.completionCode).toBe(storedVerifier);
      expect(
        completionCodeService.verifyCode(
          stored!.currentVersion.id,
          created.plaintextCompletionCode,
          stored!.currentVersion.completionCode,
        ),
      ).toBe(true);
    });

    it('refuses to publish an External version without a completion code instead of minting an invisible one (review P2)', async () => {
      const draft = await service.createDraft(publisherId, {
        title: 'External draft',
        type: 'EXTERNAL',
        rewardPerResponse: 10,
        estimatedDurationMinutes: 8,
        externalUrl: 'https://forms.gle/abc',
      });

      const error = await service
        .publishForm(draft.id, { userId: publisherId, role: 'PUBLISHER' })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FormValidationException);
      expect((error as FormValidationException).code).toBe(
        'EXTERNAL_COMPLETION_CODE_REQUIRED',
      );
      const unchanged = await repository.findById(draft.id);
      expect(unchanged!.form.status).toBe('DRAFT');
      expect(unchanged!.currentVersion.completionCode).toBeNull();

      // Recovery path: rotating discloses the plaintext once, then publish.
      const rotated = await service.rotateCompletionCode(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      const published = await service.publishForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      expect(published.status).toBe('MODERATION_QUEUE');
      const stored = await repository.findById(draft.id);
      expect(
        completionCodeService.verifyCode(
          stored!.currentVersion.id,
          rotated.plaintextCompletionCode,
          stored!.currentVersion.completionCode,
        ),
      ).toBe(true);
    });

    it('re-publishes a new version of a live External survey after rotating its code (review P1/P2)', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Live External',
        rewardPerResponse: 0 + 5,
        estimatedDurationMinutes: 3,
        externalUrl: 'https://forms.gle/live',
        autoPublish: true,
      });
      await approveQueued(created.id);

      const newVersion = await service.createNewVersion(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      expect(newVersion.status).toBe('DRAFT');
      expect(newVersion.currentVersion.hasCompletionCode).toBe(false);

      await expect(
        service.publishForm(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toMatchObject({ code: 'EXTERNAL_COMPLETION_CODE_REQUIRED' });

      await service.rotateCompletionCode(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      const republished = await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      expect(republished.status).toBe('MODERATION_QUEUE');
      expect(republished.currentVersion.versionNumber).toBe(3);
      expect(republished.currentVersion.externalUrl).toBe(
        'https://forms.gle/live',
      );
    });

    it('rejects publishing an External survey whose stored URL is not HTTPS (review P6)', async () => {
      const now = new Date();
      const formId = '44444444-4444-4444-8444-444444444444';
      await repository.create(
        new FormEntity(
          formId,
          publisherId,
          'EXTERNAL',
          'DRAFT',
          'Legacy http survey',
          null,
          10,
          5,
          now,
          now,
        ),
        new FormVersionEntity(
          '55555555-5555-4555-8555-555555555555',
          formId,
          1,
          {
            schemaVersion: 1,
            title: 'Legacy http survey',
            blocks: [],
            settings: {
              shuffleBlocks: false,
              progressBar: false,
              requireAuth: false,
              allowPublicAccess: true,
              submitButtonText: 'Submit',
            },
            metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
          },
          null,
          false,
          'http://forms.gle/legacy',
          'v1:' + 'a'.repeat(64),
          null,
          now,
        ),
      );

      await expect(
        service.publishForm(formId, { userId: publisherId, role: 'PUBLISHER' }),
      ).rejects.toThrow(/HTTPS/);
      await expect(
        service.publishForm(
          formId,
          { userId: publisherId, role: 'PUBLISHER' },
          { externalUrl: 'javascript:alert(1)' },
        ),
      ).rejects.toThrow();
      // Decision E4-DN3: a (legacy) non-Google-Forms host never goes live.
      await expect(
        service.publishForm(
          formId,
          { userId: publisherId, role: 'PUBLISHER' },
          { externalUrl: 'https://www.surveymonkey.com/r/legacy' },
        ),
      ).rejects.toThrow(/Google Forms/);
      expect((await repository.findById(formId))!.form.status).toBe('DRAFT');
    });

    it.each(['PUBLISHED', 'ESCROW_LOCKED', 'CLOSED'] as const)(
      'rejects a publisher-requested targetStatus %s that would bypass moderation',
      async (targetStatus) => {
        const created = await service.createDraft(publisherId, {
          title: 'Bypass Attempt',
          rewardPerResponse: 0,
          schema: {
            schemaVersion: 1,
            title: 'Bypass Attempt',
            blocks: [validBlock],
          },
        });

        await expect(
          service.publishForm(
            created.id,
            { userId: publisherId, role: 'PUBLISHER' },
            { targetStatus },
          ),
        ).rejects.toThrow(InvalidFormStatusTransitionException);
        expect((await repository.findById(created.id))!.form.status).toBe(
          'DRAFT',
        );
      },
    );

    it('allows publishing with explicit targetStatus matching lifecycle state machine', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Moderated Survey',
        estimatedDurationMinutes: 8,
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
      await approveQueued(created.id);

      const closed = await service.closeForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(closed.status).toBe('CLOSED');
    });

    it('lets the publisher withdraw a queued survey (MODERATION_QUEUE -> CLOSED)', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Queued Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Queued Survey',
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
      expect(closed.currentVersion.isPublished).toBe(false);
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

    async function seedLegacyEscrowLocked(): Promise<string> {
      const now = new Date();
      const form = new FormEntity(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        publisherId,
        'INTERNAL',
        'ESCROW_LOCKED',
        'Legacy Escrow Survey',
        null,
        10,
        50,
        now,
        now,
      );
      const version = new FormVersionEntity(
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        form.id,
        1,
        {
          schemaVersion: 1,
          title: 'Legacy Escrow Survey',
          blocks: [validBlock],
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
      );
      await repository.create(form, version);
      return form.id;
    }

    it('lets an Admin move a legacy ESCROW_LOCKED form into the moderation queue', async () => {
      const formId = await seedLegacyEscrowLocked();

      const inModeration = await service.transitionStatus(
        formId,
        { userId: adminId, role: 'ADMIN' },
        { targetStatus: 'MODERATION_QUEUE' },
      );

      expect(inModeration.status).toBe('MODERATION_QUEUE');
      expect(inModeration.currentVersion.isPublished).toBe(false);
    });

    it('refuses to move a queued survey out of the queue (moderation required)', async () => {
      const created = await service.createDraft(publisherId, {
        title: 'Queued Survey',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Queued Survey',
          blocks: [validBlock],
        },
      });
      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      for (const targetStatus of ['PUBLISHED', 'CLOSED'] as const) {
        await expect(
          service.transitionStatus(
            created.id,
            { userId: adminId, role: 'ADMIN' },
            { targetStatus },
          ),
        ).rejects.toThrow(FormModerationRequiredException);
      }
      expect((await repository.findById(created.id))!.form.status).toBe(
        'MODERATION_QUEUE',
      );
    });

    it('refuses ESCROW_LOCKED -> PUBLISHED (moderation bypass)', async () => {
      const formId = await seedLegacyEscrowLocked();

      await expect(
        service.transitionStatus(
          formId,
          { userId: adminId, role: 'ADMIN' },
          { targetStatus: 'PUBLISHED' },
        ),
      ).rejects.toThrow(InvalidFormStatusTransitionException);
    });

    it('closes through the refunding close path', async () => {
      const formId = await seedLegacyEscrowLocked();
      const closeSpy = jest.spyOn(service, 'closeForm');

      const closed = await service.transitionStatus(
        formId,
        { userId: adminId, role: 'ADMIN' },
        { targetStatus: 'CLOSED' },
      );

      expect(closed.status).toBe('CLOSED');
      expect(closeSpy).toHaveBeenCalledWith(formId, {
        userId: adminId,
        role: 'ADMIN',
      });
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
      await approveQueued(created.id);

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

      await service.publishForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      const published = await approveQueued(created.id);
      expect(published.form.status).toBe('PUBLISHED');
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
      await approveQueued(created.id);

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
      await approveQueued(created.id);

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
      await approveQueued(created.id);

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
        estimatedDurationMinutes: 8,
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

    it('keeps the original publishedAt so rotation cannot re-promote the survey (review P16)', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Published External',
        estimatedDurationMinutes: 8,
        externalUrl: 'https://forms.gle/pub',
        autoPublish: true,
      });
      const approved = await approveQueued(created.id);
      const originalPublishedAt = approved.currentVersion.publishedAt;
      expect(originalPublishedAt).toBeInstanceOf(Date);

      const rotated = await service.rotateCompletionCode(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(rotated.status).toBe('PUBLISHED');
      expect(rotated.currentVersion.isPublished).toBe(true);
      expect(rotated.currentVersion.publishedAt).toBe(
        originalPublishedAt!.toISOString(),
      );
    });

    it('rotating a DRAFT re-publication keeps the pending edits (review P4)', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Editable External',
        estimatedDurationMinutes: 8,
        externalUrl: 'https://forms.gle/original',
        autoPublish: true,
      });
      await approveQueued(created.id);
      const draft = await service.createNewVersion(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      const edited = await service.updateDraft(
        created.id,
        { userId: publisherId, role: 'PUBLISHER' },
        {
          clientUpdatedAt: draft.updatedAt,
          externalUrl: 'https://forms.gle/edited',
          targetingJson: { locations: ['Hà Nội'] },
        },
      );

      const rotated = await service.rotateCompletionCode(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(rotated.status).toBe('DRAFT');
      expect(rotated.currentVersion.versionNumber).toBe(
        edited.currentVersion.versionNumber + 1,
      );
      expect(rotated.currentVersion.externalUrl).toBe(
        'https://forms.gle/edited',
      );
      expect(rotated.currentVersion.targetingJson).toEqual({
        locations: ['Hà Nội'],
      });
    });

    it('does not revert a concurrent close: rotation loses the race with 409/closed (review P5)', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Racing External',
        estimatedDurationMinutes: 8,
        externalUrl: 'https://forms.gle/race',
        autoPublish: true,
      });
      await approveQueued(created.id);
      const snapshot = await repository.findById(created.id);

      // The survey is closed (and refunded) between rotation's read and write.
      await service.closeForm(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      jest.spyOn(repository, 'findById').mockResolvedValueOnce(snapshot);

      await expect(
        service.rotateCompletionCode(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormAlreadyClosedException);

      const stored = await repository.findById(created.id);
      expect(stored!.form.status).toBe('CLOSED');
      expect(stored!.versions).toHaveLength(1);
    });

    it('returns 409 when the status changed (not closed) between read and rotation (review P5)', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Live External',
        estimatedDurationMinutes: 8,
        externalUrl: 'https://forms.gle/live',
        autoPublish: true,
      });
      await approveQueued(created.id);
      const publishedSnapshot = await repository.findById(created.id);
      // A new version moves the survey back to DRAFT between rotation's read
      // and write.
      await service.createNewVersion(created.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      jest
        .spyOn(repository, 'findById')
        .mockResolvedValueOnce(publishedSnapshot);

      await expect(
        service.rotateCompletionCode(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormConflictException);
      expect((await repository.findById(created.id))!.form.status).toBe(
        'DRAFT',
      );
    });

    it('refuses to rotate while the survey waits in the moderation queue (Bug 3.4)', async () => {
      const created = await service.createExternalSurvey(publisherId, {
        title: 'Queued External',
        estimatedDurationMinutes: 8,
        externalUrl: 'https://forms.gle/queued',
        autoPublish: true,
      });
      expect(created.status).toBe('MODERATION_QUEUE');

      await expect(
        service.rotateCompletionCode(created.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).rejects.toThrow(FormInModerationException);

      // The queued version, which the Admin decision is pinned to, is intact.
      const stored = await repository.findById(created.id);
      expect(stored!.form.status).toBe('MODERATION_QUEUE');
      expect(stored!.versions).toHaveLength(1);
      expect(stored!.currentVersion.id).toBe(created.currentVersion.id);
    });

    it('still rotates a DRAFT and a PUBLISHED survey (Bug 3.4)', async () => {
      const draft = await service.createExternalSurvey(publisherId, {
        title: 'Draft External',
        externalUrl: 'https://forms.gle/draft',
        autoPublish: false,
      });
      await expect(
        service.rotateCompletionCode(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).resolves.toMatchObject({ status: 'DRAFT', currentVersionNumber: 2 });

      const live = await service.createExternalSurvey(publisherId, {
        title: 'Live External',
        estimatedDurationMinutes: 8,
        externalUrl: 'https://forms.gle/live',
        autoPublish: true,
      });
      await approveQueued(live.id);
      await expect(
        service.rotateCompletionCode(live.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        }),
      ).resolves.toMatchObject({
        status: 'PUBLISHED',
        currentVersionNumber: 2,
      });
    });
  });

  describe('createExternalSurvey estimated completion time (review P9)', () => {
    it('stores the publisher estimate as the expected effort and keeps the barrier invariant', async () => {
      const long = await service.createExternalSurvey(publisherId, {
        title: 'Thirty minute form',
        externalUrl: 'https://forms.gle/long',
        expectedEffortSeconds: 1800,
      });
      expect(long.currentVersion.schemaJson.metadata).toEqual({
        expectedEffortSeconds: 1800,
        minTimeBarrierSeconds: 15,
      });

      const short = await service.createExternalSurvey(publisherId, {
        title: 'Ten second form',
        externalUrl: 'https://forms.gle/short',
        expectedEffortSeconds: 10,
      });
      expect(short.currentVersion.schemaJson.metadata).toEqual({
        expectedEffortSeconds: 10,
        minTimeBarrierSeconds: 10,
      });
    });
  });

  describe('Story 6.3: Escrow Integration in FormsService (FR-15, FR-19, FR-32, FR-33)', () => {
    let escrowLedgerRepo: InMemoryLedgerRepository;
    let escrowLedgerService: LedgerService;
    let escrowCoordinator: FormsEscrowCoordinator;
    let escrowFormsService: FormsService;
    let escrowUnitOfWork: PassThroughUnitOfWork;

    /** `count` completions whose rewards are still owed (Epic 6 review P4). */
    function owedInternal(count: number) {
      return {
        completedCount: count,
        internalResponses: Array.from({ length: count }, () => ({
          id: randomUUID(),
          rewardable: true,
        })),
        externalAttemptIds: [],
      };
    }

    const validBlock: FormBlock = {
      id: 'block-escrow-1',
      type: 'text',
      title: 'What is your favorite topic?',
      order: 0,
      required: true,
    };

    beforeEach(async () => {
      escrowLedgerRepo = new InMemoryLedgerRepository();
      escrowLedgerService = new LedgerService(escrowLedgerRepo);
      escrowCoordinator = new FormsEscrowCoordinator(
        repository,
        escrowLedgerService,
      );
      escrowUnitOfWork = new PassThroughUnitOfWork();
      escrowFormsService = new FormsService(
        repository,
        completionCodeService,
        escrowCoordinator,
        escrowUnitOfWork,
      );

      // Seed publisher with 1000 points
      const system = await escrowLedgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const pubAvail = await escrowLedgerService.getOrCreateAccount(
        publisherId,
        'USER_AVAILABLE',
      );
      await escrowLedgerService.transfer({
        fromAccountId: system.id,
        toAccountId: pubAvail.id,
        amount: 1000,
        idempotencyKey: 'seed-forms-service-escrow-1000',
      });
    });

    it('locks escrow funds with 20% discount when publishing internal survey', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Discounted Research',
        type: 'INTERNAL',
        rewardPerResponse: 10,
        estimatedDurationMinutes: 8,
        expectedCompletions: 50, // 50 * 8 = 400
        schema: {
          schemaVersion: 1,
          title: 'Discounted Research',
          blocks: [validBlock],
        },
      });

      const published = await escrowFormsService.publishForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(published.status).toBe('MODERATION_QUEUE');
      expect(escrowUnitOfWork.keys).toEqual([
        `publish:${published.currentVersion.id}`,
      ]);

      const wallet = await escrowLedgerService.getWallet(publisherId);
      expect(wallet.balance.available).toBe(600);
      expect(wallet.balance.escrow).toBe(400);
    });

    it('blocks publishing and throws InsufficientEscrowBalanceException when points are lacking', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Overbudget Survey',
        type: 'EXTERNAL',
        rewardPerResponse: 20,
        estimatedDurationMinutes: 8,
        expectedCompletions: 100, // 2000 points required > 1000 available
        schema: {
          schemaVersion: 1,
          title: 'Overbudget Survey',
          blocks: [validBlock],
        },
      });
      // An External version needs a completion code before it can publish.
      await escrowFormsService.rotateCompletionCode(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        escrowFormsService.publishForm(
          draft.id,
          {
            userId: publisherId,
            role: 'PUBLISHER',
          },
          {
            externalUrl: 'https://docs.google.com/forms/d/123/viewform',
          },
        ),
      ).rejects.toThrow(InsufficientEscrowBalanceException);

      // Form remains in DRAFT
      const current = await escrowFormsService.getFormById(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      expect(current.status).toBe('DRAFT');
    });

    it('refunds remaining unused points on closeForm', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Refundable Survey',
        type: 'INTERNAL',
        rewardPerResponse: 10, // 8 effective
        estimatedDurationMinutes: 8,
        expectedCompletions: 100, // 800 locked
        schema: {
          schemaVersion: 1,
          title: 'Refundable Survey',
          blocks: [validBlock],
        },
      });

      await escrowFormsService.publishForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      await approveQueued(draft.id);

      // 70 completed whose rewards are still owed, 30 unused -> 30 * 8 = 240
      // refund (the 70 x 8 owed stays in Escrow, Epic 6 review P4).
      repository.setRewardableCompletions(draft.id, owedInternal(70));

      const closed = await escrowFormsService.closeForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(closed.status).toBe('CLOSED');

      const wallet = await escrowLedgerService.getWallet(publisherId);
      expect(wallet.balance.escrow).toBe(560);
      expect(wallet.balance.available).toBe(440); // 200 + 240
    });

    it('reopens closed survey with additional quota and locks additional escrow (FR-33)', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Reopenable Survey',
        type: 'INTERNAL',
        rewardPerResponse: 10, // 8 effective
        estimatedDurationMinutes: 8,
        expectedCompletions: 50,
        schema: {
          schemaVersion: 1,
          title: 'Reopenable Survey',
          blocks: [validBlock],
        },
      });

      await escrowFormsService.publishForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      await approveQueued(draft.id);

      // All 50 completed (rewards owed)
      repository.setRewardableCompletions(draft.id, owedInternal(50));

      await escrowFormsService.closeForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      // Reopen with 25 additional completions -> 25 * 8 = 200 points
      const reopened = await escrowFormsService.reopenForm(
        draft.id,
        { userId: publisherId, role: 'PUBLISHER' },
        { additionalCompletions: 25 },
      );

      expect(reopened.status).toBe('PUBLISHED');
      expect(reopened.expectedCompletions).toBe(75); // 50 + 25

      const wallet = await escrowLedgerService.getWallet(publisherId);
      expect(wallet.balance.available).toBe(400); // 600 - 200
      expect(wallet.balance.escrow).toBe(600); // 400 + 200
    });

    it('gives every close/reopen cycle its own refund and reopen journal (Epic 6 review P3)', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Cycling Survey',
        type: 'INTERNAL',
        rewardPerResponse: 10, // 8 effective
        estimatedDurationMinutes: 8,
        expectedCompletions: 50, // 400 locked
        schema: { schemaVersion: 1, title: 'Cycling', blocks: [validBlock] },
      });
      await escrowFormsService.publishForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      await approveQueued(draft.id);
      const owner = { userId: publisherId, role: 'PUBLISHER' };
      escrowUnitOfWork.keys.length = 0;

      await escrowFormsService.closeForm(draft.id, owner); // refunds 400
      await escrowFormsService.reopenForm(draft.id, owner, {
        additionalCompletions: 10,
      }); // locks 80
      await escrowFormsService.closeForm(draft.id, owner); // refunds 80
      await escrowFormsService.reopenForm(draft.id, owner, {
        additionalCompletions: 5,
      }); // locks 40
      const closed = await escrowFormsService.closeForm(draft.id, owner); // refunds 40

      expect(escrowUnitOfWork.keys).toEqual([
        `close-refund:${draft.id}:c1`,
        `reopen-escrow:${draft.id}:c1`,
        `close-refund:${draft.id}:c2`,
        `reopen-escrow:${draft.id}:c2`,
        `close-refund:${draft.id}:c3`,
      ]);
      expect(closed.expectedCompletions).toBe(65);
      expect((await repository.findById(draft.id))!.form.closeCount).toBe(3);
      for (const key of [
        `close-refund:${draft.id}:c2`,
        `reopen-escrow:${draft.id}:c2`,
        `close-refund:${draft.id}:c3`,
      ]) {
        expect(
          await escrowLedgerService.findJournalByIdempotencyKey(key),
        ).not.toBeNull();
      }
      const wallet = await escrowLedgerService.getWallet(publisherId);
      expect(wallet.balance.escrow).toBe(0);
      expect(wallet.balance.available).toBe(1000);
    });

    it('lets only the owner reopen, never an Admin spending the Publisher points (Epic 6 review P13)', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Owner Only Reopen',
        type: 'INTERNAL',
        rewardPerResponse: 10,
        estimatedDurationMinutes: 8,
        expectedCompletions: 10,
        schema: { schemaVersion: 1, title: 'Owner', blocks: [validBlock] },
      });
      await escrowFormsService.publishForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      await approveQueued(draft.id);
      await escrowFormsService.closeForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      const before = await escrowLedgerService.getWallet(publisherId);

      await expect(
        escrowFormsService.reopenForm(
          draft.id,
          { userId: '99999999-9999-4999-8999-999999999999', role: 'ADMIN' },
          { additionalCompletions: 10 },
        ),
      ).rejects.toThrow(FormForbiddenException);

      const after = await escrowLedgerService.getWallet(publisherId);
      expect(after.balance.available).toBe(before.balance.available);
    });

    it('rejects a reopen above the 100,000-completion cap before any ledger movement (Epic 6 review P12)', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Capped Reopen',
        type: 'INTERNAL',
        rewardPerResponse: 0, // free: no Escrow involved
        expectedCompletions: 90_000,
        schema: { schemaVersion: 1, title: 'Capped', blocks: [validBlock] },
      });
      await escrowFormsService.publishForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });
      await approveQueued(draft.id);
      await escrowFormsService.closeForm(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      await expect(
        escrowFormsService.reopenForm(
          draft.id,
          { userId: publisherId, role: 'PUBLISHER' },
          { additionalCompletions: 20_000 },
        ),
      ).rejects.toThrow(FormValidationException);
      expect((await repository.findById(draft.id))!.form.status).toBe('CLOSED');
    });

    describe('Decision E8-D1: Admin takedowns are final (closeKind)', () => {
      async function liveSurvey(title: string, owner = publisherId) {
        const draft = await escrowFormsService.createDraft(owner, {
          title,
          type: 'INTERNAL',
          rewardPerResponse: 0, // free: the Escrow is not under test here
          expectedCompletions: 10,
          schema: { schemaVersion: 1, title, blocks: [validBlock] },
        });
        await escrowFormsService.publishForm(draft.id, {
          userId: owner,
          role: owner === adminId ? 'ADMIN' : 'PUBLISHER',
        });
        await approveQueued(draft.id);
        return draft;
      }
      const reopenAsOwner = (formId: string, owner = publisherId) =>
        escrowFormsService.reopenForm(
          formId,
          { userId: owner, role: owner === adminId ? 'ADMIN' : 'PUBLISHER' },
          { additionalCompletions: 5 },
        );

      it("records the owner's close as OWNER and lets the owner reopen it", async () => {
        const draft = await liveSurvey('Owner Close');

        const closed = await escrowFormsService.closeForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });
        expect(closed.closeKind).toBe('OWNER');

        const reopened = await reopenAsOwner(draft.id);
        expect(reopened.status).toBe('PUBLISHED');
        expect(reopened.expectedCompletions).toBe(15);
      });

      it("records an Admin takedown of someone else's survey as ADMIN and refuses the owner's reopen (409)", async () => {
        const draft = await liveSurvey('Taken Down');
        const closed = await escrowFormsService.closeForm(draft.id, {
          userId: adminId,
          role: 'ADMIN',
        });
        expect(closed.closeKind).toBe('ADMIN');
        const before = await escrowLedgerService.getWallet(publisherId);

        const error = await reopenAsOwner(draft.id).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(FormNotReopenableException);
        expect(error).toMatchObject({
          code: 'FORM_NOT_REOPENABLE',
          reason: 'CLOSED_BY_ADMIN_OR_MODERATION',
          closeKind: 'ADMIN',
        });
        const stored = (await repository.findById(draft.id))!.form;
        expect(stored.status).toBe('CLOSED');
        expect(stored.expectedCompletions).toBe(10);
        const after = await escrowLedgerService.getWallet(publisherId);
        expect(after.balance).toEqual(before.balance);
      });

      it('treats a generic /status close by an Admin as a takedown too', async () => {
        const draft = await liveSurvey('Status Takedown');
        const closed = await escrowFormsService.transitionStatus(
          draft.id,
          { userId: adminId, role: 'ADMIN' },
          { targetStatus: 'CLOSED' },
        );
        expect(closed.closeKind).toBe('ADMIN');

        await expect(reopenAsOwner(draft.id)).rejects.toThrow(
          FormNotReopenableException,
        );
      });

      it('lets an Admin who owns the survey reopen after closing it (owner close)', async () => {
        const draft = await liveSurvey('Admin Owned', adminId);

        const closed = await escrowFormsService.closeForm(draft.id, {
          userId: adminId,
          role: 'ADMIN',
        });
        expect(closed.closeKind).toBe('OWNER');
        expect((await reopenAsOwner(draft.id, adminId)).status).toBe(
          'PUBLISHED',
        );
      });

      it('fails closed for a survey closed before the close kind was recorded (NULL)', async () => {
        const draft = await liveSurvey('Legacy Close');
        await escrowFormsService.closeForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });
        const stored = (await repository.findById(draft.id))!;
        await repository.update(stored.form.copyWith({ closeKind: null }));

        await expect(reopenAsOwner(draft.id)).rejects.toMatchObject({
          code: 'FORM_NOT_REOPENABLE',
          reason: 'CLOSED_BY_ADMIN_OR_MODERATION',
          closeKind: null,
        });
      });

      it('keeps VERSION_NOT_APPROVED for an owner-withdrawn submission that never went live', async () => {
        const draft = await escrowFormsService.createDraft(publisherId, {
          title: 'Withdrawn',
          type: 'INTERNAL',
          rewardPerResponse: 0,
          expectedCompletions: 10,
          schema: {
            schemaVersion: 1,
            title: 'Withdrawn',
            blocks: [validBlock],
          },
        });
        await escrowFormsService.publishForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });
        const withdrawn = await escrowFormsService.closeForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });
        expect(withdrawn.closeKind).toBe('OWNER');

        await expect(reopenAsOwner(draft.id)).rejects.toMatchObject({
          code: 'FORM_NOT_REOPENABLE',
          reason: 'VERSION_NOT_APPROVED',
          closeKind: 'OWNER',
        });
      });
    });

    describe('Story 8.1: moderation-aware escrow flows', () => {
      async function queuedDraft(title: string) {
        const draft = await escrowFormsService.createDraft(publisherId, {
          title,
          type: 'INTERNAL',
          rewardPerResponse: 10, // 8 effective
          estimatedDurationMinutes: 8, // FR-14 band 10–20 (E6-D2)
          expectedCompletions: 50, // 400 locked
          schema: { schemaVersion: 1, title, blocks: [validBlock] },
        });
        await escrowFormsService.publishForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });
        return draft;
      }

      it('refunds the full reservation when the publisher withdraws a queued survey', async () => {
        const draft = await queuedDraft('Withdrawn Survey');
        escrowUnitOfWork.keys.length = 0;

        const closed = await escrowFormsService.closeForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });

        expect(closed.status).toBe('CLOSED');
        expect(escrowUnitOfWork.keys).toEqual([`close-refund:${draft.id}:c1`]);
        const wallet = await escrowLedgerService.getWallet(publisherId);
        expect(wallet.balance.escrow).toBe(0);
        expect(wallet.balance.available).toBe(1000);
      });

      it("refuses an Admin close of another publisher's queued survey: moderation only (review P1)", async () => {
        const draft = await queuedDraft('Queued For Someone Else');
        escrowUnitOfWork.keys.length = 0;

        await expect(
          escrowFormsService.closeForm(draft.id, {
            userId: adminId,
            role: 'ADMIN',
          }),
        ).rejects.toThrow(FormModerationRequiredException);

        const stored = (await repository.findById(draft.id))!;
        expect(stored.form.status).toBe('MODERATION_QUEUE');
        expect(stored.form.closeCount).toBe(0);
        expect(escrowUnitOfWork.keys).toEqual([]);
        expect(
          await escrowLedgerService.findJournalByIdempotencyKey(
            `close-refund:${draft.id}:c1`,
          ),
        ).toBeNull();
        const wallet = await escrowLedgerService.getWallet(publisherId);
        expect(wallet.balance.escrow).toBe(400);

        // The owner can still withdraw it (full refund).
        const withdrawn = await escrowFormsService.closeForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });
        expect(withdrawn.status).toBe('CLOSED');
        expect(
          (await escrowLedgerService.getWallet(publisherId)).balance.escrow,
        ).toBe(0);
      });

      describe('legacy ESCROW_LOCKED -> MODERATION_QUEUE (review P2)', () => {
        let legacySequence = 0;

        async function seedLegacy(
          overrides: { externalUrl?: string; reserve?: number } = {},
        ) {
          legacySequence += 1;
          const suffix = String(legacySequence).padStart(12, '0');
          const now = new Date();
          const isExternal = overrides.externalUrl !== undefined;
          const form = new FormEntity(
            `cccccccc-cccc-4ccc-8ccc-${suffix}`,
            publisherId,
            isExternal ? 'EXTERNAL' : 'INTERNAL',
            'ESCROW_LOCKED',
            `Legacy ${legacySequence}`,
            null,
            10,
            50, // Internal 400, External 500
            now,
            now,
          );
          const version = new FormVersionEntity(
            `dddddddd-dddd-4ddd-8ddd-${suffix}`,
            form.id,
            1,
            {
              schemaVersion: 1,
              title: form.title,
              blocks: isExternal ? [] : [validBlock],
              metadata: {
                expectedEffortSeconds: 60,
                minTimeBarrierSeconds: 15,
              },
            } as never,
            null,
            false,
            overrides.externalUrl ?? null,
            isExternal ? 'legacy-verifier' : null,
            null,
            now,
          );
          await repository.create(form, version);
          if (overrides.reserve) {
            await escrowLedgerService.reserveEscrow({
              userId: publisherId,
              formVersionId: version.id,
              amount: overrides.reserve,
              formTitle: form.title,
            });
          }
          return form.id;
        }

        it('fails closed with 409 MODERATION_ESCROW_NOT_FUNDED when nothing was reserved', async () => {
          const formId = await seedLegacy();

          await expect(
            escrowFormsService.transitionStatus(
              formId,
              { userId: adminId, role: 'ADMIN' },
              { targetStatus: 'MODERATION_QUEUE' },
            ),
          ).rejects.toMatchObject({
            constructor: ModerationEscrowNotFundedException,
            shortfall: 400,
          });
          expect((await repository.findById(formId))!.form.status).toBe(
            'ESCROW_LOCKED',
          );
          // The Admin never reserves on the Publisher's behalf.
          expect(
            (await escrowLedgerService.getWallet(publisherId)).balance
              .available,
          ).toBe(1000);
        });

        it('moves a fully reserved legacy row into the queue', async () => {
          const formId = await seedLegacy({ reserve: 400 });

          const queued = await escrowFormsService.transitionStatus(
            formId,
            { userId: adminId, role: 'ADMIN' },
            { targetStatus: 'MODERATION_QUEUE' },
          );

          expect(queued.status).toBe('MODERATION_QUEUE');
          expect(queued.currentVersion.isPublished).toBe(false);
        });

        it('re-runs the publish validations (legacy http: URL -> 422)', async () => {
          const formId = await seedLegacy({
            externalUrl: 'http://forms.gle/legacy',
            reserve: 500,
          });

          await expect(
            escrowFormsService.transitionStatus(
              formId,
              { userId: adminId, role: 'ADMIN' },
              { targetStatus: 'MODERATION_QUEUE' },
            ),
          ).rejects.toThrow(FormValidationException);
          expect((await repository.findById(formId))!.form.status).toBe(
            'ESCROW_LOCKED',
          );
        });

        it('still lets the Admin close an unfunded legacy row (refunds nothing)', async () => {
          const formId = await seedLegacy();

          const closed = await escrowFormsService.transitionStatus(
            formId,
            { userId: adminId, role: 'ADMIN' },
            { targetStatus: 'CLOSED' },
          );

          expect(closed.status).toBe('CLOSED');
          const wallet = await escrowLedgerService.getWallet(publisherId);
          expect(wallet.balance.available).toBe(1000);
          expect(wallet.balance.escrow).toBe(0);
        });
      });

      it('refuses to reopen a survey whose version never went live', async () => {
        const draft = await queuedDraft('Never Live Survey');
        await escrowFormsService.closeForm(draft.id, {
          userId: publisherId,
          role: 'PUBLISHER',
        });

        await expect(
          escrowFormsService.reopenForm(
            draft.id,
            { userId: publisherId, role: 'PUBLISHER' },
            { additionalCompletions: 10 },
          ),
        ).rejects.toThrow(FormNotReopenableException);
        const wallet = await escrowLedgerService.getWallet(publisherId);
        expect(wallet.balance.available).toBe(1000);
        expect((await repository.findById(draft.id))!.form.status).toBe(
          'CLOSED',
        );
      });

      it('auto-published external surveys reserve Escrow and wait in the queue', async () => {
        const created = await escrowFormsService.createExternalSurvey(
          publisherId,
          {
            title: 'Auto External',
            externalUrl: 'https://forms.gle/auto',
            rewardPerResponse: 10,
            estimatedDurationMinutes: 8,
            expectedCompletions: 30, // 300, no internal discount
            autoPublish: true,
          },
        );

        expect(created.status).toBe('MODERATION_QUEUE');
        expect(created.currentVersion.isPublished).toBe(false);
        expect(created.currentVersion.publishedAt).toBeNull();
        expect(escrowUnitOfWork.keys).toEqual([
          `publish:${created.currentVersion.id}`,
        ]);
        expect(
          await escrowLedgerService.getEscrowReservation(
            created.currentVersion.id,
          ),
        ).toBe(300);
        const wallet = await escrowLedgerService.getWallet(publisherId);
        expect(wallet.balance.escrow).toBe(300);
      });

      it('creates nothing when an auto-published external survey cannot be funded', async () => {
        await expect(
          escrowFormsService.createExternalSurvey(publisherId, {
            title: 'Too Expensive',
            externalUrl: 'https://forms.gle/expensive',
            // In the FR-14 "> 15 min" band (20–40), so only the funding fails.
            rewardPerResponse: 40,
            estimatedDurationMinutes: 20,
            expectedCompletions: 100, // 4000 > 1000
            autoPublish: true,
          }),
        ).rejects.toThrow(InsufficientEscrowBalanceException);

        const { total } = await repository.findManyByPublisher({
          publisherId,
          page: 1,
          limit: 10,
        });
        expect(total).toBe(0);
      });
    });

    it('returns pricing quote with 20% discount details (FR-19)', async () => {
      const draft = await escrowFormsService.createDraft(publisherId, {
        title: 'Quote Survey',
        type: 'INTERNAL',
        rewardPerResponse: 20,
        estimatedDurationMinutes: 8,
        expectedCompletions: 100,
      });

      const quote = await escrowFormsService.getPricingQuote(draft.id, {
        userId: publisherId,
        role: 'PUBLISHER',
      });

      expect(quote).toEqual({
        type: 'INTERNAL',
        expectedCompletions: 100,
        baseRewardPerResponse: 20,
        effectiveRewardPerResponse: 16,
        baseCost: 2000,
        effectiveCost: 1600,
        discountPercent: 20,
        discountAmount: 400,
        // Decision E6-D2: the FR-14 band of the estimated duration.
        estimatedDurationMinutes: 8,
        pricingBand: {
          min: 10,
          max: 20,
          suggested: 10,
          durationBand: '5–10 min',
        },
        bandCheck: 'WITHIN_BAND',
      });
    });

    it('returns no band and DURATION_REQUIRED / EXEMPT in the quote when nothing picks a band (E6-D2)', async () => {
      const rewarded = await escrowFormsService.createDraft(publisherId, {
        title: 'No Duration Yet',
        type: 'INTERNAL',
        rewardPerResponse: 30,
      });
      const free = await escrowFormsService.createDraft(publisherId, {
        title: 'Free Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
      });
      const owner = { userId: publisherId, role: 'PUBLISHER' };

      expect(
        await escrowFormsService.getPricingQuote(rewarded.id, owner),
      ).toMatchObject({
        estimatedDurationMinutes: null,
        pricingBand: null,
        bandCheck: 'DURATION_REQUIRED',
      });
      expect(
        await escrowFormsService.getPricingQuote(free.id, owner),
      ).toMatchObject({
        pricingBand: null,
        bandCheck: 'EXEMPT',
        effectiveCost: 0,
      });
    });

    describe('Decision E6-D2: FR-14 reward pricing band at publish', () => {
      const owner = { userId: publisherId, role: 'PUBLISHER' };

      async function internalDraft(fields: {
        rewardPerResponse: number;
        estimatedDurationMinutes?: number | null;
      }) {
        return escrowFormsService.createDraft(publisherId, {
          title: 'Priced Survey',
          type: 'INTERNAL',
          expectedCompletions: 10,
          ...fields,
          schema: {
            schemaVersion: 1,
            title: 'Priced Survey',
            blocks: [validBlock],
          },
        });
      }

      it('keeps drafts editable out of band: create and autosave accept any in-cap reward', async () => {
        const draft = await internalDraft({
          rewardPerResponse: 9000,
          estimatedDurationMinutes: 3,
        });
        expect(draft.estimatedDurationMinutes).toBe(3);

        const updated = await escrowFormsService.updateDraft(draft.id, owner, {
          clientUpdatedAt: draft.updatedAt,
          rewardPerResponse: 10_000,
          estimatedDurationMinutes: null,
        });
        expect(updated.rewardPerResponse).toBe(10_000);
        expect(updated.estimatedDurationMinutes).toBeNull();
        expect(updated.status).toBe('DRAFT');
      });

      it('rejects a reward above the band maximum with 400 PRICING_REWARD_OUT_OF_BAND { min, max, suggested }, reserving nothing', async () => {
        const draft = await internalDraft({
          rewardPerResponse: 26,
          estimatedDurationMinutes: 12, // 10–15 min: 15–25 points
        });

        const error = await escrowFormsService
          .publishForm(draft.id, owner)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(PricingRewardOutOfBandException);
        expect((error as PricingRewardOutOfBandException).code).toBe(
          'PRICING_REWARD_OUT_OF_BAND',
        );
        expect((error as PricingRewardOutOfBandException).band).toMatchObject({
          min: 15,
          max: 25,
          suggested: 15,
        });
        expect((await repository.findById(draft.id))!.form.status).toBe(
          'DRAFT',
        );
        expect(
          (await escrowLedgerService.getWallet(publisherId)).balance,
        ).toMatchObject({ available: 1000, escrow: 0 });
      });

      it('rejects a reward below the band minimum', async () => {
        const draft = await internalDraft({
          rewardPerResponse: 14,
          estimatedDurationMinutes: 12,
        });

        await expect(
          escrowFormsService.publishForm(draft.id, owner),
        ).rejects.toBeInstanceOf(PricingRewardOutOfBandException);
      });

      it('requires an estimated duration for a rewarded survey (422 ESTIMATED_DURATION_REQUIRED)', async () => {
        const draft = await internalDraft({ rewardPerResponse: 10 });

        await expect(
          escrowFormsService.publishForm(draft.id, owner),
        ).rejects.toMatchObject({
          name: 'FormValidationException',
          code: 'ESTIMATED_DURATION_REQUIRED',
        });
      });

      it('exempts a free (0-point) Internal survey from the band and the duration (6.3 AC3.1)', async () => {
        const draft = await internalDraft({ rewardPerResponse: 0 });

        const queued = await escrowFormsService.publishForm(draft.id, owner);

        expect(queued.status).toBe('MODERATION_QUEUE');
        expect(queued.estimatedDurationMinutes).toBeNull();
      });

      it('publishes an in-band reward and accepts the duration with the publish request (stored on the form)', async () => {
        const draft = await internalDraft({ rewardPerResponse: 25 });

        const queued = await escrowFormsService.publishForm(draft.id, owner, {
          estimatedDurationMinutes: 12,
        });

        expect(queued.status).toBe('MODERATION_QUEUE');
        expect(queued.estimatedDurationMinutes).toBe(12);
        expect(
          (await repository.findById(draft.id))!.form.estimatedDurationMinutes,
        ).toBe(12);
        // 10 x round(0.8 x 25) = 200 in Escrow.
        expect(
          (await escrowLedgerService.getWallet(publisherId)).balance.escrow,
        ).toBe(200);
      });

      async function internalDraftWithEffort(fields: {
        rewardPerResponse: number;
        estimatedDurationMinutes: number;
        expectedEffortSeconds: number;
      }) {
        return escrowFormsService.createDraft(publisherId, {
          title: 'Effort Survey',
          type: 'INTERNAL',
          expectedCompletions: 10,
          rewardPerResponse: fields.rewardPerResponse,
          estimatedDurationMinutes: fields.estimatedDurationMinutes,
          schema: {
            schemaVersion: 1,
            title: 'Effort Survey',
            blocks: [validBlock],
            metadata: {
              expectedEffortSeconds: fields.expectedEffortSeconds,
              minTimeBarrierSeconds: 15,
            },
          },
        });
      }

      it('prices by the declared effort: a 25-minute effort survey cannot publish at the 1-minute band price', async () => {
        const draft = await internalDraftWithEffort({
          rewardPerResponse: 5, // the "< 5 min" band price
          estimatedDurationMinutes: 1,
          expectedEffortSeconds: 1500,
        });

        const error = await escrowFormsService
          .publishForm(draft.id, owner)
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(PricingRewardOutOfBandException);
        expect((error as PricingRewardOutOfBandException).band).toMatchObject({
          min: 20,
          max: 40,
          durationBand: '> 15 min',
        });
        expect((await repository.findById(draft.id))!.form.status).toBe(
          'DRAFT',
        );
        expect(
          await escrowFormsService.getPricingQuote(draft.id, owner),
        ).toMatchObject({
          estimatedDurationMinutes: 1,
          pricingBand: { min: 20, max: 40, durationBand: '> 15 min' },
          bandCheck: 'OUT_OF_BAND',
        });
      });

      it('publishes when the reward matches the band of the effective (effort) duration', async () => {
        const draft = await internalDraftWithEffort({
          rewardPerResponse: 20,
          estimatedDurationMinutes: 1,
          expectedEffortSeconds: 1500,
        });

        const queued = await escrowFormsService.publishForm(draft.id, owner);

        expect(queued.status).toBe('MODERATION_QUEUE');
      });

      it('rejects an External auto-publish whose effort exceeds the claimed duration band', async () => {
        await expect(
          escrowFormsService.createExternalSurvey(publisherId, {
            title: 'Underpriced External',
            externalUrl: 'https://forms.gle/underpriced',
            rewardPerResponse: 5,
            estimatedDurationMinutes: 1,
            expectedEffortSeconds: 1500,
            expectedCompletions: 5,
            autoPublish: true,
          }),
        ).rejects.toBeInstanceOf(PricingRewardOutOfBandException);
      });

      it('enforces the band on an External auto-publish, creating nothing when it fails', async () => {
        await expect(
          escrowFormsService.createExternalSurvey(publisherId, {
            title: 'Overpriced External',
            externalUrl: 'https://forms.gle/overpriced',
            rewardPerResponse: 41,
            estimatedDurationMinutes: 30, // > 15 min: 20–40
            expectedCompletions: 5,
            autoPublish: true,
          }),
        ).rejects.toBeInstanceOf(PricingRewardOutOfBandException);
        await expect(
          escrowFormsService.createExternalSurvey(publisherId, {
            title: 'Unpriced External',
            externalUrl: 'https://forms.gle/unpriced',
            rewardPerResponse: 10,
            autoPublish: true,
          }),
        ).rejects.toMatchObject({ code: 'ESTIMATED_DURATION_REQUIRED' });

        const { total } = await repository.findManyByPublisher({
          publisherId,
          page: 1,
          limit: 10,
        });
        expect(total).toBe(0);

        // An External draft (no auto-publish) stays editable out of band.
        const draft = await escrowFormsService.createExternalSurvey(
          publisherId,
          {
            title: 'External Draft',
            externalUrl: 'https://forms.gle/draft',
            rewardPerResponse: 41,
            estimatedDurationMinutes: 30,
            autoPublish: false,
          },
        );
        expect(draft.status).toBe('DRAFT');
        expect(draft.estimatedDurationMinutes).toBe(30);
      });
    });
  });

  describe('Decision E5-D2: surveys must fit the 30-minute attempt reservation at publish', () => {
    const owner = { userId: publisherId, role: 'PUBLISHER' };
    const block: FormBlock = {
      id: 'block-q1',
      type: 'text',
      order: 0,
      title: 'Question',
      required: true,
    };

    async function freeInternalDraft(metadata: {
      expectedEffortSeconds: number;
      minTimeBarrierSeconds: number;
    }) {
      return service.createDraft(publisherId, {
        title: 'Long Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Long Survey',
          blocks: [block],
          metadata,
        },
      });
    }

    it('refuses a publisher minimum that leaves less than 5 minutes to submit (422 SURVEY_DURATION_EXCEEDS_RESERVATION)', async () => {
      const draft = await freeInternalDraft({
        expectedEffortSeconds: 1800,
        minTimeBarrierSeconds: 1501,
      });

      const error = await service
        .publishForm(draft.id, owner)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FormValidationException);
      expect(error).toMatchObject({
        code: 'SURVEY_DURATION_EXCEEDS_RESERVATION',
        errors: [
          {
            rule: 'TIME_BARRIER',
            requiredSeconds: 1501,
            maxSeconds: 1500,
            questionCount: 1,
            publisherMinimumSeconds: 1501,
          },
        ],
      });
      expect((error as Error).message).toMatch(
        /Phase 1 does not support surveys longer than 30 minutes/,
      );
      expect((await repository.findById(draft.id))!.form.status).toBe('DRAFT');
    });

    it('refuses an expected effort above 30 minutes', async () => {
      const draft = await freeInternalDraft({
        expectedEffortSeconds: 3600,
        minTimeBarrierSeconds: 15,
      });

      await expect(service.publishForm(draft.id, owner)).rejects.toMatchObject({
        code: 'SURVEY_DURATION_EXCEEDS_RESERVATION',
        errors: [expect.objectContaining({ rule: 'EXPECTED_EFFORT' })],
      });
    });

    it('refuses an estimated duration above 30 minutes, including one sent with the publish request', async () => {
      const draft = await freeInternalDraft({
        expectedEffortSeconds: 600,
        minTimeBarrierSeconds: 15,
      });

      await expect(
        service.publishForm(draft.id, owner, { estimatedDurationMinutes: 45 }),
      ).rejects.toMatchObject({
        code: 'SURVEY_DURATION_EXCEEDS_RESERVATION',
        errors: [
          {
            rule: 'ESTIMATED_DURATION',
            estimatedDurationMinutes: 45,
            maxMinutes: 30,
          },
        ],
      });
      const stored = (await repository.findById(draft.id))!.form;
      expect(stored.status).toBe('DRAFT');
      expect(stored.estimatedDurationMinutes).toBeNull();
    });

    it('publishes at the exact limits (25-minute barrier, 30-minute effort and duration)', async () => {
      const draft = await freeInternalDraft({
        expectedEffortSeconds: 1800,
        minTimeBarrierSeconds: 1500,
      });

      await expect(
        service.publishForm(draft.id, owner, { estimatedDurationMinutes: 30 }),
      ).resolves.toMatchObject({ status: 'MODERATION_QUEUE' });
    });

    it('checks an External auto-publish too (nothing is created); drafts stay editable', async () => {
      await expect(
        service.createExternalSurvey(publisherId, {
          title: 'Long External',
          externalUrl: 'https://forms.gle/long',
          rewardPerResponse: 20,
          estimatedDurationMinutes: 45,
          expectedEffortSeconds: 2700,
          autoPublish: true,
        }),
      ).rejects.toMatchObject({ code: 'SURVEY_DURATION_EXCEEDS_RESERVATION' });
      const { total } = await repository.findManyByPublisher({
        publisherId,
        page: 1,
        limit: 10,
      });
      expect(total).toBe(0);

      const draft = await service.createExternalSurvey(publisherId, {
        title: 'Long External Draft',
        externalUrl: 'https://forms.gle/long-draft',
        rewardPerResponse: 20,
        estimatedDurationMinutes: 45,
        expectedEffortSeconds: 2700,
        autoPublish: false,
      });
      expect(draft.status).toBe('DRAFT');
      await expect(service.publishForm(draft.id, owner)).rejects.toMatchObject({
        code: 'SURVEY_DURATION_EXCEEDS_RESERVATION',
      });
    });

    it('the moderation approval re-checks a queued survey that no longer fits', async () => {
      const formId = randomUUID();
      const versionId = randomUUID();
      await repository.create(
        new FormEntity(
          formId,
          publisherId,
          'INTERNAL',
          'MODERATION_QUEUE',
          'Legacy queued survey',
          null,
          0,
          10,
          new Date(),
          new Date(),
          undefined,
          0,
          45,
        ),
        new FormVersionEntity(
          versionId,
          formId,
          1,
          {
            schemaVersion: 1,
            title: 'Legacy queued survey',
            blocks: [block],
            metadata: { expectedEffortSeconds: 600, minTimeBarrierSeconds: 15 },
          } as any,
          null,
          false,
          null,
          null,
          null,
          new Date(),
        ),
      );

      await expect(approveQueued(formId)).rejects.toMatchObject({
        code: 'SURVEY_DURATION_EXCEEDS_RESERVATION',
      });
    });
  });

  describe('Decision E5-D4: the Publisher is warned about cut-off in-progress attempts', () => {
    const owner = { userId: publisherId, role: 'PUBLISHER' };

    async function liveSurvey() {
      const created = await service.createDraft(publisherId, {
        title: 'Live Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        schema: {
          schemaVersion: 1,
          title: 'Live Survey',
          blocks: [
            {
              id: 'block-q1',
              type: 'text',
              order: 0,
              title: 'Question',
              required: true,
            },
          ],
        },
      });
      await service.publishForm(created.id, owner);
      await approveQueued(created.id);
      return created.id;
    }

    it('reports the unexpired in-progress attempts before "Create New Version" (owner or Admin only)', async () => {
      const formId = await liveSurvey();
      const since: Date[] = [];
      repository.useInProgressAttemptsSource((id, startedSince) => {
        since.push(startedSince);
        return id === formId ? 3 : 0;
      });

      await expect(
        service.getInProgressAttempts(formId, owner),
      ).resolves.toEqual({
        formId,
        status: 'PUBLISHED',
        inProgressAttempts: 3,
        reservationWindowMinutes: 30,
      });
      // Only attempts still holding their 30-minute reservation count.
      expect(Date.now() - since[0].getTime()).toBeGreaterThanOrEqual(
        30 * 60 * 1000,
      );
      expect(Date.now() - since[0].getTime()).toBeLessThan(31 * 60 * 1000);

      await expect(
        service.getInProgressAttempts(formId, {
          userId: adminId,
          role: 'ADMIN',
        }),
      ).resolves.toMatchObject({ inProgressAttempts: 3 });
      await expect(
        service.getInProgressAttempts(formId, {
          userId: otherUserId,
          role: 'PUBLISHER',
        }),
      ).rejects.toBeInstanceOf(FormForbiddenException);
      await expect(
        service.getInProgressAttempts(randomUUID(), owner),
      ).rejects.toBeInstanceOf(FormNotFoundException);
    });

    it('keeps the strict cut-off and returns how many in-progress attempts were interrupted', async () => {
      const formId = await liveSurvey();
      repository.useInProgressAttemptsSource(() => 2);

      const result = await service.createNewVersion(formId, owner);

      expect(result.status).toBe('DRAFT');
      expect(result.currentVersion.versionNumber).toBe(2);
      expect(result.interruptedAttempts).toBe(2);
    });

    it('reports 0 when nobody was taking the survey', async () => {
      const formId = await liveSurvey();

      await expect(
        service.createNewVersion(formId, owner),
      ).resolves.toMatchObject({ interruptedAttempts: 0 });
    });
  });
  describe('Bug 3.1 / decision D2: pricing is frozen after the first publication', () => {
    const owner = { userId: publisherId, role: 'PUBLISHER' };
    const validBlock: FormBlock = {
      id: 'block-d2-1',
      type: 'text',
      title: 'What is your favorite topic?',
      order: 0,
      required: true,
    };
    let ledgerService: LedgerService;
    let coordinator: FormsEscrowCoordinator;
    let escrowService: FormsService;

    beforeEach(async () => {
      ledgerService = new LedgerService(new InMemoryLedgerRepository());
      coordinator = new FormsEscrowCoordinator(repository, ledgerService);
      escrowService = new FormsService(
        repository,
        completionCodeService,
        coordinator,
        new PassThroughUnitOfWork(),
      );
      const system = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const available = await ledgerService.getOrCreateAccount(
        publisherId,
        'USER_AVAILABLE',
      );
      await ledgerService.transfer({
        fromAccountId: system.id,
        toAccountId: available.id,
        amount: 1000,
        idempotencyKey: 'seed-d2-1000',
      });
    });

    /** Internal survey, 50 × 8 = 400 Escrow, published then re-versioned. */
    async function reversionedDraft() {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Frozen Pricing',
        type: 'INTERNAL',
        rewardPerResponse: 10,
        estimatedDurationMinutes: 8,
        expectedCompletions: 50,
        schema: {
          schemaVersion: 1,
          title: 'Frozen Pricing',
          blocks: [validBlock],
        },
      });
      await escrowService.publishForm(draft.id, owner);
      await approveQueued(draft.id);
      const v2 = await escrowService.createNewVersion(draft.id, owner);
      return { formId: draft.id, clientUpdatedAt: v2.updatedAt };
    }

    it('rejects a reward change on a re-versioned draft with 409 FORM_PUBLISHED_FIELDS_IMMUTABLE', async () => {
      const { formId, clientUpdatedAt } = await reversionedDraft();

      const error = await escrowService
        .updateDraft(formId, owner, { clientUpdatedAt, rewardPerResponse: 12 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FormPublishedFieldsImmutableException);
      expect((error as FormPublishedFieldsImmutableException).code).toBe(
        'FORM_PUBLISHED_FIELDS_IMMUTABLE',
      );
      expect((error as FormPublishedFieldsImmutableException).fields).toEqual([
        'rewardPerResponse',
      ]);
      expect((await repository.findById(formId))!.form.rewardPerResponse).toBe(
        10,
      );
    });

    it('rejects a type change on a re-versioned draft', async () => {
      const { formId, clientUpdatedAt } = await reversionedDraft();

      const error = await escrowService
        .updateDraft(formId, owner, { clientUpdatedAt, type: 'EXTERNAL' })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(FormPublishedFieldsImmutableException);
      expect((error as FormPublishedFieldsImmutableException).fields).toEqual([
        'type',
      ]);
      expect((await repository.findById(formId))!.form.type).toBe('INTERNAL');
    });

    it('accepts the unchanged stored type and reward (the builder always sends them)', async () => {
      const { formId, clientUpdatedAt } = await reversionedDraft();

      const saved = await escrowService.updateDraft(formId, owner, {
        clientUpdatedAt,
        title: 'Frozen Pricing v2',
        type: 'INTERNAL',
        rewardPerResponse: 10,
        expectedCompletions: 50,
      });

      expect(saved.title).toBe('Frozen Pricing v2');
      expect(saved.rewardPerResponse).toBe(10);
    });

    it('rejects a quota below the committed completions and accepts an equal or higher one', async () => {
      const { formId, clientUpdatedAt } = await reversionedDraft();
      repository.setCompletedResponsesCount(formId, 30);

      const error = await escrowService
        .updateDraft(formId, owner, {
          clientUpdatedAt,
          expectedCompletions: 29,
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FormValidationException);
      expect((error as FormValidationException).code).toBe(
        'EXPECTED_COMPLETIONS_BELOW_COMMITTED',
      );

      const equal = await escrowService.updateDraft(formId, owner, {
        clientUpdatedAt,
        expectedCompletions: 30,
      });
      expect(equal.expectedCompletions).toBe(30);

      const higher = await escrowService.updateDraft(formId, owner, {
        clientUpdatedAt: equal.updatedAt,
        expectedCompletions: 80,
      });
      expect(higher.expectedCompletions).toBe(80);
    });

    it('keeps type and reward editable on a never-published draft', async () => {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Still Editable',
        type: 'INTERNAL',
        rewardPerResponse: 10,
      });

      const saved = await escrowService.updateDraft(draft.id, owner, {
        clientUpdatedAt: draft.updatedAt,
        type: 'EXTERNAL',
        rewardPerResponse: 20,
        expectedCompletions: 1,
      });

      expect(saved.type).toBe('EXTERNAL');
      expect(saved.rewardPerResponse).toBe(20);
    });

    it('closes a re-versioned draft and refunds the Escrow it still holds', async () => {
      const { formId } = await reversionedDraft();
      expect(
        (await ledgerService.getWallet(publisherId)).balance,
      ).toMatchObject({ available: 600, escrow: 400 });
      const closeSpy = jest.spyOn(coordinator, 'coordinateClose');

      const closed = await escrowService.closeForm(formId, owner);

      expect(closed.status).toBe('CLOSED');
      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(closeSpy.mock.calls[0][0].status).toBe('CLOSED');
      expect(
        (await ledgerService.getWallet(publisherId)).balance,
      ).toMatchObject({ available: 1000, escrow: 0 });
    });

    it('rejects closing a never-published draft (it is deleted instead)', async () => {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Never Published',
      });
      const closeSpy = jest.spyOn(coordinator, 'coordinateClose');

      await expect(escrowService.closeForm(draft.id, owner)).rejects.toThrow(
        InvalidFormStatusTransitionException,
      );
      await expect(
        escrowService.transitionStatus(
          draft.id,
          { userId: adminId, role: 'ADMIN' },
          { targetStatus: 'CLOSED' },
        ),
      ).rejects.toThrow(InvalidFormStatusTransitionException);
      expect(closeSpy).not.toHaveBeenCalled();
      expect((await repository.findById(draft.id))!.form.status).toBe('DRAFT');
    });

    it('routes an Admin DRAFT -> CLOSED transition of a re-versioned draft through the refunding close', async () => {
      const { formId } = await reversionedDraft();

      const closed = await escrowService.transitionStatus(
        formId,
        { userId: adminId, role: 'ADMIN' },
        { targetStatus: 'CLOSED' },
      );

      expect(closed.status).toBe('CLOSED');
      expect(closed.closeKind).toBe('ADMIN');
      expect(
        (await ledgerService.getWallet(publisherId)).balance,
      ).toMatchObject({ available: 1000, escrow: 0 });
    });

    it('never publishes a re-versioned draft straight into CLOSED', async () => {
      const { formId } = await reversionedDraft();

      await expect(
        escrowService.publishForm(formId, owner, { targetStatus: 'CLOSED' }),
      ).rejects.toThrow(InvalidFormStatusTransitionException);
      expect((await repository.findById(formId))!.form.status).toBe('DRAFT');
    });
  });

  describe('Review F2/F3: effort normalization and the frozen-reward band minimum', () => {
    const owner = { userId: publisherId, role: 'PUBLISHER' };
    let ledgerService: LedgerService;
    let escrowService: FormsService;

    function textBlocks(count: number): FormBlock[] {
      return Array.from({ length: count }, (_, index) => ({
        id: `block-f2-${index}`,
        type: 'text' as const,
        title: `Question ${index + 1}`,
        order: index,
        required: true,
      }));
    }

    function schemaWith(blockCount: number, expectedEffortSeconds: number) {
      return {
        schemaVersion: 1,
        title: 'Effort Survey',
        blocks: textBlocks(blockCount),
        metadata: { expectedEffortSeconds, minTimeBarrierSeconds: 15 },
      };
    }

    async function storedEffort(formId: string) {
      return (await repository.findById(formId))!.currentVersion.schemaJson
        .metadata.expectedEffortSeconds;
    }

    beforeEach(async () => {
      ledgerService = new LedgerService(new InMemoryLedgerRepository());
      escrowService = new FormsService(
        repository,
        completionCodeService,
        new FormsEscrowCoordinator(repository, ledgerService),
        new PassThroughUnitOfWork(),
      );
      const system = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const available = await ledgerService.getOrCreateAccount(
        publisherId,
        'USER_AVAILABLE',
      );
      await ledgerService.transfer({
        fromAccountId: system.id,
        toAccountId: available.id,
        amount: 1000,
        idempotencyKey: 'seed-f2-f3-1000',
      });
    });

    it('publishes a 31-block Internal draft saved with the default 60 s effort, raising the stored effort', async () => {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Long Survey',
        type: 'INTERNAL',
        rewardPerResponse: 5,
        estimatedDurationMinutes: 1,
        expectedCompletions: 10,
        schema: schemaWith(31, 60),
      });
      // 31 answerable questions x 2 s = 62 s barrier.
      expect(await storedEffort(draft.id)).toBe(62);

      const queued = await escrowService.publishForm(draft.id, owner);

      expect(queued.status).toBe('MODERATION_QUEUE');
      expect(
        queued.currentVersion.schemaJson.metadata.expectedEffortSeconds,
      ).toBe(62);
    });

    it('raises the effort on autosave to the barrier and the estimated duration', async () => {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Autosaved Survey',
        type: 'INTERNAL',
        rewardPerResponse: 10,
        expectedCompletions: 10,
      });

      const saved = await escrowService.updateDraft(draft.id, owner, {
        clientUpdatedAt: draft.updatedAt,
        schema: schemaWith(31, 60),
      });
      expect(
        saved.currentVersion.schemaJson.metadata.expectedEffortSeconds,
      ).toBe(62);

      const withDuration = await escrowService.updateDraft(draft.id, owner, {
        clientUpdatedAt: saved.updatedAt,
        estimatedDurationMinutes: 4,
      });
      expect(
        withDuration.currentVersion.schemaJson.metadata.expectedEffortSeconds,
      ).toBe(240);
    });

    describe('Decision D3 (BE-6): a changed duration resets the effort to its floor', () => {
      async function internalDraft(blockCount: number, minutes: number) {
        return escrowService.createDraft(publisherId, {
          title: 'Duration Survey',
          type: 'INTERNAL',
          rewardPerResponse: 10,
          expectedCompletions: 10,
          estimatedDurationMinutes: minutes,
          schema: schemaWith(blockCount, 60),
        });
      }

      async function externalDraft(minutes: number, effortSeconds: number) {
        const created = await escrowService.createExternalSurvey(publisherId, {
          title: 'Duration External',
          externalUrl: 'https://forms.gle/duration',
          rewardPerResponse: 20,
          estimatedDurationMinutes: minutes,
          expectedEffortSeconds: effortSeconds,
          autoPublish: false,
        });
        return (await repository.findById(created.id))!;
      }

      it('lowers an Internal effort from 20 to 3 minutes', async () => {
        const draft = await internalDraft(3, 20);
        expect(await storedEffort(draft.id)).toBe(1200);

        const saved = await escrowService.updateDraft(draft.id, owner, {
          clientUpdatedAt: draft.updatedAt,
          estimatedDurationMinutes: 3,
        });

        expect(
          saved.currentVersion.schemaJson.metadata.expectedEffortSeconds,
        ).toBe(180);
      });

      it('lowers the effort when the builder autosave resends the stored effort with the new duration', async () => {
        const draft = await internalDraft(3, 20);

        const saved = await escrowService.updateDraft(draft.id, owner, {
          clientUpdatedAt: draft.updatedAt,
          estimatedDurationMinutes: 3,
          schema: schemaWith(3, 1200),
        });

        expect(
          saved.currentVersion.schemaJson.metadata.expectedEffortSeconds,
        ).toBe(180);
      });

      it('lowers an External effort from 20 to 3 minutes', async () => {
        const stored = await externalDraft(20, 1200);

        const saved = await escrowService.updateDraft(stored.form.id, owner, {
          clientUpdatedAt: stored.form.updatedAt.toISOString(),
          estimatedDurationMinutes: 3,
        });

        expect(
          saved.currentVersion.schemaJson.metadata.expectedEffortSeconds,
        ).toBe(180);
      });

      it('keeps a larger effort the caller sets together with the duration change', async () => {
        const draft = await internalDraft(3, 20);
        const internal = await escrowService.updateDraft(draft.id, owner, {
          clientUpdatedAt: draft.updatedAt,
          estimatedDurationMinutes: 3,
          schema: schemaWith(3, 900),
        });
        expect(
          internal.currentVersion.schemaJson.metadata.expectedEffortSeconds,
        ).toBe(900);

        const stored = await externalDraft(20, 1200);
        const schemaJson = stored.currentVersion.schemaJson;
        const external = await escrowService.updateDraft(
          stored.form.id,
          owner,
          {
            clientUpdatedAt: stored.form.updatedAt.toISOString(),
            estimatedDurationMinutes: 3,
            schema: {
              ...schemaJson,
              metadata: { ...schemaJson.metadata, expectedEffortSeconds: 900 },
            },
          },
        );
        expect(
          external.currentVersion.schemaJson.metadata.expectedEffortSeconds,
        ).toBe(900);
      });

      it('never drops the effort below the time barrier', async () => {
        // 200 questions x 2 s = 400 s barrier.
        const draft = await internalDraft(200, 20);

        const saved = await escrowService.updateDraft(draft.id, owner, {
          clientUpdatedAt: draft.updatedAt,
          estimatedDurationMinutes: 3,
        });

        expect(
          saved.currentVersion.schemaJson.metadata.expectedEffortSeconds,
        ).toBe(400);
      });

      it('leaves the effort alone when the duration does not change', async () => {
        const draft = await internalDraft(3, 20);

        const saved = await escrowService.updateDraft(draft.id, owner, {
          clientUpdatedAt: draft.updatedAt,
          estimatedDurationMinutes: 20,
          title: 'Renamed',
        });

        expect(
          saved.currentVersion.schemaJson.metadata.expectedEffortSeconds,
        ).toBe(1200);
      });
    });

    it('normalizes a stored legacy row at publish', async () => {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Legacy Survey',
        type: 'INTERNAL',
        rewardPerResponse: 5,
        estimatedDurationMinutes: 1,
        expectedCompletions: 10,
      });
      // A row written before normalization existed: 31 blocks, 60 s effort.
      const stored = (await repository.findById(draft.id))!;
      await repository.update(
        stored.form,
        stored.currentVersion.copyWith({
          schemaJson: {
            ...stored.currentVersion.schemaJson,
            blocks: textBlocks(31),
            metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
          },
        }),
        { status: 'DRAFT', updatedAt: stored.form.updatedAt },
      );
      expect(await storedEffort(draft.id)).toBe(60);

      const queued = await escrowService.publishForm(draft.id, owner);

      expect(queued.status).toBe('MODERATION_QUEUE');
      expect(await storedEffort(draft.id)).toBe(62);
    });

    it('still prices by the effective duration after normalization', async () => {
      // 200 questions x 2 s = 400 s barrier: effective 7 minutes (10-20 points).
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Very Long Survey',
        type: 'INTERNAL',
        rewardPerResponse: 5,
        estimatedDurationMinutes: 1,
        expectedCompletions: 10,
        schema: schemaWith(200, 60),
      });
      expect(await storedEffort(draft.id)).toBe(400);

      const error = await escrowService
        .publishForm(draft.id, owner)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PricingRewardOutOfBandException);
      expect((error as PricingRewardOutOfBandException).band).toMatchObject({
        min: 10,
        max: 20,
        durationBand: '5–10 min',
      });
    });

    it('keeps the 30-minute reservation cap on the normalized effort', async () => {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Too Long Survey',
        type: 'INTERNAL',
        rewardPerResponse: 0,
        expectedCompletions: 10,
        schema: schemaWith(3, 60),
      });

      await expect(
        escrowService.publishForm(draft.id, owner, {
          estimatedDurationMinutes: 31,
        }),
      ).rejects.toMatchObject({ code: 'SURVEY_DURATION_EXCEEDS_RESERVATION' });
      expect((await repository.findById(draft.id))!.form.status).toBe('DRAFT');
    });

    /** Published with `first`, approved, re-versioned; returns the draft. */
    async function reversioned(first: {
      rewardPerResponse: number;
      estimatedDurationMinutes: number;
    }) {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'Frozen Reward',
        type: 'INTERNAL',
        expectedCompletions: 10,
        ...first,
        schema: schemaWith(1, 60),
      });
      await escrowService.publishForm(draft.id, owner);
      await approveQueued(draft.id);
      const v2 = await escrowService.createNewVersion(draft.id, owner);
      return { formId: draft.id, clientUpdatedAt: v2.updatedAt };
    }

    it('republishes a re-versioned survey whose frozen reward is now below the band minimum', async () => {
      const { formId, clientUpdatedAt } = await reversioned({
        rewardPerResponse: 5,
        estimatedDurationMinutes: 4,
      });
      await escrowService.updateDraft(formId, owner, {
        clientUpdatedAt,
        schema: schemaWith(1, 600), // effective 10 minutes: 10-20 points
      });

      expect(await escrowService.getPricingQuote(formId, owner)).toMatchObject({
        pricingBand: { min: 10, max: 20 },
        bandCheck: 'WITHIN_BAND',
      });
      const queued = await escrowService.publishForm(formId, owner);

      expect(queued.status).toBe('MODERATION_QUEUE');
      expect(queued.rewardPerResponse).toBe(5);
    });

    it('still rejects the same survey below the band minimum on its first publish', async () => {
      const draft = await escrowService.createDraft(publisherId, {
        title: 'First Publish',
        type: 'INTERNAL',
        rewardPerResponse: 5,
        estimatedDurationMinutes: 4,
        expectedCompletions: 10,
        schema: schemaWith(1, 600),
      });

      expect(
        await escrowService.getPricingQuote(draft.id, owner),
      ).toMatchObject({ bandCheck: 'OUT_OF_BAND' });
      await expect(
        escrowService.publishForm(draft.id, owner),
      ).rejects.toBeInstanceOf(PricingRewardOutOfBandException);
      expect((await repository.findById(draft.id))!.form.status).toBe('DRAFT');
    });

    it('still rejects a frozen reward above the band maximum', async () => {
      const { formId, clientUpdatedAt } = await reversioned({
        rewardPerResponse: 25,
        estimatedDurationMinutes: 12, // 10-15 min: 15-25 points
      });
      // The builder sends the whole definition (with its default effort)
      // on every autosave, so the effort is re-derived from the new duration.
      await escrowService.updateDraft(formId, owner, {
        clientUpdatedAt,
        estimatedDurationMinutes: 4, // < 5 min: 5-10 points
        schema: schemaWith(1, 60),
      });

      expect(await escrowService.getPricingQuote(formId, owner)).toMatchObject({
        bandCheck: 'OUT_OF_BAND',
      });
      const error = await escrowService
        .publishForm(formId, owner)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PricingRewardOutOfBandException);
      expect((error as PricingRewardOutOfBandException).band).toMatchObject({
        min: 5,
        max: 10,
      });
      expect((await repository.findById(formId))!.form.status).toBe('DRAFT');
    });
  });
  describe('Phase 5 WP1: management fields (M1/M2) and Idempotency-Key (C6)', () => {
    let ledgerService: LedgerService;
    let escrowService: FormsService;

    const externalBody = {
      title: 'Idempotent External Survey',
      externalUrl: 'https://forms.gle/idempotent',
      rewardPerResponse: 10,
      expectedCompletions: 20, // 20 x 10 = 200 in Escrow
      estimatedDurationMinutes: 8,
      autoPublish: true,
    };
    const owner = { userId: publisherId, role: 'PUBLISHER' };

    beforeEach(async () => {
      ledgerService = new LedgerService(new InMemoryLedgerRepository());
      escrowService = new FormsService(
        repository,
        completionCodeService,
        new FormsEscrowCoordinator(repository, ledgerService),
        new PassThroughUnitOfWork(),
      );
      const system = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const available = await ledgerService.getOrCreateAccount(
        publisherId,
        'USER_AVAILABLE',
      );
      await ledgerService.transfer({
        fromAccountId: system.id,
        toAccountId: available.id,
        amount: 1000,
        idempotencyKey: 'seed-phase5-wp1-1000',
      });
    });

    it('replays a keyed draft creation and refuses the key with another body (Phase 6)', async () => {
      const first = await service.createDraft(
        publisherId,
        { title: 'AI chat draft', type: 'INTERNAL' },
        'ai-chat-key-0001',
      );
      const again = await service.createDraft(
        publisherId,
        { title: 'AI chat draft', type: 'INTERNAL' },
        'ai-chat-key-0001',
      );
      expect(again.id).toBe(first.id);
      const { forms } = await service.listForms(publisherId, {
        page: 1,
        limit: 10,
      });
      expect(forms.filter((form) => form.id === first.id)).toHaveLength(1);
      await expect(
        service.createDraft(
          publisherId,
          { title: 'Another title', type: 'INTERNAL' },
          'ai-chat-key-0001',
        ),
      ).rejects.toBeInstanceOf(IdempotencyKeyConflictException);
      const unkeyed = await service.createDraft(publisherId, {
        title: 'AI chat draft',
        type: 'INTERNAL',
      });
      expect(unkeyed.id).not.toBe(first.id);
    });

    it('lists closeKind and completedCompletions, and escrowLocked null without an Escrow coordinator', async () => {
      const draft = await service.createDraft(publisherId, { title: 'Plain' });
      repository.setRewardableCompletions(draft.id, { completedCount: 4 });

      const { forms } = await service.listForms(publisherId, {
        page: 1,
        limit: 10,
      });

      expect(forms[0]).toMatchObject({
        id: draft.id,
        closeKind: null,
        completedCompletions: 4,
        escrowLocked: null,
      });
      const detail = await service.getFormById(draft.id, owner);
      expect(detail.completedCompletions).toBe(4);
      expect(detail.escrowLocked).toBeNull();
    });

    it('reports the unused Escrow of each survey in the list and the detail, and 0 after the close refund', async () => {
      const created = await escrowService.createExternalSurvey(
        publisherId,
        externalBody,
      );
      await approveQueued(created.id);
      // 5 completions whose rewards are still owed draw 5 x 10 from Escrow.
      repository.setRewardableCompletions(created.id, {
        completedCount: 5,
        externalAttemptIds: Array.from({ length: 5 }, () => randomUUID()),
      });

      const listed = await escrowService.listForms(publisherId, {
        page: 1,
        limit: 10,
      });
      expect(listed.forms[0]).toMatchObject({
        id: created.id,
        status: 'PUBLISHED',
        completedCompletions: 5,
        escrowLocked: 150,
        closeKind: null,
      });
      expect(
        (await escrowService.getFormById(created.id, owner)).escrowLocked,
      ).toBe(150);

      await escrowService.closeForm(created.id, owner);
      const closed = await escrowService.listForms(publisherId, {
        page: 1,
        limit: 10,
      });
      expect(closed.forms[0]).toMatchObject({
        status: 'CLOSED',
        closeKind: 'OWNER',
        escrowLocked: 0,
      });
    });

    it('replays the created survey for the same key: same id and code, one Escrow lock', async () => {
      const first = await escrowService.createExternalSurvey(
        publisherId,
        externalBody,
        'wizard-key-0001',
      );
      const replay = await escrowService.createExternalSurvey(
        publisherId,
        { ...externalBody },
        'wizard-key-0001',
      );

      expect(first.idempotentReplay).toBeUndefined();
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.id).toBe(first.id);
      expect(replay.plaintextCompletionCode).toBe(
        first.plaintextCompletionCode,
      );
      expect(replay.currentVersion.completionCode).toBeNull();
      const stored = await repository.findById(first.id);
      expect(
        completionCodeService.verifyCode(
          stored!.currentVersion.id,
          first.plaintextCompletionCode,
          stored!.currentVersion.completionCode,
        ),
      ).toBe(true);
      expect(
        (
          await repository.findManyByPublisher({
            publisherId,
            page: 1,
            limit: 10,
          })
        ).total,
      ).toBe(1);
      const wallet = await ledgerService.getWallet(publisherId);
      expect(wallet.balance.escrow).toBe(200);
      expect(wallet.balance.available).toBe(800);
    });

    it('refuses the same key with a different body (409 DIFFERENT_REQUEST)', async () => {
      const first = await escrowService.createExternalSurvey(
        publisherId,
        externalBody,
        'wizard-key-0002',
      );

      const error = await escrowService
        .createExternalSurvey(
          publisherId,
          { ...externalBody, expectedCompletions: 30 },
          'wizard-key-0002',
        )
        .catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(IdempotencyKeyConflictException);
      expect(error).toMatchObject({
        reason: 'DIFFERENT_REQUEST',
        formId: first.id,
      });
      expect((await ledgerService.getWallet(publisherId)).balance.escrow).toBe(
        200,
      );
    });

    it('scopes keys per Publisher and derives different codes per key', async () => {
      const mine = await escrowService.createExternalSurvey(
        publisherId,
        { ...externalBody, autoPublish: false },
        'shared-key-0003',
      );
      const theirs = await escrowService.createExternalSurvey(
        otherUserId,
        { ...externalBody, autoPublish: false },
        'shared-key-0003',
      );
      const another = await escrowService.createExternalSurvey(
        publisherId,
        { ...externalBody, autoPublish: false },
        'other-key-0004',
      );

      expect(theirs.id).not.toBe(mine.id);
      expect(theirs.idempotentReplay).toBeUndefined();
      expect(another.plaintextCompletionCode).not.toBe(
        mine.plaintextCompletionCode,
      );
    });

    it('refuses to replay a stale code after the survey was rotated (409 SURVEY_CHANGED)', async () => {
      const body = { ...externalBody, autoPublish: false };
      const created = await escrowService.createExternalSurvey(
        publisherId,
        body,
        'wizard-key-0005',
      );
      await escrowService.rotateCompletionCode(created.id, owner);

      await expect(
        escrowService.createExternalSurvey(
          publisherId,
          body,
          'wizard-key-0005',
        ),
      ).rejects.toMatchObject({ reason: 'SURVEY_CHANGED', formId: created.id });
    });

    it('replays the winner, not INSUFFICIENT_BALANCE, when the balance covered only the winner (M-3)', async () => {
      // 90 x 10 = 900 of the 1000 available: a second reservation cannot fit.
      const body = { ...externalBody, expectedCompletions: 90 };
      const winner = await escrowService.createExternalSurvey(
        publisherId,
        body,
        'race-key-0007',
      );
      // The loser read the key before the winner committed.
      jest.spyOn(repository, 'findByCreationKey').mockResolvedValueOnce(null);

      const loser = await escrowService.createExternalSurvey(
        publisherId,
        body,
        'race-key-0007',
      );

      expect(loser.idempotentReplay).toBe(true);
      expect(loser.id).toBe(winner.id);
      expect(loser.plaintextCompletionCode).toBe(
        winner.plaintextCompletionCode,
      );
      const wallet = await ledgerService.getWallet(publisherId);
      expect(wallet.balance.escrow).toBe(900);
      expect(wallet.balance.available).toBe(100);
      // Without a key-owned survey, the shortfall is still reported.
      await expect(
        escrowService.createExternalSurvey(publisherId, body, 'other-key-0008'),
      ).rejects.toBeInstanceOf(InsufficientEscrowBalanceException);
    });

    it('converges concurrent requests with the same key on one survey', async () => {
      const body = { ...externalBody, autoPublish: false };
      const [a, b] = await Promise.all([
        escrowService.createExternalSurvey(publisherId, body, 'race-key-0006'),
        escrowService.createExternalSurvey(publisherId, body, 'race-key-0006'),
      ]);

      expect(a.id).toBe(b.id);
      expect(a.plaintextCompletionCode).toBe(b.plaintextCompletionCode);
      expect([a.idempotentReplay, b.idempotentReplay]).toContain(true);
      expect(
        (
          await repository.findManyByPublisher({
            publisherId,
            page: 1,
            limit: 10,
          })
        ).total,
      ).toBe(1);
    });
  });
});
