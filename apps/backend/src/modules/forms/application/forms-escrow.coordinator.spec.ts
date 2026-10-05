import { randomUUID } from 'crypto';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../../economy/application/ledger.service';
import { FormsEscrowCoordinator } from './forms-escrow.coordinator';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { InsufficientEscrowBalanceException } from '../../economy/application/exceptions/economy.exceptions';
import { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';

describe('Story 6.3: FormsEscrowCoordinator (FR-14, FR-15, FR-19, FR-32, FR-33)', () => {
  let formRepo: InMemoryFormRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let coordinator: FormsEscrowCoordinator;

  const publisherId = '11111111-1111-4111-8111-111111111111';
  const respondentId = '66666666-6666-4666-8666-666666666666';
  const formId = '22222222-2222-4222-8222-222222222222';
  const versionId = '33333333-3333-4333-8333-333333333333';
  const otherSurveyVersionId = '99999999-9999-4999-8999-999999999999';

  const mockSchema = {
    title: 'Test Form',
    blocks: [
      {
        id: 'block-1',
        type: 'SHORT_ANSWER',
        title: 'Your Name',
        order: 0,
        required: true,
      },
    ],
    metadata: {
      expectedEffortSeconds: 60,
      minTimeBarrierSeconds: 15,
    },
  } as any;

  function makeForm(overrides: {
    type?: 'INTERNAL' | 'EXTERNAL';
    status?: FormEntity['status'];
    reward?: number;
    expected?: number;
    closeCount?: number;
    title?: string;
  }): FormEntity {
    return new FormEntity(
      formId,
      publisherId,
      overrides.type ?? 'EXTERNAL',
      overrides.status ?? 'PUBLISHED',
      overrides.title ?? 'Escrow Survey',
      null,
      overrides.reward ?? 10,
      overrides.expected ?? 50,
      new Date(),
      new Date(),
      undefined,
      overrides.closeCount ?? 0,
    );
  }

  function makeVersion(
    id: string,
    versionNumber: number,
    isPublished: boolean,
  ): FormVersionEntity {
    return new FormVersionEntity(
      id,
      formId,
      versionNumber,
      mockSchema,
      null,
      isPublished,
      null,
      null,
      isPublished ? new Date() : null,
      new Date(),
    );
  }

  /** Completions the in-memory form repository reports (P4). */
  const completions = {
    guests: 0,
    internal: [] as Array<{ id: string; rewardable: boolean }>,
    external: [] as string[],
  };

  function syncCompletions(): void {
    formRepo.setRewardableCompletions(formId, {
      completedCount:
        completions.guests +
        completions.internal.filter((r) => r.rewardable).length +
        completions.external.length,
      internalResponses: [...completions.internal],
      externalAttemptIds: [...completions.external],
    });
  }

  /** Pays `count` real External completions through the ledger. */
  async function payExternal(count: number, reward: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const attemptId = randomUUID();
      await ledgerService.creditPendingReward({
        attemptId,
        publisherId,
        respondentId,
        amount: reward,
      });
      completions.external.push(attemptId);
      ids.push(attemptId);
    }
    syncCompletions();
    return ids;
  }

  async function escrowBalance(): Promise<number> {
    return (await ledgerService.getWallet(publisherId)).balance.escrow;
  }

  async function availableBalance(): Promise<number> {
    return (await ledgerService.getWallet(publisherId)).balance.available;
  }

  beforeEach(async () => {
    formRepo = new InMemoryFormRepository();
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo);
    coordinator = new FormsEscrowCoordinator(formRepo, ledgerService);
    completions.guests = 0;
    completions.internal = [];
    completions.external = [];

    // Seed publisher with 1000 available points from system issuance
    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const publisherAvail = await ledgerService.getOrCreateAccount(
      publisherId,
      'USER_AVAILABLE',
    );
    await ledgerService.transfer({
      fromAccountId: system.id,
      toAccountId: publisherAvail.id,
      amount: 1000,
      idempotencyKey: 'seed-publisher-1000',
      description: 'Initial balance',
    });
  });

  describe('getEscrowQuote (FR-14, FR-19)', () => {
    it('applies 20% discount for internal forms', () => {
      const quote = coordinator.getEscrowQuote({
        type: 'INTERNAL',
        expectedCompletions: 50,
        rewardPerResponse: 10,
      });

      expect(quote.type).toBe('INTERNAL');
      expect(quote.discountPercent).toBe(20);
      expect(quote.effectiveRewardPerResponse).toBe(8);
      expect(quote.baseCost).toBe(500);
      expect(quote.effectiveCost).toBe(400);
      expect(quote.discountAmount).toBe(100);
    });

    it('does not apply discount for external forms', () => {
      const quote = coordinator.getEscrowQuote({
        type: 'EXTERNAL',
        expectedCompletions: 50,
        rewardPerResponse: 10,
      });

      expect(quote.type).toBe('EXTERNAL');
      expect(quote.discountPercent).toBe(0);
      expect(quote.effectiveRewardPerResponse).toBe(10);
      expect(quote.baseCost).toBe(500);
      expect(quote.effectiveCost).toBe(500);
      expect(quote.discountAmount).toBe(0);
    });
  });

  describe('coordinatePublish (FR-15, AD-16)', () => {
    it('successfully locks discounted points into Escrow for internal form', async () => {
      const form = makeForm({ type: 'INTERNAL', status: 'DRAFT' });
      const version = makeVersion(versionId, 1, false);
      await formRepo.create(form, version);

      const result = await coordinator.coordinatePublish(
        form,
        version,
        publisherId,
      );

      expect(result.costCalculation.effectiveCost).toBe(400);
      expect(result.reservedAmount).toBe(400);
      expect(result.journalId).not.toBeNull();
      const journal = await ledgerService.findJournalByIdempotencyKey(
        `publish:${versionId}`,
      );
      expect(result.journalId).toBe(journal?.id);

      expect(await availableBalance()).toBe(600); // 1000 - 400
      expect(await escrowBalance()).toBe(400);
    });

    it('bypasses ledger transaction when effective cost is 0', async () => {
      const form = makeForm({ type: 'INTERNAL', status: 'DRAFT', reward: 0 });
      const version = makeVersion(versionId, 1, false);

      const result = await coordinator.coordinatePublish(
        form,
        version,
        publisherId,
      );

      expect(result.costCalculation.effectiveCost).toBe(0);
      expect(result.journalId).toBeNull();
      expect(await availableBalance()).toBe(1000);
      expect(await escrowBalance()).toBe(0);
    });

    it('rejects publication when publisher balance is insufficient', async () => {
      // 25 * 100 = 2500 points (available is 1000)
      const form = makeForm({ status: 'DRAFT', reward: 25, expected: 100 });
      const version = makeVersion(versionId, 1, false);

      await expect(
        coordinator.coordinatePublish(form, version, publisherId),
      ).rejects.toThrow(InsufficientEscrowBalanceException);

      expect(await availableBalance()).toBe(1000);
      expect(await escrowBalance()).toBe(0);
    });

    it('re-publication reserves only the shortfall, so nothing is stranded (Epic 6 review P4)', async () => {
      const form = makeForm({});
      const v1 = makeVersion(versionId, 1, true);
      await formRepo.create(form, v1);
      await coordinator.coordinatePublish(form, v1, publisherId); // 500
      await payExternal(20, 10); // 200 consumed, 30 slots open

      const v2 = makeVersion('44444444-4444-4444-8444-444444444444', 2, false);
      await formRepo.update(form, v2);
      const republish = await coordinator.coordinatePublish(
        form,
        v2,
        publisherId,
      );

      // 30 open slots x 10 = 300, already held by the form.
      expect(republish.reservedAmount).toBe(0);
      expect(republish.journalId).toBeNull();

      const close = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );
      expect(close.refundAmount).toBe(300);
      expect(await escrowBalance()).toBe(0);
      expect(await availableBalance()).toBe(800); // 1000 - 200 paid out
    });

    it('re-publication with an edited reward reserves the difference and still refunds exactly (Epic 6 review P4)', async () => {
      const form = makeForm({ reward: 10 });
      const v1 = makeVersion(versionId, 1, true);
      await formRepo.create(form, v1);
      await coordinator.coordinatePublish(form, v1, publisherId); // 500
      await payExternal(20, 10); // 200

      const edited = form.copyWith({ rewardPerResponse: 20 });
      const v2 = makeVersion('44444444-4444-4444-8444-444444444444', 2, false);
      await formRepo.update(edited, v2);
      const republish = await coordinator.coordinatePublish(
        edited,
        v2,
        publisherId,
      );
      // 30 open slots x 20 = 600 needed, 300 held -> 300 more.
      expect(republish.reservedAmount).toBe(300);

      await payExternal(5, 20); // 100
      const close = await coordinator.coordinateClose(
        edited.transitionTo('CLOSED'),
        publisherId,
      );
      // 25 unused slots x 20
      expect(close.refundAmount).toBe(500);
      expect(await escrowBalance()).toBe(0);
    });
  });

  describe('getProgressEscrow (IR.4a AC10.1)', () => {
    it('held equals getFundingPosition().held and spent excludes reversed journals', async () => {
      const form = makeForm({ expected: 10 });
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId); // 100
      const [reversedAttempt] = await payExternal(3, 10);
      const credit = await ledgerService.findJournalByIdempotencyKey(
        `external-completion:${reversedAttempt}`,
      );
      await ledgerService.reverseJournal({ targetJournalId: credit!.id });
      const refs = {
        completedCount: completions.external.length,
        internalResponses: [],
        externalAttemptIds: [...completions.external],
      };

      const progress = await coordinator.getProgressEscrow(form, refs);

      expect(progress.held).toBe(
        (await coordinator.getFundingPosition(form, publisherId, [], refs))
          .held,
      );
      expect(progress.spent).toBe(20); // 3 paid, 1 reversed
    });
  });

  describe('coordinateClose (FR-32, AD-16, Epic 6 review P4)', () => {
    it('refunds exactly the unused quota of an External survey after paid completions', async () => {
      // Another survey of the same publisher holds 300 points in Escrow.
      await ledgerService.reserveEscrow({
        userId: publisherId,
        formVersionId: otherSurveyVersionId,
        amount: 300,
      });
      const form = makeForm({});
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId); // 500
      await payExternal(30, 10);

      const closeResult = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(closeResult.unusedCompletions).toBe(20);
      expect(closeResult.refundAmount).toBe(200); // (50 - 30) x 10
      expect(closeResult.refundJournalId).not.toBeNull();
      const journal = await ledgerService.findJournalByIdempotencyKey(
        `close-refund:${formId}:c1`,
      );
      expect(journal?.id).toBe(closeResult.refundJournalId);
      expect(journal?.description).toBe(
        'Escrow refund on survey close: Escrow Survey (20 unused slots)',
      );
      // The other survey's Escrow is untouched.
      expect(await escrowBalance()).toBe(300);
    });

    it('does not issue a refund if all expected responses were completed', async () => {
      const form = makeForm({});
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId);
      await payExternal(50, 10);

      const closeResult = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(closeResult.unusedCompletions).toBe(0);
      expect(closeResult.refundAmount).toBe(0);
      expect(closeResult.refundJournalId).toBeNull();
    });

    it('refunds guest-filled slots and keeps Escrow for completions still owed a reward', async () => {
      // Internal: 10 x 8 = 80 reserved.
      const form = makeForm({ type: 'INTERNAL', expected: 10 });
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId);
      completions.guests = 2; // never paid
      completions.internal.push({ id: randomUUID(), rewardable: true }); // settlement pending
      syncCompletions();

      const closeResult = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(closeResult.unusedCompletions).toBe(7);
      // 80 - 8 still owed to the pending completion.
      expect(closeResult.refundAmount).toBe(72);
      expect(await escrowBalance()).toBe(8);
    });

    it('returns the Escrow of a reversed (disputed) credit to the Publisher', async () => {
      const form = makeForm({ expected: 10 });
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId); // 100
      const [reversedAttempt] = await payExternal(2, 10);
      const credit = await ledgerService.findJournalByIdempotencyKey(
        `external-completion:${reversedAttempt}`,
      );
      await ledgerService.reverseJournal({ targetJournalId: credit!.id });

      const closeResult = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(closeResult.refundAmount).toBe(90);
      expect(await escrowBalance()).toBe(0);
    });

    it('funds and refunds every close/reopen cycle with its own journal (Epic 6 review P3)', async () => {
      let form = makeForm({});
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId); // 500
      await payExternal(30, 10);

      form = form.transitionTo('CLOSED');
      const close1 = await coordinator.coordinateClose(form, publisherId);
      expect(close1.refundAmount).toBe(200);

      const reopen1 = await coordinator.coordinateReopen(form, publisherId, 20);
      expect(reopen1.additionalCost).toBe(200);
      form = form.copyWith({ status: 'PUBLISHED', expectedCompletions: 70 });
      await payExternal(10, 10);

      form = form.transitionTo('CLOSED');
      const close2 = await coordinator.coordinateClose(form, publisherId);
      // Exactly the unused part of the reopen (10 x 10), not swallowed.
      expect(close2.refundAmount).toBe(100);
      expect(close2.refundJournalId).not.toBe(close1.refundJournalId);

      const reopen2 = await coordinator.coordinateReopen(form, publisherId, 5);
      // A second reopen is funded by its own journal.
      expect(reopen2.reopenJournalId).not.toBe(reopen1.reopenJournalId);
      form = form.copyWith({ status: 'PUBLISHED', expectedCompletions: 75 });

      form = form.transitionTo('CLOSED');
      const close3 = await coordinator.coordinateClose(form, publisherId);
      expect(close3.refundAmount).toBe(50);

      const keys = [
        `close-refund:${formId}:c1`,
        `reopen-escrow:${formId}:c1`,
        `close-refund:${formId}:c2`,
        `reopen-escrow:${formId}:c2`,
        `close-refund:${formId}:c3`,
      ];
      for (const key of keys) {
        expect(await ledgerService.findJournalByIdempotencyKey(key)).not.toBe(
          null,
        );
      }
      expect(await escrowBalance()).toBe(0);
      expect(await availableBalance()).toBe(600); // 1000 - 400 paid out
    });
  });

  describe('Story 8.1: coordinateClose for never-live versions (rejection / withdrawal)', () => {
    it('refunds exactly the Escrow reserved for the queued version', async () => {
      const form = makeForm({ type: 'INTERNAL', status: 'MODERATION_QUEUE' });
      const v1 = makeVersion(versionId, 1, false);
      await formRepo.create(form, v1);
      await coordinator.coordinatePublish(form, v1, publisherId); // 50 * 8 = 400

      const result = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(result.refundAmount).toBe(400);
      expect(result.refundJournalId).not.toBeNull();
      const journal = await ledgerService.findJournalByIdempotencyKey(
        `close-refund:${formId}:c1`,
      );
      expect(journal?.id).toBe(result.refundJournalId);
      expect(await escrowBalance()).toBe(0);
      expect(await availableBalance()).toBe(1000);
    });

    it('never refunds another survey’s Escrow for a legacy unfunded version', async () => {
      // Another survey of the same publisher holds 400 points in Escrow.
      await ledgerService.reserveEscrow({
        userId: publisherId,
        formVersionId: otherSurveyVersionId,
        amount: 400,
      });
      const form = makeForm({ type: 'INTERNAL', status: 'MODERATION_QUEUE' });
      const v1 = makeVersion(versionId, 1, false);
      await formRepo.create(form, v1); // no reservation for this version

      const result = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(result.refundAmount).toBe(0);
      expect(result.refundJournalId).toBeNull();
      expect(await escrowBalance()).toBe(400);
    });

    it('a rejected re-publication refunds everything left on the form', async () => {
      const form = makeForm({ status: 'MODERATION_QUEUE' });
      const v1 = makeVersion(versionId, 1, true);
      await formRepo.create(form, v1);
      await coordinator.coordinatePublish(form, v1, publisherId); // 500
      await payExternal(20, 10); // 200
      const v2 = makeVersion('44444444-4444-4444-8444-444444444444', 2, false);
      await formRepo.update(form, v2);
      await coordinator.coordinatePublish(form, v2, publisherId); // shortfall 0

      const result = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(result.refundAmount).toBe(300);
      expect(result.unusedCompletions).toBe(30);
      expect(await escrowBalance()).toBe(0);
      expect(await availableBalance()).toBe(800);
    });

    it('counts the reservation of a queued version whose completion code was rotated', async () => {
      const form = makeForm({ type: 'INTERNAL', status: 'MODERATION_QUEUE' });
      const v1 = makeVersion(versionId, 1, false);
      await formRepo.create(form, v1);
      await coordinator.coordinatePublish(form, v1, publisherId); // 400
      const v2 = makeVersion('55555555-5555-4555-8555-555555555555', 2, false);
      await formRepo.update(form, v2); // rotation: new unpublished version

      const result = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(result.refundAmount).toBe(400);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `close-refund:${formId}:c1`,
        ),
      ).not.toBeNull();
    });

    it('is idempotent: a replayed close returns the original refund journal', async () => {
      const form = makeForm({ type: 'INTERNAL', status: 'MODERATION_QUEUE' });
      const v1 = makeVersion(versionId, 1, false);
      await formRepo.create(form, v1);
      await coordinator.coordinatePublish(form, v1, publisherId);
      const closed = form.transitionTo('CLOSED');

      const first = await coordinator.coordinateClose(closed, publisherId);
      const replay = await coordinator.coordinateClose(closed, publisherId);

      expect(replay.refundJournalId).toBe(first.refundJournalId);
      expect(replay.refundIdempotencyKey).toBe(`close-refund:${formId}:c1`);
      expect(replay.refundAmount).toBe(400);
      expect(await availableBalance()).toBe(1000);
    });
  });

  describe('Bug 3.1 / decision D2: re-versioned drafts', () => {
    const v2Id = '77777777-7777-4777-8777-777777777777';

    it('closing a draft with a published version refunds the remaining Escrow of the published version', async () => {
      const form = makeForm({});
      const v1 = makeVersion(versionId, 1, true);
      await formRepo.create(form, v1);
      await coordinator.coordinatePublish(form, v1, publisherId); // 500
      await payExternal(10, 10); // 100 consumed
      // "Create New Version": PUBLISHED -> DRAFT, the Escrow stays reserved
      // under the published version's `publish:` journal.
      const draft = await formRepo.createVersion(formId, v2Id, new Date());
      expect(draft!.form.status).toBe('DRAFT');

      const result = await coordinator.coordinateClose(
        draft!.form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(result.refundAmount).toBe(400); // (50 - 10) x 10
      expect(result.unusedCompletions).toBe(40);
      expect(await escrowBalance()).toBe(0);
      expect(await availableBalance()).toBe(900);
    });

    it('warns when a form holds Escrow but draws nothing per completion, and still refunds it', async () => {
      const warn = jest.fn();
      const loggingCoordinator = new FormsEscrowCoordinator(
        formRepo,
        ledgerService,
        { warn },
      );
      const form = makeForm({});
      const v1 = makeVersion(versionId, 1, true);
      await formRepo.create(form, v1);
      await loggingCoordinator.coordinatePublish(form, v1, publisherId); // 500

      const repriced = form.copyWith({ rewardPerResponse: 0 });
      const result = await loggingCoordinator.coordinateClose(
        repriced.transitionTo('CLOSED'),
        publisherId,
      );

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain(formId);
      expect(result.refundAmount).toBe(500);
      expect(await escrowBalance()).toBe(0);
    });

    it('does not warn on a normal close', async () => {
      const warn = jest.fn();
      const loggingCoordinator = new FormsEscrowCoordinator(
        formRepo,
        ledgerService,
        { warn },
      );
      const form = makeForm({});
      const v1 = makeVersion(versionId, 1, true);
      await formRepo.create(form, v1);
      await loggingCoordinator.coordinatePublish(form, v1, publisherId);

      await loggingCoordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );

      expect(warn).not.toHaveBeenCalled();
    });

    it('reports the committed completions (settled, owed and guest) as the quota floor', async () => {
      const form = makeForm({});
      await formRepo.create(form, makeVersion(versionId, 1, true));
      completions.guests = 2;
      completions.internal = [{ id: randomUUID(), rewardable: true }];
      completions.external = [randomUUID(), randomUUID()];
      syncCompletions();

      await expect(coordinator.getCommittedCompletionCount(form)).resolves.toBe(
        5,
      );
    });
  });

  describe('coordinateReopen (FR-33)', () => {
    it('locks additional escrow points when survey is reopened with extra quota', async () => {
      const form = makeForm({
        type: 'INTERNAL',
        status: 'CLOSED',
        closeCount: 1,
      });

      const reopenResult = await coordinator.coordinateReopen(
        form,
        publisherId,
        25, // 25 additional completions * 8 = 200 points
      );

      expect(reopenResult.additionalCost).toBe(200);
      expect(reopenResult.reopenJournalId).not.toBeNull();
      expect(
        (
          await ledgerService.findJournalByIdempotencyKey(
            `reopen-escrow:${formId}:c1`,
          )
        )?.id,
      ).toBe(reopenResult.reopenJournalId);

      expect(await availableBalance()).toBe(800); // 1000 - 200
      expect(await escrowBalance()).toBe(200);
    });
  });

  describe('Decision E6-D1 (platform subsidy): paying 100% of an Internal quota', () => {
    it('leaves the form’s Escrow at exactly 0, touches no other survey’s Escrow and credits the full reward', async () => {
      // Another survey of the same publisher holds 150 points in Escrow.
      await ledgerService.reserveEscrow({
        userId: publisherId,
        formVersionId: otherSurveyVersionId,
        amount: 150,
      });
      // Internal 4 x 25: publish reserves 4 x round(0.8 x 25) = 80.
      const form = makeForm({ type: 'INTERNAL', reward: 25, expected: 4 });
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      const published = await coordinator.coordinatePublish(
        form,
        version,
        publisherId,
      );
      expect(published.reservedAmount).toBe(80);
      expect(await escrowBalance()).toBe(230);

      const settlement = new RewardSettlementCoordinator(ledgerService);
      const respondents = Array.from({ length: 4 }, () => randomUUID());
      const journalIds: string[] = [];
      for (const respondent of respondents) {
        const responseId = randomUUID();
        const reward = await settlement.settleInternalReward({
          responseId,
          publisherId,
          respondentId: respondent,
          rewardPerResponse: 25,
          policyMode: 'SHADOW',
        });
        expect(reward).toMatchObject({ status: 'SETTLED', amount: 25 });
        journalIds.push(reward.journalId!);
        completions.internal.push({ id: responseId, rewardable: true });

        // One balanced journal: Escrow -20, SYSTEM_ISSUANCE -5, respondent +25.
        const journal = await ledgerService.findJournalByIdempotencyKey(
          `internal-reward:${responseId}`,
        );
        const escrow = await ledgerService.getOrCreateAccount(
          publisherId,
          'ESCROW',
        );
        const issuance = await ledgerService.getOrCreateAccount(
          null,
          'SYSTEM_ISSUANCE',
        );
        const available = await ledgerService.getOrCreateAccount(
          respondent,
          'USER_AVAILABLE',
        );
        expect(
          journal!.entries
            .map((entry) => [entry.accountId, entry.amount])
            .sort((a, b) => Number(a[1]) - Number(b[1])),
        ).toEqual([
          [escrow.id, -20],
          [issuance.id, -5],
          [available.id, 25],
        ]);
      }
      syncCompletions();

      // Only the other survey's 150 remain; this form's 80 were drawn exactly.
      expect(await escrowBalance()).toBe(150);
      for (const respondent of respondents) {
        expect(
          (await ledgerService.getWallet(respondent)).balance.available,
        ).toBe(25);
      }
      expect(await coordinator.getFundingPosition(form, publisherId)).toEqual({
        required: 0,
        held: 0,
        shortfall: 0,
      });

      const closed = await coordinator.coordinateClose(
        form.transitionTo('CLOSED'),
        publisherId,
      );
      expect(closed.refundAmount).toBe(0);
      expect(closed.refundJournalId).toBeNull();
      expect(await escrowBalance()).toBe(150);
      expect(new Set(journalIds).size).toBe(4);
    });

    it('an idempotent replay of a payout returns the same single journal', async () => {
      const form = makeForm({ type: 'INTERNAL', reward: 25, expected: 1 });
      const version = makeVersion(versionId, 1, true);
      await formRepo.create(form, version);
      await coordinator.coordinatePublish(form, version, publisherId); // 20
      const settlement = new RewardSettlementCoordinator(ledgerService);
      const params = {
        responseId: randomUUID(),
        publisherId,
        respondentId,
        rewardPerResponse: 25,
      };

      const first = await settlement.settleInternalReward(params);
      const replay = await settlement.settleInternalReward(params);

      expect(replay).toEqual(first);
      expect(await escrowBalance()).toBe(0);
      expect(
        (await ledgerService.getWallet(respondentId)).balance.available,
      ).toBe(25);
    });
  });
});
