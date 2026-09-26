import {
  FormBlock,
  moderationQueueListSchema,
  moderationSurveyPreviewSchema,
} from '@rescom/schemas';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { InMemoryFormRepository } from '../../forms/infrastructure/in-memory-form.repository';
import { FormsService } from '../../forms/application/forms.service';
import { FormsEscrowCoordinator } from '../../forms/application/forms-escrow.coordinator';
import { FormModerationCommands } from '../../forms/application/form-moderation.commands';
import { CompletionCodeService } from '../../forms/infrastructure/completion-code.service';
import type { EnvService } from '../../../common/config/env.service';
import {
  FormNotFoundException,
  ModerationEscrowNotFundedException,
} from '../../forms/application/exceptions/form.exceptions';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../../economy/application/ledger.service';
import {
  CapabilitySourceUser,
  InMemoryAdminCapabilityRepository,
} from '../../economy/infrastructure/in-memory-admin-capability.repository';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import { InMemorySurveyModerationRepository } from '../infrastructure/in-memory-survey-moderation.repository';
import {
  RESUBMISSION_REJECTION_WARNING,
  SurveyModerationService,
} from './survey-moderation.service';
import {
  FormNotInModerationQueueException,
  InvalidModerationRequestException,
  ModerationAdminCapabilityRequiredException,
  ModerationAlreadyDecidedException,
  ModerationSelfReviewForbiddenException,
  ModerationVersionMismatchException,
} from './exceptions/moderation.exceptions';

const TEST_COMPLETION_CODE_ENV = {
  completionCodeHmacSecret: 'unit_test_completion_code_hmac_secret_0123456789',
} as EnvService;

describe('Story 8.1: SurveyModerationService', () => {
  const publisherId = '11111111-1111-4111-8111-111111111111';
  const adminId = '22222222-2222-4222-8222-222222222222';
  const otherAdminId = '33333333-3333-4333-8333-333333333333';
  const correlationId = '44444444-4444-4444-8444-444444444444';
  const decidedAt = new Date('2026-09-26T15:00:00.000Z');
  const block: FormBlock = {
    id: 'q-1',
    type: 'text',
    order: 0,
    title: 'Bạn học ngành gì?',
    required: true,
  };

  let formRepo: InMemoryFormRepository;
  let ledgerService: LedgerService;
  let formsService: FormsService;
  let decisions: InMemorySurveyModerationRepository;
  let unitOfWork: PassThroughUnitOfWork;
  let users: Map<string, CapabilitySourceUser>;
  let publish: jest.Mock;
  let service: SurveyModerationService;
  let ids: number;

  beforeEach(async () => {
    ids = 0;
    formRepo = new InMemoryFormRepository();
    ledgerService = new LedgerService(new InMemoryLedgerRepository());
    const escrow = new FormsEscrowCoordinator(formRepo, ledgerService);
    formsService = new FormsService(
      formRepo,
      new CompletionCodeService(TEST_COMPLETION_CODE_ENV),
      escrow,
    );
    decisions = new InMemorySurveyModerationRepository();
    unitOfWork = new PassThroughUnitOfWork();
    users = new Map<string, CapabilitySourceUser>([
      [publisherId, { id: publisherId, role: 'RESPONDENT', status: 'ACTIVE' }],
      [adminId, { id: adminId, role: 'ADMIN', status: 'ACTIVE' }],
      [otherAdminId, { id: otherAdminId, role: 'ADMIN', status: 'ACTIVE' }],
    ]);
    publish = jest.fn().mockResolvedValue('CREATED');
    const notificationPublisher: NotificationPublisherPort = { publish };

    service = new SurveyModerationService({
      forms: new FormModerationCommands(formRepo, escrow),
      repository: decisions,
      adminCapability: new InMemoryAdminCapabilityRepository(
        async (userId) => users.get(userId) ?? null,
      ),
      publisherDirectory: {
        findEmails: async (userIds) =>
          new Map(
            userIds
              .filter((id) => id === publisherId || id === adminId)
              .map((id) => [id, `${id.slice(0, 4)}@fpt.edu.vn`]),
          ),
      },
      unitOfWork,
      notificationPublisher,
      generateId: () =>
        `99999999-9999-4999-8999-${String(++ids).padStart(12, '0')}`,
      now: () => decidedAt,
    });

    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    for (const userId of [publisherId, adminId]) {
      const available = await ledgerService.getOrCreateAccount(
        userId,
        'USER_AVAILABLE',
      );
      await ledgerService.transfer({
        fromAccountId: system.id,
        toAccountId: available.id,
        amount: 1000,
        idempotencyKey: `seed-${userId}`,
      });
    }
  });

  async function publishSurvey(
    title = 'Khảo sát thói quen học tập',
    owner = publisherId,
  ) {
    const draft = await formsService.createDraft(owner, {
      title,
      type: 'INTERNAL',
      rewardPerResponse: 10, // 8 effective
      expectedCompletions: 50, // 400 escrow
      // FR-14 band "< 5 min" (5–10 points), enforced at publish (E6-D2).
      estimatedDurationMinutes: 2,
      schema: {
        schemaVersion: 1,
        title,
        blocks: [block],
        metadata: { expectedEffortSeconds: 120, minTimeBarrierSeconds: 15 },
      },
    });
    const queued = await formsService.publishForm(draft.id, {
      userId: owner,
      role: 'RESPONDENT',
    });
    expect(queued.status).toBe('MODERATION_QUEUE');
    return queued;
  }

  describe('queue and preview (FR-20)', () => {
    it('lists queued surveys FIFO with preview data and publisher email', async () => {
      const first = await publishSurvey('First');
      await new Promise((resolve) => setTimeout(resolve, 2));
      const second = await publishSurvey('Second');

      const page = await service.listQueue({ limit: '1', offset: '0' });

      expect(page).toMatchObject({
        total: 2,
        limit: 1,
        offset: 0,
        hasMore: true,
      });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        formId: first.id,
        formVersionId: first.currentVersion.id,
        versionNumber: 1,
        title: 'First',
        type: 'INTERNAL',
        status: 'MODERATION_QUEUE',
        publisherId,
        publisherEmail: '1111@fpt.edu.vn',
        rewardPerResponse: 10,
        expectedCompletions: 50,
        effectiveRewardPerResponse: 8,
        escrowAmount: 400,
        estimatedEffortSeconds: 120,
        blocksCount: 1,
        externalUrl: null,
        targetingJson: null,
        targetingInvalid: false,
        isResubmission: false,
      });
      const next = await service.listQueue({ limit: 1, offset: 1 });
      expect(next.items[0].formId).toBe(second.id);
      expect(next.hasMore).toBe(false);
    });

    it('rejects invalid queue queries', async () => {
      await expect(service.listQueue({ limit: 0 })).rejects.toThrow(
        InvalidModerationRequestException,
      );
    });

    it('previews a survey with its Form Definition and no decision yet', async () => {
      const queued = await publishSurvey();

      const preview = await service.getSurvey(queued.id);

      expect(preview.formVersionId).toBe(queued.currentVersion.id);
      expect(preview.decision).toBeNull();
      expect((preview.schemaJson as { blocks: FormBlock[] }).blocks).toEqual([
        block,
      ]);
    });

    it('returns 404 for an unknown survey', async () => {
      await expect(
        service.getSurvey('55555555-5555-4555-8555-555555555555'),
      ).rejects.toThrow(FormNotFoundException);
    });

    /** A queued row written directly (legacy / corrupt data, no reservation). */
    async function seedQueuedRow(
      schemaJson: unknown,
      targetingJson: unknown = null,
    ) {
      const now = new Date('2026-09-26T08:00:00.000Z');
      const form = new FormEntity(
        '66666666-6666-4666-8666-666666666666',
        publisherId,
        'INTERNAL',
        'MODERATION_QUEUE',
        'Legacy row',
        null,
        10,
        50,
        now,
        now,
      );
      await formRepo.create(
        form,
        new FormVersionEntity(
          '77777777-7777-4777-8777-777777777777',
          form.id,
          1,
          schemaJson as never,
          targetingJson as never,
          false,
          null,
          null,
          null,
          now,
        ),
      );
      return form.id;
    }

    it('reports the Escrow held and the funding shortfall in the preview (review P2)', async () => {
      const funded = await publishSurvey('Funded');
      const fundedPreview = await service.getSurvey(funded.id);
      expect(fundedPreview).toMatchObject({
        escrowAmount: 400,
        escrowHeld: 400,
        fundingShortfall: 0,
      });
      expect(
        moderationSurveyPreviewSchema.safeParse(fundedPreview).success,
      ).toBe(true);

      const unfundedId = await seedQueuedRow({
        schemaVersion: 1,
        title: 'Legacy row',
        blocks: [block],
      });
      expect(await service.getSurvey(unfundedId)).toMatchObject({
        escrowAmount: 400,
        escrowHeld: 0,
        fundingShortfall: 400,
      });
      await expect(
        service.approve({
          formId: unfundedId,
          adminId,
          input: { formVersionId: '77777777-7777-4777-8777-777777777777' },
        }),
      ).rejects.toThrow(ModerationEscrowNotFundedException);
      expect(
        await decisions.findByFormVersionId(
          '77777777-7777-4777-8777-777777777777',
        ),
      ).toBeNull();
      expect(publish).not.toHaveBeenCalled();

      // Rejecting it closes it and refunds what it holds (nothing).
      const rejected = await service.reject({
        formId: unfundedId,
        adminId,
        input: {
          formVersionId: '77777777-7777-4777-8777-777777777777',
          reason: 'Chưa ký quỹ đủ',
        },
      });
      expect(rejected.decision.refundAmount).toBe(0);
      const decided = await service.getSurvey(unfundedId);
      expect(decided.escrowHeld).toBeNull();
      expect(decided.fundingShortfall).toBeNull();
    });

    it('flags an invalid stored row instead of breaking the whole queue (review P6)', async () => {
      await seedQueuedRow(
        {
          schemaVersion: 1,
          title: 'Legacy row',
          blocks: [block],
          metadata: { expectedEffortSeconds: 12.5 },
        },
        { locations: [1] },
      );

      const page = await service.listQueue({});

      expect(moderationQueueListSchema.safeParse(page).success).toBe(true);
      expect(page.items[0]).toMatchObject({
        targetingJson: null,
        targetingInvalid: true,
        estimatedEffortSeconds: 60,
      });
    });
  });

  describe('approve (MODERATION_QUEUE -> PUBLISHED)', () => {
    it('publishes the pinned version, records the decision + audit event and notifies', async () => {
      const queued = await publishSurvey();
      const versionId = queued.currentVersion.id;

      const result = await service.approve({
        formId: queued.id,
        adminId,
        input: { formVersionId: versionId, note: 'Nội dung phù hợp' },
        correlationId: correlationId.toUpperCase(),
      });

      expect(result.replayed).toBe(false);
      expect(result.form).toEqual({
        id: queued.id,
        status: 'PUBLISHED',
        currentVersionId: versionId,
        isPublished: true,
        publishedAt: decidedAt.toISOString(),
      });
      expect(result.decision).toMatchObject({
        formId: queued.id,
        formVersionId: versionId,
        versionNumber: 1,
        outcome: 'APPROVED',
        adminId,
        reason: 'Nội dung phù hợp',
        refundAmount: 0,
        refundJournalId: null,
        correlationId,
        decidedAt: decidedAt.toISOString(),
      });
      expect(unitOfWork.keys).toContain(`moderation:${versionId}`);

      const stored = await formRepo.findById(queued.id);
      expect(stored?.form.status).toBe('PUBLISHED');
      expect(stored?.currentVersion.isPublished).toBe(true);
      expect(stored?.currentVersion.publishedAt).toEqual(decidedAt);
      // Approval keeps the Escrow locked for the respondents' rewards.
      expect((await ledgerService.getWallet(publisherId)).balance.escrow).toBe(
        400,
      );

      expect(decisions.outboxEvents).toHaveLength(1);
      expect(decisions.outboxEvents[0]).toMatchObject({
        idempotencyKey: `admin-audit:moderation:${versionId}`,
        eventType: 'AdminSurveyApproved',
        producer: 'moderation-service',
        aggregateType: 'Form',
        aggregateId: queued.id,
        aggregateVersion: 1,
        correlationId,
        payload: {
          schemaVersion: 1,
          auditCategory: 'MODERATION_ADMIN_ACTION',
          action: 'SURVEY_APPROVED',
          publisherId,
          adminId,
          refundAmount: 0,
          ledgerIdempotencyKey: null,
        },
      });

      expect(publish).toHaveBeenCalledWith({
        userId: publisherId,
        type: 'SURVEY_APPROVED',
        message: expect.stringContaining('approved'),
        dedupeKey: `moderation:${versionId}`,
      });
    });

    it('is idempotent: a replay returns the original decision without side effects', async () => {
      const queued = await publishSurvey();
      const input = { formVersionId: queued.currentVersion.id };
      const first = await service.approve({
        formId: queued.id,
        adminId,
        input,
      });

      const replay = await service.approve({
        formId: queued.id,
        adminId: otherAdminId,
        input,
      });

      expect(replay.replayed).toBe(true);
      expect(replay.decision).toEqual(first.decision);
      expect(decisions.allDecisions()).toHaveLength(1);
      expect(decisions.outboxEvents).toHaveLength(1);
      // Replays re-publish with the same dedupe key (the port deduplicates).
      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish.mock.calls[1][0].dedupeKey).toBe(
        publish.mock.calls[0][0].dedupeKey,
      );
    });

    it('generates a correlation id when none (or a non-UUID) is supplied', async () => {
      const queued = await publishSurvey();
      const result = await service.approve({
        formId: queued.id,
        adminId,
        input: { formVersionId: queued.currentVersion.id },
        correlationId: 'not-a-uuid',
      });
      expect(result.decision.correlationId).toMatch(/^99999999-/);
    });

    it('marks a re-submitted version as such and makes it the live version', async () => {
      const queued = await publishSurvey();
      await service.approve({
        formId: queued.id,
        adminId,
        input: { formVersionId: queued.currentVersion.id },
      });
      await formsService.createNewVersion(queued.id, {
        userId: publisherId,
        role: 'RESPONDENT',
      });
      const v2 = await formsService.publishForm(queued.id, {
        userId: publisherId,
        role: 'RESPONDENT',
      });
      expect(v2.status).toBe('MODERATION_QUEUE');
      expect(v2.currentVersion.versionNumber).toBe(2);

      const page = await service.listQueue({});
      expect(page.items[0]).toMatchObject({
        formVersionId: v2.currentVersion.id,
        versionNumber: 2,
        isResubmission: true,
      });

      const approved = await service.approve({
        formId: queued.id,
        adminId,
        input: { formVersionId: v2.currentVersion.id },
      });
      expect(approved.form.currentVersionId).toBe(v2.currentVersion.id);
      expect(approved.form.isPublished).toBe(true);
    });
  });

  describe('reject (MODERATION_QUEUE -> CLOSED + refund)', () => {
    it('closes the survey, refunds the full reservation, records and notifies', async () => {
      const queued = await publishSurvey();
      const versionId = queued.currentVersion.id;

      const result = await service.reject({
        formId: queued.id,
        adminId,
        input: {
          formVersionId: versionId,
          reason: '  Nội dung chứa liên kết quảng cáo  ',
        },
      });

      expect(result.form.status).toBe('CLOSED');
      expect(result.form.isPublished).toBe(false);
      expect(result.decision).toMatchObject({
        outcome: 'REJECTED',
        reason: 'Nội dung chứa liên kết quảng cáo',
        refundAmount: 400,
      });
      expect(result.decision.refundJournalId).not.toBeNull();
      const refundJournal = await ledgerService.findJournalByIdempotencyKey(
        `close-refund:${queued.id}:c1`,
      );
      expect(refundJournal?.id).toBe(result.decision.refundJournalId);

      const wallet = await ledgerService.getWallet(publisherId);
      expect(wallet.balance.escrow).toBe(0);
      expect(wallet.balance.available).toBe(1000);

      expect(decisions.outboxEvents[0]).toMatchObject({
        eventType: 'AdminSurveyRejected',
        payload: {
          action: 'SURVEY_REJECTED',
          reason: 'Nội dung chứa liên kết quảng cáo',
          refundAmount: 400,
          refundJournalId: result.decision.refundJournalId,
          ledgerIdempotencyKey: `close-refund:${queued.id}:c1`,
        },
      });
      expect(publish).toHaveBeenCalledWith({
        userId: publisherId,
        type: 'SURVEY_REJECTED',
        message: expect.stringMatching(
          /rejected.*Nội dung chứa liên kết quảng cáo.*400 escrowed points/,
        ),
        dedupeKey: `moderation:${versionId}`,
      });
    });

    describe('Decision E8-D2: rejecting a re-submission closes the live survey for good', () => {
      async function queuedResubmission(title?: string) {
        const queued = await publishSurvey(title);
        await service.approve({
          formId: queued.id,
          adminId,
          input: { formVersionId: queued.currentVersion.id },
        });
        await formsService.createNewVersion(queued.id, {
          userId: publisherId,
          role: 'RESPONDENT',
        });
        const v2 = await formsService.publishForm(queued.id, {
          userId: publisherId,
          role: 'RESPONDENT',
        });
        publish.mockClear();
        return v2;
      }

      function publishedMessage(): string {
        const [[command]] = publish.mock.calls as [[{ message: string }]];
        return command.message;
      }

      it('closes the whole survey (final) and warns the Publisher in SURVEY_REJECTED', async () => {
        const v2 = await queuedResubmission();

        const result = await service.reject({
          formId: v2.id,
          adminId,
          input: {
            formVersionId: v2.currentVersion.id,
            reason: 'Phiên bản mới chứa câu hỏi thu thập số điện thoại',
          },
        });

        expect(result.form.status).toBe('CLOSED');
        const stored = (await formRepo.findById(v2.id))!;
        expect(stored.form.closeKind).toBe('MODERATION');
        expect(stored.form.isReopenableByOwner()).toBe(false);
        const message = publishedMessage();
        expect(message).toContain('Your edited survey');
        expect(message).toContain('(version 2)');
        expect(message).toContain(RESUBMISSION_REJECTION_WARNING);
        expect(message).toContain(
          'Reason: Phiên bản mới chứa câu hỏi thu thập số điện thoại.',
        );
        expect(message).toMatch(/escrowed points were returned/);
      });

      it('keeps the warning and the refund within the 500-character budget (the reason is shortened)', async () => {
        const v2 = await queuedResubmission('t'.repeat(200));

        await service.reject({
          formId: v2.id,
          adminId,
          input: {
            formVersionId: v2.currentVersion.id,
            reason: 'r'.repeat(500),
          },
        });

        const message = publishedMessage();
        expect(message.length).toBeLessThanOrEqual(500);
        expect(message).toContain(RESUBMISSION_REJECTION_WARNING);
        expect(message).toMatch(/Reason: r+\.\.\.\./);
        expect(message).toMatch(
          /escrowed points were returned to your Available balance\.$/,
        );
      });

      it('repeats the warning when a rejection is replayed', async () => {
        const v2 = await queuedResubmission();
        const input = {
          formVersionId: v2.currentVersion.id,
          reason: 'Nội dung vi phạm',
        };
        await service.reject({ formId: v2.id, adminId, input });
        publish.mockClear();

        const replay = await service.reject({ formId: v2.id, adminId, input });

        expect(replay.replayed).toBe(true);
        expect(publishedMessage()).toContain(RESUBMISSION_REJECTION_WARNING);
      });

      it('does not warn for a first submission', async () => {
        const queued = await publishSurvey();
        await service.reject({
          formId: queued.id,
          adminId,
          input: {
            formVersionId: queued.currentVersion.id,
            reason: 'Spam survey',
          },
        });

        expect(publishedMessage()).not.toContain(
          RESUBMISSION_REJECTION_WARNING,
        );
      });
    });

    it('replays a rejection without refunding twice', async () => {
      const queued = await publishSurvey();
      const input = {
        formVersionId: queued.currentVersion.id,
        reason: 'Spam survey',
      };
      await service.reject({ formId: queued.id, adminId, input });

      const replay = await service.reject({
        formId: queued.id,
        adminId,
        input,
      });

      expect(replay.replayed).toBe(true);
      expect(replay.decision.refundAmount).toBe(400);
      const wallet = await ledgerService.getWallet(publisherId);
      expect(wallet.balance.available).toBe(1000);
      expect(decisions.outboxEvents).toHaveLength(1);
    });

    it('requires a reason of at least 5 characters', async () => {
      const queued = await publishSurvey();
      await expect(
        service.reject({
          formId: queued.id,
          adminId,
          input: { formVersionId: queued.currentVersion.id, reason: 'no' },
        }),
      ).rejects.toThrow(InvalidModerationRequestException);
      expect((await formRepo.findById(queued.id))?.form.status).toBe(
        'MODERATION_QUEUE',
      );
    });
  });

  describe('Epic 9 review P9: notification text never splits an emoji', () => {
    const loneSurrogate =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    function publishedMessage(): string {
      const [[command]] = publish.mock.calls as [[{ message: string }]];
      return command.message;
    }

    it('truncates a title whose emoji straddles the 80-character budget', async () => {
      const queued = await publishSurvey(`${'a'.repeat(76)}${'😀'.repeat(10)}`);

      await service.approve({
        formId: queued.id,
        adminId,
        input: { formVersionId: queued.currentVersion.id },
      });

      const message = publishedMessage();
      expect(message).toContain(`"${'a'.repeat(76)}..."`);
      expect(message).not.toMatch(loneSurrogate);
      expect(message.length).toBeLessThanOrEqual(500);
    });

    it('truncates a rejection reason whose emoji straddles its budget', async () => {
      const queued = await publishSurvey();

      await service.reject({
        formId: queued.id,
        adminId,
        input: {
          formVersionId: queued.currentVersion.id,
          reason: `${'b'.repeat(246)}${'😀'.repeat(20)}`,
        },
      });

      const message = publishedMessage();
      expect(message).toContain(`Reason: ${'b'.repeat(246)}....`);
      expect(message).not.toMatch(loneSurrogate);
      expect(message.length).toBeLessThanOrEqual(500);
    });
  });

  describe('conflicts and guards', () => {
    it('refuses the opposite decision once a version was decided', async () => {
      const approvedSurvey = await publishSurvey('A');
      await service.approve({
        formId: approvedSurvey.id,
        adminId,
        input: { formVersionId: approvedSurvey.currentVersion.id },
      });
      await expect(
        service.reject({
          formId: approvedSurvey.id,
          adminId,
          input: {
            formVersionId: approvedSurvey.currentVersion.id,
            reason: 'Changed my mind',
          },
        }),
      ).rejects.toThrow(ModerationAlreadyDecidedException);

      const rejectedSurvey = await publishSurvey('B');
      await service.reject({
        formId: rejectedSurvey.id,
        adminId,
        input: {
          formVersionId: rejectedSurvey.currentVersion.id,
          reason: 'Spam survey',
        },
      });
      await expect(
        service.approve({
          formId: rejectedSurvey.id,
          adminId,
          input: { formVersionId: rejectedSurvey.currentVersion.id },
        }),
      ).rejects.toThrow(ModerationAlreadyDecidedException);
      expect((await formRepo.findById(rejectedSurvey.id))?.form.status).toBe(
        'CLOSED',
      );
    });

    it('lets exactly one of a concurrent approve and reject win', async () => {
      const queued = await publishSurvey();
      const formVersionId = queued.currentVersion.id;

      const results = await Promise.allSettled([
        service.approve({
          formId: queued.id,
          adminId,
          input: { formVersionId },
        }),
        service.reject({
          formId: queued.id,
          adminId: otherAdminId,
          input: { formVersionId, reason: 'Concurrent reject' },
        }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(
        rejected[0].reason instanceof ModerationAlreadyDecidedException ||
          rejected[0].reason instanceof FormNotInModerationQueueException,
      ).toBe(true);
      expect(decisions.allDecisions()).toHaveLength(1);

      const winner = decisions.allDecisions()[0];
      const wallet = await ledgerService.getWallet(publisherId);
      const stored = await formRepo.findById(queued.id);
      if (winner.outcome === 'APPROVED') {
        expect(stored?.form.status).toBe('PUBLISHED');
        expect(wallet.balance.escrow).toBe(400);
      } else {
        expect(stored?.form.status).toBe('CLOSED');
        expect(wallet.balance.escrow).toBe(0);
      }
    });

    it.each([
      ['demoted to a normal user', { role: 'RESPONDENT', status: 'ACTIVE' }],
      ['locked', { role: 'ADMIN', status: 'LOCKED' }],
    ])(
      'rejects an actor who is %s (live capability)',
      async (_label, change) => {
        const queued = await publishSurvey();
        users.set(adminId, { id: adminId, ...change });

        await expect(
          service.approve({
            formId: queued.id,
            adminId,
            input: { formVersionId: queued.currentVersion.id },
          }),
        ).rejects.toThrow(ModerationAdminCapabilityRequiredException);
        expect((await formRepo.findById(queued.id))?.form.status).toBe(
          'MODERATION_QUEUE',
        );
      },
    );

    it('rejects an unknown actor', async () => {
      const queued = await publishSurvey();
      await expect(
        service.reject({
          formId: queued.id,
          adminId: '66666666-6666-4666-8666-666666666666',
          input: {
            formVersionId: queued.currentVersion.id,
            reason: 'Not allowed',
          },
        }),
      ).rejects.toThrow(ModerationAdminCapabilityRequiredException);
    });

    it('forbids an Admin from moderating their own survey', async () => {
      const own = await publishSurvey('Admin survey', adminId);
      await expect(
        service.approve({
          formId: own.id,
          adminId,
          input: { formVersionId: own.currentVersion.id },
        }),
      ).rejects.toThrow(ModerationSelfReviewForbiddenException);
    });

    it('refuses a decision on a version other than the queued one', async () => {
      const queued = await publishSurvey();
      await expect(
        service.approve({
          formId: queued.id,
          adminId,
          input: { formVersionId: '77777777-7777-4777-8777-777777777777' },
        }),
      ).rejects.toThrow(ModerationVersionMismatchException);
    });

    it('refuses to moderate a survey that is not queued', async () => {
      const draft = await formsService.createDraft(publisherId, {
        title: 'Still a draft',
      });
      await expect(
        service.approve({
          formId: draft.id,
          adminId,
          input: { formVersionId: draft.currentVersion.id },
        }),
      ).rejects.toThrow(FormNotInModerationQueueException);
    });

    it('returns 404 when approving an unknown survey', async () => {
      await expect(
        service.approve({
          formId: '88888888-8888-4888-8888-888888888888',
          adminId,
          input: { formVersionId: '77777777-7777-4777-8777-777777777777' },
        }),
      ).rejects.toThrow(FormNotFoundException);
    });

    it('refuses a replay addressed to a different survey id', async () => {
      const queued = await publishSurvey();
      await service.approve({
        formId: queued.id,
        adminId,
        input: { formVersionId: queued.currentVersion.id },
      });
      const other = await publishSurvey('Other');
      await expect(
        service.approve({
          formId: other.id,
          adminId,
          input: { formVersionId: queued.currentVersion.id },
        }),
      ).rejects.toThrow(ModerationVersionMismatchException);
    });

    it('works without a notification publisher', async () => {
      const bare = new SurveyModerationService({
        forms: new FormModerationCommands(formRepo),
        repository: decisions,
        adminCapability: new InMemoryAdminCapabilityRepository(
          async (userId) => users.get(userId) ?? null,
        ),
        publisherDirectory: { findEmails: async () => new Map() },
      });
      const queued = await publishSurvey();
      const result = await bare.approve({
        formId: queued.id,
        adminId,
        input: { formVersionId: queued.currentVersion.id },
      });
      expect(result.form.status).toBe('PUBLISHED');
    });
  });
});
