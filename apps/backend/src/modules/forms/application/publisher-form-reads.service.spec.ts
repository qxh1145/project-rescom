import { randomUUID } from 'crypto';
import {
  publisherFormVersionDetailSchema,
  publisherProgressSchema,
} from '@rescom/schemas';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../../economy/application/ledger.service';
import { FormsEscrowCoordinator } from './forms-escrow.coordinator';
import { PublisherFormReadsService } from './publisher-form-reads.service';
import { FormsService } from './forms.service';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import {
  FormNotFoundException,
  FormVersionNotFoundException,
} from './exceptions/form.exceptions';

describe('Story IR.4a: PublisherFormReadsService (FR-39)', () => {
  const publisherId = '11111111-1111-4111-8111-111111111111';
  const otherUserId = '44444444-4444-4444-8444-444444444444';
  const respondentId = '66666666-6666-4666-8666-666666666666';
  const formId = '22222222-2222-4222-8222-222222222222';
  const v1Id = '33333333-3333-4333-8333-333333333331';
  const v2Id = '33333333-3333-4333-8333-333333333332';
  // 2026-10-01 00:00 local (UTC+7): a day, week and month boundary.
  const NOW = new Date('2026-09-30T17:00:00Z');

  let formRepo: InMemoryFormRepository;
  let ledgerService: LedgerService;
  let coordinator: FormsEscrowCoordinator;
  let service: PublisherFormReadsService;

  const schema = {
    title: 'Survey',
    blocks: [
      { id: 'q1', type: 'text', title: 'Tên', order: 0, required: true },
    ],
    metadata: { expectedEffortSeconds: 60 },
  } as any;

  function makeForm(
    overrides: {
      type?: 'INTERNAL' | 'EXTERNAL';
      status?: FormEntity['status'];
      reward?: number;
      expected?: number;
    } = {},
  ): FormEntity {
    return new FormEntity(
      formId,
      publisherId,
      overrides.type ?? 'EXTERNAL',
      overrides.status ?? 'PUBLISHED',
      'Survey',
      null,
      overrides.reward ?? 10,
      overrides.expected ?? 50,
      new Date('2026-09-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
    );
  }

  function makeVersion(id: string, versionNumber: number): FormVersionEntity {
    return new FormVersionEntity(
      id,
      formId,
      versionNumber,
      schema,
      { ageRange: { min: 18, max: 25 } } as any,
      true,
      null,
      'SECRET-CODE',
      new Date('2026-09-02T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
    );
  }

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    ledgerService = new LedgerService(new InMemoryLedgerRepository());
    coordinator = new FormsEscrowCoordinator(formRepo, ledgerService);
    service = new PublisherFormReadsService(formRepo, coordinator, () => NOW);
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
      idempotencyKey: 'seed-publisher-1000',
      description: 'Initial balance',
    });
  });

  describe('getProgress', () => {
    it('returns the owner shape with zero-filled day buckets and a parsable DTO', async () => {
      const form = makeForm({ type: 'INTERNAL', reward: 0 });
      await formRepo.create(form, makeVersion(v1Id, 1));
      formRepo.setCompletedResponsesCount(formId, 3);
      formRepo.setCompletionTimes(formId, [
        { submittedAt: new Date('2026-09-30T16:59:59Z'), external: false },
        { submittedAt: new Date('2026-09-30T17:00:00Z'), external: false },
        { submittedAt: new Date('2026-09-20T00:00:00Z'), external: false },
      ]);

      const progress = await service.getProgress(
        formId,
        { userId: publisherId },
        'day',
      );

      expect(publisherProgressSchema.parse(progress)).toEqual(progress);
      expect(progress).toMatchObject({
        formId,
        status: 'PUBLISHED',
        completed: 3,
        expected: 50,
        pointsSpent: 0,
        escrowRemaining: 0,
        deadlineAt: null,
        pendingAttempts: null,
      });
      expect(progress.completionsSeries.buckets).toHaveLength(7);
      expect(
        progress.completionsSeries.buckets.map((bucket) => bucket.count),
      ).toEqual([0, 0, 0, 0, 0, 1, 1]);
      expect(progress.completionsSeries.total).toBe(2);
      expect(progress.completionsSeries.buckets[6].startsAt).toBe(
        '2026-09-30T17:00:00.000Z',
      );
    });

    it.each(['hour', 'week', 'month'] as const)(
      'zero-fills the %s range',
      async (range) => {
        await formRepo.create(makeForm({ reward: 0 }), makeVersion(v1Id, 1));
        const progress = await service.getProgress(
          formId,
          { userId: publisherId },
          range,
        );
        const expected = { hour: 8, week: 4, month: 6 }[range];
        expect(progress.completionsSeries.buckets).toHaveLength(expected);
        expect(progress.completionsSeries.total).toBe(0);
      },
    );

    it('anybody but the owner gets FORM_NOT_FOUND, an Admin included (the role is never consulted)', async () => {
      await formRepo.create(makeForm(), makeVersion(v1Id, 1));
      await expect(
        service.getProgress(formId, { userId: otherUserId }, 'day'),
      ).rejects.toBeInstanceOf(FormNotFoundException);
      await expect(
        service.getProgress(randomUUID(), { userId: publisherId }, 'day'),
      ).rejects.toBeInstanceOf(FormNotFoundException);
    });

    it('a DRAFT or queued survey returns zeros, not an error', async () => {
      for (const status of ['DRAFT', 'MODERATION_QUEUE'] as const) {
        formRepo.clear();
        await formRepo.create(makeForm({ status }), makeVersion(v1Id, 1));
        const progress = await service.getProgress(
          formId,
          { userId: publisherId },
          'day',
        );
        expect(progress).toMatchObject({
          status,
          completed: 0,
          pointsSpent: 0,
          escrowRemaining: 0,
        });
      }
    });

    it('ledger invariant: spent + remaining + refunded + owed × draw == reserved; reversed credits are not spent', async () => {
      const form = makeForm({ type: 'EXTERNAL', reward: 10, expected: 50 });
      const version = makeVersion(v1Id, 1);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId); // 500

      const paid: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const attemptId = randomUUID();
        await ledgerService.creditPendingReward({
          attemptId,
          publisherId,
          respondentId,
          amount: 10,
        });
        paid.push(attemptId);
      }
      const reversed = await ledgerService.findJournalByIdempotencyKey(
        `external-completion:${paid[0]}`,
      );
      await ledgerService.reverseJournal({ targetJournalId: reversed!.id });
      const owed = randomUUID(); // completed, credit not posted yet
      formRepo.setRewardableCompletions(formId, {
        completedCount: 5,
        internalResponses: [],
        externalAttemptIds: [...paid, owed],
      });
      formRepo.setCompletionTimes(formId, [
        { submittedAt: new Date(NOW.getTime() - 3_600_000), external: true },
        {
          submittedAt: new Date(NOW.getTime() - 47 * 3_600_000),
          external: true,
        },
        {
          submittedAt: new Date(NOW.getTime() - 49 * 3_600_000),
          external: true,
        },
      ]);

      const progress = await service.getProgress(
        formId,
        { userId: publisherId },
        'day',
      );
      const funding = await coordinator.getFundingPosition(form, publisherId);

      expect(progress.pointsSpent).toBe(30);
      expect(progress.escrowRemaining).toBe(funding.held);
      // reserved 500 = spent 30 + remaining 460 + refunded 0 + owed 1 × 10
      expect(progress.pointsSpent + progress.escrowRemaining + 0 + 10).toBe(
        500,
      );
      expect(progress.pendingAttempts).toBe(2);
    });

    it('returns the stored deadline (forms.deadline_at)', async () => {
      const form = makeForm({ reward: 0 }).copyWith({
        deadlineAt: new Date('2026-10-14T16:59:59Z'),
      });
      await formRepo.create(form, makeVersion(v1Id, 1));
      const progress = await service.getProgress(
        formId,
        { userId: publisherId },
        'day',
      );
      expect(progress.deadlineAt).toBe('2026-10-14T16:59:59.000Z');
    });
  });

  describe('getVersionDetail', () => {
    it('returns one version by explicit projection (no completionCode / targetingJson)', async () => {
      await formRepo.create(makeForm(), makeVersion(v1Id, 1));
      await formRepo.createVersion(
        formId,
        v2Id,
        new Date('2026-09-10T00:00:00Z'),
      );

      const detail = await service.getVersionDetail(formId, v1Id, {
        userId: publisherId,
      });

      expect(publisherFormVersionDetailSchema.parse(detail)).toEqual(detail);
      expect(detail).toMatchObject({
        id: v1Id,
        formId,
        versionNumber: 1,
        isPublished: true,
        externalUrl: null,
      });
      expect(detail.schemaJson.blocks).toHaveLength(1);
      expect(JSON.stringify(detail)).not.toContain('SECRET-CODE');
      expect(detail).not.toHaveProperty('targetingJson');
    });

    it('drops malformed draft blocks so the detail always parses', async () => {
      const draft = new FormVersionEntity(
        v2Id,
        formId,
        1,
        {
          title: 'Draft',
          blocks: [
            { id: 'q1', type: 'text', title: 'Tên', order: 0 },
            { type: 'text', title: 'no id' },
            null,
            'junk',
          ],
        } as any,
        null,
        false,
        null,
        null,
        null,
        new Date('2026-09-01T00:00:00Z'),
      );
      await formRepo.create(makeForm({ status: 'DRAFT' }), draft);
      const detail = await service.getVersionDetail(formId, v2Id, {
        userId: publisherId,
      });
      expect(detail.schemaJson.blocks.map((block) => block.id)).toEqual(['q1']);
    });

    it('404s for a version of another form, and for a non-owner', async () => {
      await formRepo.create(makeForm(), makeVersion(v1Id, 1));
      await expect(
        service.getVersionDetail(formId, randomUUID(), { userId: publisherId }),
      ).rejects.toBeInstanceOf(FormVersionNotFoundException);
      await expect(
        service.getVersionDetail(formId, v1Id, { userId: otherUserId }),
      ).rejects.toBeInstanceOf(FormNotFoundException);
    });
  });

  describe('GET /forms/:id management facts (mock-off plan Phase 3)', () => {
    const owner = { userId: publisherId, role: 'PUBLISHER' };

    it('a moderation-rejected survey carries its rejection and close time', async () => {
      const closedAt = new Date('2026-09-25T08:00:00Z');
      const form = makeForm({ status: 'MODERATION_QUEUE', reward: 0 }).close(
        'MODERATION',
        closedAt,
      );
      await formRepo.create(form, makeVersion(v1Id, 1));
      formRepo.setRejection(formId, {
        reason: 'Thiếu mô tả mục đích',
        refundAmount: 120,
        decidedAt: closedAt,
      });

      const detail = await new FormsService(formRepo).getFormById(
        formId,
        owner,
      );

      expect(detail).toMatchObject({
        status: 'CLOSED',
        closeKind: 'MODERATION',
        closedAt: closedAt.toISOString(),
        submittedAt: null,
        rejection: {
          reason: 'Thiếu mô tả mục đích',
          refundAmount: 120,
          decidedAt: closedAt.toISOString(),
        },
      });
    });

    it('an owner close has no rejection; a queued survey has its queue-entry time', async () => {
      const closed = makeForm({ reward: 0 }).close(
        'OWNER',
        new Date('2026-09-26T00:00:00Z'),
      );
      await formRepo.create(closed, makeVersion(v1Id, 1));
      formRepo.setRejection(formId, {
        reason: 'stale',
        refundAmount: 1,
        decidedAt: new Date(),
      });
      const service = new FormsService(formRepo);
      expect(await service.getFormById(formId, owner)).toMatchObject({
        closedAt: '2026-09-26T00:00:00.000Z',
        rejection: null,
      });

      formRepo.clear();
      await formRepo.create(
        makeForm({ status: 'MODERATION_QUEUE', reward: 0 }),
        makeVersion(v1Id, 1),
      );
      expect(await service.getFormById(formId, owner)).toMatchObject({
        submittedAt: '2026-09-01T00:00:00.000Z',
        closedAt: null,
        rejection: null,
      });
    });
  });
});
