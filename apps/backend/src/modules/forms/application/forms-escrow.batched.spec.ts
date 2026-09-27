import { randomUUID } from 'crypto';
import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../../economy/application/ledger.service';
import { RewardSettlementCoordinator } from '../../economy/application/reward-settlement.coordinator';
import { FormsEscrowCoordinator } from './forms-escrow.coordinator';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { FormCompletionRefs } from './ports/form-repository.port';

/**
 * Phase 5 M-1: the list page reads every form's held Escrow in one batch.
 * The batched value must equal the single-form `getFundingPosition().held`.
 */
describe('FormsEscrowCoordinator.getHeldEscrowByForm (Phase 5 M-1)', () => {
  const publisherId = '11111111-1111-4111-8111-111111111111';
  const otherPublisherId = '44444444-4444-4444-8444-444444444444';

  let formRepo: InMemoryFormRepository;
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let coordinator: FormsEscrowCoordinator;

  const schema = {
    title: 'Batched Escrow',
    blocks: [],
    metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
  } as any;

  function makeForm(overrides: {
    type?: 'INTERNAL' | 'EXTERNAL';
    reward?: number;
    expected?: number;
    publisher?: string;
  }): FormEntity {
    return new FormEntity(
      randomUUID(),
      overrides.publisher ?? publisherId,
      overrides.type ?? 'EXTERNAL',
      'PUBLISHED',
      'Batched Escrow',
      null,
      overrides.reward ?? 10,
      overrides.expected ?? 10,
      new Date(),
      new Date(),
      undefined,
      0,
    );
  }

  function makeVersion(formId: string, versionNumber: number) {
    return new FormVersionEntity(
      randomUUID(),
      formId,
      versionNumber,
      schema,
      null,
      true,
      null,
      null,
      new Date(),
      new Date(),
    );
  }

  const refs = new Map<string, FormCompletionRefs>();
  function completionsOf(formId: string): FormCompletionRefs {
    const current = refs.get(formId) ?? {
      completedCount: 0,
      internalResponses: [],
      externalAttemptIds: [],
    };
    refs.set(formId, current);
    return current;
  }

  async function publish(form: FormEntity): Promise<FormVersionEntity> {
    const version = makeVersion(form.id, 1);
    await formRepo.create(form, version);
    await coordinator.coordinatePublish(form, version, form.publisherId);
    return version;
  }

  async function payExternal(form: FormEntity, count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const attemptId = randomUUID();
      await ledgerService.creditPendingReward({
        attemptId,
        publisherId: form.publisherId,
        respondentId: randomUUID(),
        amount: form.rewardPerResponse,
      });
      const refs = completionsOf(form.id);
      refs.externalAttemptIds.push(attemptId);
      refs.completedCount += 1;
      ids.push(attemptId);
    }
    return ids;
  }

  async function seed(userId: string, amount: number) {
    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const available = await ledgerService.getOrCreateAccount(
      userId,
      'USER_AVAILABLE',
    );
    await ledgerService.transfer({
      fromAccountId: system.id,
      toAccountId: available.id,
      amount,
      idempotencyKey: `seed-${userId}`,
      description: 'Initial balance',
    });
  }

  beforeEach(async () => {
    refs.clear();
    formRepo = new InMemoryFormRepository();
    formRepo.useCompletionSource((formId) => {
      const current = completionsOf(formId);
      return {
        completedCount: current.completedCount,
        internalResponses: [...current.internalResponses],
        externalAttemptIds: [...current.externalAttemptIds],
      };
    });
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo);
    coordinator = new FormsEscrowCoordinator(formRepo, ledgerService);
    await seed(publisherId, 5000);
    await seed(otherPublisherId, 1000);
  });

  it('returns exactly the per-form held Escrow for reserved, paid-out, pending, reversed, re-published, reopened, closed and free forms', async () => {
    // 1. Reserved only: 10 × 10 = 100 held.
    const reserved = makeForm({});
    await publish(reserved);

    // 2. Paid out: 3 External credits consume 30.
    const paidOut = makeForm({});
    await publish(paidOut);
    await payExternal(paidOut, 3);

    // 3. Pending: 2 completions still owed (no payout journal yet).
    const pending = makeForm({ type: 'INTERNAL', reward: 10 });
    await publish(pending);
    const pendingRefs = completionsOf(pending.id);
    pendingRefs.internalResponses.push(
      { id: randomUUID(), rewardable: true },
      { id: randomUUID(), rewardable: true },
      { id: randomUUID(), rewardable: false },
    );
    pendingRefs.completedCount = 3;
    // …and one settled Internal reward (consumed from Escrow).
    const settledResponseId = randomUUID();
    await new RewardSettlementCoordinator(ledgerService).settleInternalReward({
      responseId: settledResponseId,
      publisherId,
      respondentId: randomUUID(),
      rewardPerResponse: 10,
      policyMode: 'SHADOW',
    });
    pendingRefs.internalResponses.push({
      id: settledResponseId,
      rewardable: true,
    });
    pendingRefs.completedCount += 1;

    // 4. Reversed credit: its Escrow is back on the form.
    const reversed = makeForm({});
    await publish(reversed);
    const [reversedAttempt] = await payExternal(reversed, 2);
    const credit = await ledgerService.findJournalByIdempotencyKey(
      `external-completion:${reversedAttempt}`,
    );
    await ledgerService.reverseJournal({ targetJournalId: credit!.id });

    // 5. Closed & refunded: holds 0 afterwards.
    const closed = makeForm({});
    await publish(closed);
    await payExternal(closed, 1);
    await coordinator.coordinateClose(
      closed.transitionTo('CLOSED'),
      publisherId,
    );

    // 6. Closed, refunded, then reopened with 5 more slots.
    let reopened = makeForm({ expected: 4 });
    await publish(reopened);
    await payExternal(reopened, 4);
    reopened = reopened.transitionTo('CLOSED');
    await coordinator.coordinateClose(reopened, publisherId);
    await coordinator.coordinateReopen(reopened, publisherId, 5);

    // 7. Re-published: a second version carries the first one's Escrow.
    const republished = makeForm({ expected: 6 });
    await publish(republished);
    await payExternal(republished, 2);
    const v2 = makeVersion(republished.id, 2);
    await formRepo.update(republished, v2);
    await coordinator.coordinatePublish(republished, v2, publisherId);

    // 8. Free survey: no Escrow.
    const free = makeForm({ reward: 0 });
    await formRepo.create(free, makeVersion(free.id, 1));

    // 9. Over-drawn (owed more than held): clamped to 0.
    const overdrawn = makeForm({ expected: 2 });
    await publish(overdrawn);
    const overdrawnRefs = completionsOf(overdrawn.id);
    overdrawnRefs.externalAttemptIds.push(
      randomUUID(),
      randomUUID(),
      randomUUID(),
    );
    overdrawnRefs.completedCount = 3;

    // 10. Another Publisher's form in the same batch.
    const other = makeForm({ publisher: otherPublisherId });
    await publish(other);
    await payExternal(other, 1);

    // 11. Never published (legacy/draft): nothing reserved.
    const unpublished = makeForm({});
    await formRepo.create(unpublished, makeVersion(unpublished.id, 1));

    const forms = [
      reserved,
      paidOut,
      pending,
      reversed,
      closed,
      reopened,
      republished,
      free,
      overdrawn,
      other,
      unpublished,
    ];

    const perForm = new Map<string, number>();
    for (const form of forms) {
      perForm.set(
        form.id,
        (await coordinator.getFundingPosition(form, form.publisherId)).held,
      );
    }

    const singleRead = jest.spyOn(ledgerService, 'getFormEscrowPosition');
    const keyLookups = jest.spyOn(ledgerRepo, 'findJournalsByIdempotencyKeys');
    const prefixLookups = jest.spyOn(
      ledgerRepo,
      'findJournalsByIdempotencyKeyPrefixes',
    );
    const batched = await coordinator.getHeldEscrowByForm(forms);

    expect(batched).toEqual(perForm);
    // Sanity: the fixture really covers distinct positions.
    expect(Object.fromEntries(perForm)).toEqual({
      [reserved.id]: 100,
      [paidOut.id]: 70,
      [pending.id]: 56, // 80 − 8 settled − 2 × 8 owed
      [reversed.id]: 90,
      [closed.id]: 0,
      [reopened.id]: 50,
      [republished.id]: 40,
      [free.id]: 0,
      [overdrawn.id]: 0,
      [other.id]: 90,
      [unpublished.id]: 0,
    });
    // Constant ledger reads for the whole page.
    expect(singleRead).not.toHaveBeenCalled();
    expect(keyLookups).toHaveBeenCalledTimes(1);
    expect(prefixLookups).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map for an empty page without reading', async () => {
    const lookups = jest.spyOn(ledgerRepo, 'findJournalsByIdempotencyKeys');
    expect(await coordinator.getHeldEscrowByForm([])).toEqual(new Map());
    expect(lookups).not.toHaveBeenCalled();
  });
});
