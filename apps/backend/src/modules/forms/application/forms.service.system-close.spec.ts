import { RESERVATION_EXPIRY_MS } from '@rescom/schemas';
import { DEADLINE_CLOSE_GRACE_MS, FormsService } from './forms.service';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { FormsEscrowCoordinator } from './forms-escrow.coordinator';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import {
  FormNotReopenableException,
  FormValidationException,
} from './exceptions/form.exceptions';

/**
 * Story IR.2b (deadline write path, deadline close, reopen after a deadline)
 * and plan 2.2 (topic) / 2.3 (QUOTA close) on `FormsService`.
 */
describe('FormsService system closes, deadline and topic', () => {
  const publisherId = '11111111-1111-4111-8111-111111111111';
  const now = new Date('2026-10-01T12:00:00.000Z');
  let repository: InMemoryFormRepository;
  let escrow: Record<string, jest.Mock>;
  let publisher: { publish: jest.Mock };
  let unitOfWork: PassThroughUnitOfWork;
  let service: FormsService;

  beforeEach(() => {
    jest.useFakeTimers({ now, doNotFake: ['setImmediate', 'nextTick'] });
    repository = new InMemoryFormRepository();
    escrow = {
      coordinateClose: jest.fn().mockResolvedValue({
        refundJournalId: 'j1',
        refundIdempotencyKey: 'close-refund:x:c1',
        refundAmount: 40,
        unusedCompletions: 4,
      }),
      coordinateReopen: jest
        .fn()
        .mockResolvedValue({ reopenJournalId: null, additionalCost: 0 }),
      getFundingPosition: jest
        .fn()
        .mockResolvedValue({ required: 0, held: 0, shortfall: 0 }),
      getHeldEscrowByForm: jest.fn().mockResolvedValue(new Map()),
    };
    publisher = { publish: jest.fn().mockResolvedValue('CREATED') };
    unitOfWork = new PassThroughUnitOfWork();
    service = new FormsService(
      repository,
      undefined,
      escrow as unknown as FormsEscrowCoordinator,
      unitOfWork,
      publisher,
    );
  });

  afterEach(() => jest.useRealTimers());

  async function seedForm(
    over: {
      status?: FormEntity['status'];
      deadlineAt?: Date | null;
      closeKind?: FormEntity['closeKind'];
      expectedCompletions?: number;
    } = {},
  ): Promise<FormEntity> {
    const id = `00000000-0000-4000-8000-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, '0')}`;
    const form = new FormEntity(
      id,
      publisherId,
      'EXTERNAL',
      over.status ?? 'PUBLISHED',
      'Survey',
      null,
      10,
      over.expectedCompletions ?? 10,
      now,
      now,
      undefined,
      over.status === 'CLOSED' ? 1 : 0,
      5,
      over.closeKind ?? null,
      over.deadlineAt ?? null,
      'IT',
    );
    const version = new FormVersionEntity(
      `${id.slice(0, -1)}v`.replace(/v$/, '9'),
      id,
      1,
      {
        schemaVersion: 1,
        title: 'Survey',
        blocks: [],
        settings: {},
        metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
      } as never,
      null,
      true,
      'https://docs.google.com/forms/d/e/x/viewform',
      null,
      now,
      now,
    );
    return (await repository.create(form, version)).form;
  }

  describe('deadline close (Task 9.4, AC5)', () => {
    it('closes past the grace window with close kind DEADLINE, refunds and notifies once', async () => {
      const form = await seedForm({
        deadlineAt: new Date(now.getTime() - DEADLINE_CLOSE_GRACE_MS),
      });

      const result = await service.closeFormAtDeadline(form.id, now);

      expect(result).toEqual({
        closed: true,
        refundAmount: 40,
        refundIdempotencyKey: 'close-refund:x:c1',
      });
      const stored = (await repository.findById(form.id))!.form;
      expect(stored).toMatchObject({
        status: 'CLOSED',
        closeKind: 'DEADLINE',
        closeCount: 1,
      });
      expect(unitOfWork.keys).toEqual([`close-refund:${form.id}:c1`]);
      expect(escrow.coordinateClose).toHaveBeenCalledWith(
        expect.objectContaining({ id: form.id, closeCount: 1 }),
        publisherId,
      );
      expect(publisher.publish).toHaveBeenCalledWith({
        userId: publisherId,
        type: 'ESCROW_RELEASED',
        message: expect.stringContaining('40 unused points'),
        dedupeKey: `deadline-close:${form.id}:c1`,
      });

      // Re-run: nothing more.
      expect((await service.closeFormAtDeadline(form.id, now)).closed).toBe(
        false,
      );
      expect(escrow.coordinateClose).toHaveBeenCalledTimes(1);
    });

    it('waits one reservation window + 2 min past the deadline (T14 boundary)', async () => {
      const form = await seedForm({
        deadlineAt: new Date(now.getTime() - DEADLINE_CLOSE_GRACE_MS + 1),
      });
      expect(DEADLINE_CLOSE_GRACE_MS).toBe(RESERVATION_EXPIRY_MS + 120_000);
      expect((await service.closeFormAtDeadline(form.id, now)).closed).toBe(
        false,
      );
    });

    it('skips forms without a deadline, closed ones and drafts', async () => {
      const past = new Date(now.getTime() - DEADLINE_CLOSE_GRACE_MS - 1);
      const none = await seedForm();
      const closed = await seedForm({
        status: 'CLOSED',
        closeKind: 'OWNER',
        deadlineAt: past,
      });
      const draft = await seedForm({ status: 'DRAFT', deadlineAt: past });
      for (const form of [none, closed, draft]) {
        expect((await service.closeFormAtDeadline(form.id, now)).closed).toBe(
          false,
        );
      }
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('closes a survey still waiting in the moderation queue (Q2)', async () => {
      const form = await seedForm({
        status: 'MODERATION_QUEUE',
        deadlineAt: new Date(now.getTime() - DEADLINE_CLOSE_GRACE_MS),
      });
      expect((await service.closeFormAtDeadline(form.id, now)).closed).toBe(
        true,
      );
    });

    it('lists due forms oldest deadline first', async () => {
      const a = await seedForm({
        deadlineAt: new Date(now.getTime() - 3_600_000),
      });
      const b = await seedForm({
        deadlineAt: new Date(now.getTime() - 7_200_000),
      });
      await seedForm({ deadlineAt: new Date(now.getTime() + 3_600_000) });
      expect(await repository.findFormsPastDeadline(now, 10)).toEqual([
        b.id,
        a.id,
      ]);
    });
  });

  describe('QUOTA close (plan 2.3)', () => {
    it('is a no-op below the sample target', async () => {
      const form = await seedForm({ expectedCompletions: 3 });
      repository.setCompletedResponsesCount(form.id, 2);
      expect(await service.closeFormIfQuotaMet(form.id, now)).toEqual({
        closed: false,
        refundAmount: 0,
      });
      expect(escrow.coordinateClose).not.toHaveBeenCalled();
    });

    it('is a no-op for an Official survey past its expectedCompletions', async () => {
      const form = await seedForm({ expectedCompletions: 3 });
      await repository.update(form.copyWith({ isOfficial: true }));
      repository.setCompletedResponsesCount(form.id, 10);
      expect((await service.closeFormIfQuotaMet(form.id, now)).closed).toBe(
        false,
      );
      expect(escrow.coordinateClose).not.toHaveBeenCalled();
    });

    it('review HIGH-1: below the target it reads only the quota state (no form, versions or completion refs)', async () => {
      const stub = {
        findQuotaState: jest.fn().mockResolvedValue({
          status: 'PUBLISHED',
          expectedCompletions: 10,
          completedCount: 9,
        }),
        findById: jest.fn(),
        findAllVersions: jest.fn(),
        listRewardableCompletions: jest.fn(),
      };
      const cheap = new FormsService(
        stub as never,
        undefined,
        escrow as unknown as FormsEscrowCoordinator,
        unitOfWork,
      );
      expect(await cheap.closeFormIfQuotaMet('f', now)).toEqual({
        closed: false,
        refundAmount: 0,
      });
      expect(stub.findQuotaState).toHaveBeenCalledTimes(1);
      expect(stub.findById).not.toHaveBeenCalled();
      expect(stub.findAllVersions).not.toHaveBeenCalled();
      expect(stub.listRewardableCompletions).not.toHaveBeenCalled();
      expect(escrow.coordinateClose).not.toHaveBeenCalled();
    });

    it('a system close never moves updatedAt backwards (review LOW-9)', async () => {
      const form = await seedForm({ expectedCompletions: 1 });
      repository.setCompletedResponsesCount(form.id, 1);
      const earlier = new Date(now.getTime() - 60_000);
      await service.closeFormIfQuotaMet(form.id, earlier);
      const stored = (await repository.findById(form.id))!.form;
      expect(stored.updatedAt.getTime()).toBe(form.updatedAt.getTime() + 1);
    });

    it('closes with close kind QUOTA through the refunding close path once the target is met', async () => {
      const form = await seedForm({ expectedCompletions: 3 });
      repository.setCompletedResponsesCount(form.id, 3);

      expect(await service.closeFormIfQuotaMet(form.id, now)).toEqual({
        closed: true,
        refundAmount: 40,
      });
      const stored = (await repository.findById(form.id))!.form;
      expect(stored).toMatchObject({ status: 'CLOSED', closeKind: 'QUOTA' });
      expect(unitOfWork.keys).toEqual([`close-refund:${form.id}:c1`]);
      // A second call (the concurrent last completion) closes nothing more.
      expect((await service.closeFormIfQuotaMet(form.id, now)).closed).toBe(
        false,
      );
      expect(escrow.coordinateClose).toHaveBeenCalledTimes(1);
      // No Publisher notice for a QUOTA close (the list shows "Đủ mẫu").
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('a QUOTA close is not reopenable (SAMPLE_TARGET_REACHED)', async () => {
      const form = await seedForm({ status: 'CLOSED', closeKind: 'QUOTA' });
      await expect(
        service.reopenForm(
          form.id,
          { userId: publisherId, role: 'PUBLISHER' },
          {
            additionalCompletions: 5,
          },
        ),
      ).rejects.toMatchObject({
        constructor: FormNotReopenableException,
        reason: 'SAMPLE_TARGET_REACHED',
      });
    });
  });

  describe('reopen after a deadline (Q3)', () => {
    const owner = { userId: publisherId, role: 'PUBLISHER' };

    it('requires a new deadline (or null) once the deadline passed', async () => {
      const form = await seedForm({
        status: 'CLOSED',
        closeKind: 'DEADLINE',
        deadlineAt: new Date(now.getTime() - 86_400_000),
      });
      await expect(
        service.reopenForm(form.id, owner, { additionalCompletions: 5 }),
      ).rejects.toMatchObject({ code: 'FORM_DEADLINE_REQUIRED' });

      const reopened = await service.reopenForm(form.id, owner, {
        additionalCompletions: 5,
        deadlineAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      });
      expect(reopened).toMatchObject({
        status: 'PUBLISHED',
        expectedCompletions: 15,
        deadlineAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(),
      });
    });

    it('accepts null (no deadline) and rejects a deadline less than 1 h ahead', async () => {
      const form = await seedForm({
        status: 'CLOSED',
        closeKind: 'DEADLINE',
        deadlineAt: new Date(now.getTime() - 1),
      });
      await expect(
        service.reopenForm(form.id, owner, {
          additionalCompletions: 1,
          deadlineAt: new Date(now.getTime() + 60_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(FormValidationException);
      const reopened = await service.reopenForm(form.id, owner, {
        additionalCompletions: 1,
        deadlineAt: null,
      });
      expect(reopened.deadlineAt).toBeNull();
    });
  });

  describe('deadline + topic write path (Q1, plan 2.2)', () => {
    it('stores and returns topic and deadline on draft create; rejects a deadline out of window', async () => {
      const deadlineAt = new Date(
        now.getTime() + 14 * 86_400_000,
      ).toISOString();
      const draft = await service.createDraft(publisherId, {
        title: 'T',
        topic: 'MENTAL_HEALTH',
        deadlineAt,
      });
      expect(draft).toMatchObject({ topic: 'MENTAL_HEALTH', deadlineAt });

      await expect(
        service.createDraft(publisherId, {
          deadlineAt: new Date(now.getTime() + 181 * 86_400_000).toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'FORM_DEADLINE_INVALID' });
    });

    it('draft update sets and clears them', async () => {
      const draft = await service.createDraft(publisherId, { title: 'T' });
      const updated = await service.updateDraft(
        draft.id,
        { userId: publisherId, role: 'PUBLISHER' },
        {
          clientUpdatedAt: draft.updatedAt,
          topic: 'ARTS_MUSIC',
          deadlineAt: new Date(now.getTime() + 3_600_000).toISOString(),
        },
      );
      expect(updated.topic).toBe('ARTS_MUSIC');
      jest.setSystemTime(now.getTime() + 1);
      const cleared = await service.updateDraft(
        draft.id,
        { userId: publisherId, role: 'PUBLISHER' },
        { clientUpdatedAt: updated.updatedAt, topic: null, deadlineAt: null },
      );
      expect(cleared).toMatchObject({ topic: null, deadlineAt: null });
    });

    it('list items carry topic and deadline', async () => {
      const deadline = new Date(now.getTime() + 86_400_000);
      await seedForm({ deadlineAt: deadline });
      const list = await service.listForms(publisherId, { page: 1, limit: 20 });
      expect(list.forms[0]).toMatchObject({
        topic: 'IT',
        deadlineAt: deadline.toISOString(),
      });
    });

    it('marks a survey past its deadline', async () => {
      const form = await seedForm({ deadlineAt: now });
      expect(form.isPastDeadline(now)).toBe(true);
      expect(form.isPastDeadline(new Date(now.getTime() - 1))).toBe(false);
    });
  });
});
