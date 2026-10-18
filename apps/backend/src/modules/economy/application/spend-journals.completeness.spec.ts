import { randomUUID } from 'crypto';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { LedgerService } from './ledger.service';
import {
  isSpendJournal,
  USER_AVAILABLE_DEBIT_JOURNALS,
} from '../domain/spend-journals';
import { LedgerEntryEntity } from '../domain/ledger-entry.entity';

describe('SpendJournals Completeness', () => {
  let repo: InMemoryLedgerRepository;
  let service: LedgerService;

  beforeEach(() => {
    repo = new InMemoryLedgerRepository();
    service = new LedgerService(repo);
  });

  const NON_POSTING_METHODS = new Set([
    'constructor',
    'now',
    'getOrCreateAccount',
    'getAccount',
    'getUserAccounts',
    'getWallet',
    'assertReversalKeepsChainConsistent',
    'assertUpstreamJournalLive',
    'assertNoUnreversedDownstreamJournal',
    'findDisputeHoldsForAttempt',
    'findDisputeResolutions',
    'getEscrowReservation',
    'getFormEscrowPosition',
    'getFormEscrowPositions',
    'toFormEscrowPosition',
    'postPublisherEscrowLock',
    'findInternalRewardSettlement',
    'findPendingRewardSettlement',
    'assertCreditNotReversed',
    'assertNoLiveDisputeHold',
    'findMaturedPendingCredits',
    'verifyAccountBalance',
    'reconcileAccountBalance',
    'verifyLedgerIntegrity',
    'isJournalReversed',
    'getExternalCreditState',
    'getExternalSettlementState',
    'findJournalByIdempotencyKey',
    'assertReplayCompatible',
    'replayEntryKey',
    'replayConflict',
    'positiveTotal',
    'toSettlementResult',
    'findReversedJournalIds',
    'isJournalCompatible',
  ]);

  it('verifies that all LedgerService posting methods with USER_AVAILABLE debits are classified', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const surveyId = randomUUID();
    const caseId = randomUUID();
    const topUpId = randomUUID();
    const refundRequestId = randomUUID();

    // 1. Initial credit to have Available points
    await service.creditPayosTopUp({
      topUpId,
      userId,
      points: 10_000,
      orderCode: 123456,
    });

    // 2. Exercise methods that might debit USER_AVAILABLE
    // A. reserveEscrow (publish:) -> SPEND
    await service.reserveEscrow({
      formVersionId: surveyId,
      userId,
      amount: 100,
      formTitle: 'Publish survey',
    });

    // B. reopenEscrow (reopen-escrow:) -> SPEND
    await service.reopenEscrow({
      formId: surveyId,
      reopenVersion: 1,
      userId,
      additionalAmount: 50,
      formTitle: 'Reopen survey',
    });

    // C. spendPoints (redemption:) -> SPEND
    await service.spendPoints({
      userId,
      amount: 200,
      idempotencyKey: `redemption:${userId}:${randomUUID()}`,
      description: 'Redeem voucher',
    });

    // D. placeTopUpRefundHold (topup-refund-hold:) -> NON_SPEND
    await service.placeTopUpRefundHold({
      requestId: refundRequestId,
      userId,
      points: 500,
      creditJournalCreatedAt: new Date(),
    });

    // E. transfer (transfer:) -> NON_SPEND
    const userAcc = await service.getOrCreateAccount(userId, 'USER_AVAILABLE');
    const otherAcc = await service.getOrCreateAccount(
      otherUserId,
      'USER_AVAILABLE',
    );
    await service.transfer({
      fromAccountId: userAcc.id,
      toAccountId: otherAcc.id,
      amount: 100,
      idempotencyKey: `transfer:${randomUUID()}`,
      description: 'P2P transfer',
    });

    // F. reverseJournal (reversal:) of a dispute payout -> NON_SPEND
    // Setup a dispute payout that credited USER_AVAILABLE
    const disputePayout = await service.postJournal({
      idempotencyKey: `dispute-resolution:${caseId}:release`,
      description: 'Dispute release payout to respondent',
      entries: [
        {
          accountId: (await service.getOrCreateAccount(null, 'SYSTEM_CLEARING'))
            .id,
          amount: -100,
        },
        { accountId: userAcc.id, amount: 100 },
      ],
    });
    // Now reverse it: debits userAcc, credits clearing
    await service.reverseJournal({
      targetJournalId: disputePayout.id,
      reason: 'Reversal of dispute resolution',
      idempotencyKey: `reversal:dispute:${caseId}`,
    });

    // Collect all journals in repository that have a debit on a USER_AVAILABLE account
    const accounts = (repo as any).accounts as Map<string, any>;
    const journals = (repo as any).journals as Map<string, any>;
    const entries = (repo as any).entries as LedgerEntryEntity[];

    const debitJournals = new Set<string>();
    for (const entry of entries) {
      const account = accounts.get(entry.accountId);
      if (account?.accountClass === 'USER_AVAILABLE' && entry.amount < 0) {
        debitJournals.add(entry.journalId);
      }
    }

    expect(debitJournals.size).toBeGreaterThanOrEqual(5);

    for (const journalId of debitJournals) {
      const journal = journals.get(journalId);
      expect(journal).toBeDefined();

      const journalEntries = entries.filter((e) => e.journalId === journalId);
      const entryCandidates = journalEntries.map((e) => ({
        accountClass: accounts.get(e.accountId)?.accountClass ?? '',
        amount: e.amount,
      }));

      // Find matching prefix in USER_AVAILABLE_DEBIT_JOURNALS
      const matchingPrefix = Object.keys(USER_AVAILABLE_DEBIT_JOURNALS).find(
        (prefix) => journal.idempotencyKey.startsWith(prefix),
      );

      expect(matchingPrefix).toBeDefined();
      const expectedClassification =
        USER_AVAILABLE_DEBIT_JOURNALS[matchingPrefix!];

      const spendResult = isSpendJournal(entryCandidates);
      if (expectedClassification === 'SPEND') {
        expect(spendResult).toBe(true);
      } else {
        expect(spendResult).toBe(false);
      }
    }
  });

  it('invokes every public LedgerService posting command and classifies each USER_AVAILABLE debit', async () => {
    let clockNow = new Date();
    service = new LedgerService(repo, { clock: () => clockNow });
    const u = randomUUID();
    const v = randomUUID();
    const pub = randomUUID();
    const clearing = await service.getOrCreateAccount(null, 'SYSTEM_CLEARING');
    const fund = async (
      userId: string,
      cls: Parameters<LedgerService['getOrCreateAccount']>[1],
      amount: number,
    ) => {
      const acc = await service.getOrCreateAccount(userId, cls);
      await service.postJournal({
        idempotencyKey: `fund:${randomUUID()}`,
        description: 'test funding',
        entries: [
          { accountId: clearing.id, amount: -amount },
          { accountId: acc.id, amount },
        ],
      });
      return acc;
    };
    await fund(u, 'USER_AVAILABLE', 100_000);
    await fund(u, 'INTEGRITY_HOLD', 1_000);
    await fund(u, 'PENDING', 1_000);
    await fund(u, 'REFUND_HOLD', 1_000);
    await fund(pub, 'ESCROW', 10_000);
    await fund(pub, 'USER_AVAILABLE', 1_000);
    const uAcc = await service.getOrCreateAccount(u, 'USER_AVAILABLE');
    const vAcc = await service.getOrCreateAccount(v, 'USER_AVAILABLE');
    const formId = randomUUID();
    const topUpRefundId = randomUUID();
    const keyed = `fund:${randomUUID()}`;
    const hold = await service.placeTopUpRefundHold({
      requestId: topUpRefundId,
      userId: u,
      points: 10,
      creditJournalCreatedAt: new Date(),
    });
    expect(hold).toBeDefined();

    const COMMANDS: Array<[string, () => Promise<unknown>]> = [
      [
        'postJournal',
        () =>
          service.postJournal({
            idempotencyKey: `transfer:${randomUUID()}`,
            description: 'raw post',
            entries: [
              { accountId: uAcc.id, amount: -1 },
              { accountId: vAcc.id, amount: 1 },
            ],
          }),
      ],
      [
        'reverseJournal',
        async () => {
          const j = await service.postJournal({
            idempotencyKey: `dispute-resolution:${randomUUID()}:release`,
            description: 'payout',
            entries: [
              { accountId: clearing.id, amount: -5 },
              { accountId: uAcc.id, amount: 5 },
            ],
          });
          return service.reverseJournal({
            targetJournalId: j.id,
            reason: 'test',
            idempotencyKey: `reversal:${randomUUID()}`,
          });
        },
      ],
      [
        'transfer',
        () =>
          service.transfer({
            fromAccountId: uAcc.id,
            toAccountId: vAcc.id,
            amount: 5,
            idempotencyKey: `transfer:${randomUUID()}`,
          }),
      ],
      [
        'reserveEscrow',
        () =>
          service.reserveEscrow({
            userId: u,
            formVersionId: formId,
            amount: 10,
          }),
      ],
      [
        'refundUnusedEscrow',
        () =>
          service.refundUnusedEscrow({
            userId: u,
            formId,
            closeVersion: 'c1',
            unusedAmount: 5,
          }),
      ],
      [
        'reopenEscrow',
        () =>
          service.reopenEscrow({
            userId: u,
            formId,
            reopenVersion: 1,
            additionalAmount: 5,
          }),
      ],
      [
        'creditInternalReward',
        () =>
          service.creditInternalReward({
            responseId: randomUUID(),
            publisherId: pub,
            respondentId: v,
            amount: 5,
          }),
      ],
      [
        'releaseIntegrityHold',
        () =>
          service.releaseIntegrityHold({
            respondentId: u,
            responseId: randomUUID(),
            decisionId: randomUUID(),
            amount: 5,
          }),
      ],
      [
        'failOpenIntegrityHold',
        () =>
          service.failOpenIntegrityHold({
            respondentId: u,
            responseId: randomUUID(),
            amount: 5,
          }),
      ],
      [
        'creditPendingReward',
        async () => {
          const attemptId = randomUUID();
          await service.creditPendingReward({
            attemptId,
            publisherId: pub,
            respondentId: v,
            amount: 5,
          });
          // releasePendingReward is a distinct command; exercise it here.
          clockNow = new Date(clockNow.getTime() + 49 * 3_600_000); // past 48h review window
          return service.releasePendingReward({ attemptId });
        },
      ],
      [
        'placeDisputeHold',
        async () => {
          const caseId = randomUUID();
          const attemptId = randomUUID();
          await service.creditPendingReward({
            attemptId,
            publisherId: pub,
            respondentId: u,
            amount: 5,
          });
          await service.placeDisputeHold({
            caseId,
            attemptId,
            respondentId: u,
            amount: 5,
          });
          return service.resolveDisputeHold({
            caseId,
            respondentId: u,
            publisherId: pub,
            amount: 5,
            outcome: 'RELEASE_TO_RESPONDENT',
          });
        },
      ],
      [
        'grantStarterPoints',
        () => service.grantStarterPoints(randomUUID(), 10),
      ],
      [
        'unlockStarterPoints',
        async () => {
          const s = randomUUID();
          await service.grantStarterPoints(s, 10);
          await service.unlockStarterPoints(s, 10);
          return service.expireStarterPoints(s, 5);
        },
      ],
      [
        'creditPayosTopUp',
        () =>
          service.creditPayosTopUp({
            topUpId: randomUUID(),
            userId: u,
            points: 10,
            orderCode: 1,
          }),
      ],
      [
        'creditMismatchTopUp',
        () =>
          service.creditMismatchTopUp({
            topUpId: randomUUID(),
            userId: u,
            points: 10,
            orderCode: 2,
            amountPaidVnd: 10_000,
          }),
      ],
      [
        'creditApprovedTopUp',
        () =>
          service.creditApprovedTopUp({
            topUpId: randomUUID(),
            userId: u,
            amount: 10,
            transferReference: 'ref',
          }),
      ],
      [
        'spendPoints',
        () =>
          service.spendPoints({
            userId: u,
            amount: 5,
            idempotencyKey: `redemption:${u}:${randomUUID()}`,
          }),
      ],
      [
        'releaseTopUpRefundHold',
        () =>
          service.releaseTopUpRefundHold({
            requestId: topUpRefundId,
            userId: u,
            points: 10,
            key: `topup-refund-withdraw:${topUpRefundId}`,
          }),
      ],
      [
        'refundTopUpRefundHold',
        () =>
          service.refundTopUpRefundHold({
            requestId: randomUUID(),
            userId: u,
            points: 10,
            topUpId: randomUUID(),
            orderCode: 999,
          }),
      ],
    ];
    // Covered inside the table above (second command of a pair).
    const COVERED_IN_PAIR = new Set([
      'releasePendingReward',
      'resolveDisputeHold',
      'expireStarterPoints',
      'placeTopUpRefundHold', // invoked in setup above
    ]);

    for (const [name, invoke] of COMMANDS) {
      await expect({ name, ok: await invoke().then(() => true) }).toEqual({
        name,
        ok: true,
      });
    }
    expect(keyed).toBeDefined();

    const accounts = (repo as any).accounts as Map<string, any>;
    const journals = (repo as any).journals as Map<string, any>;
    const entries = (repo as any).entries as LedgerEntryEntity[];
    const debitJournalIds = new Set<string>();
    for (const e of entries) {
      if (
        accounts.get(e.accountId)?.accountClass === 'USER_AVAILABLE' &&
        e.amount < 0
      ) {
        debitJournalIds.add(e.journalId);
      }
    }
    const seenPrefixes = new Set<string>();
    for (const id of debitJournalIds) {
      const j = journals.get(id);
      if (j.idempotencyKey.startsWith('fund:')) continue; // test funding only
      const prefix = Object.keys(USER_AVAILABLE_DEBIT_JOURNALS).find((p) =>
        j.idempotencyKey.startsWith(p),
      );
      expect({ key: j.idempotencyKey, prefix: !!prefix }).toEqual({
        key: j.idempotencyKey,
        prefix: true,
      });
      seenPrefixes.add(prefix!);
      const cands = entries
        .filter((e) => e.journalId === id)
        .map((e) => ({
          accountClass: accounts.get(e.accountId)?.accountClass ?? '',
          amount: e.amount,
        }));
      expect(isSpendJournal(cands)).toBe(
        USER_AVAILABLE_DEBIT_JOURNALS[prefix!] === 'SPEND',
      );
    }
    for (const p of [
      'publish:',
      'reopen-escrow:',
      'redemption:',
      'transfer:',
      'reversal:',
      'topup-refund-hold:',
    ]) {
      expect(seenPrefixes.has(p)).toBe(true);
    }

    // Guard: every LedgerService method is invoked above or explicitly non-posting.
    const exercised = new Set([
      ...COMMANDS.map(([n]) => n),
      ...COVERED_IN_PAIR,
    ]);
    const proto = Object.getPrototypeOf(service);
    const methodNames = Object.getOwnPropertyNames(proto).filter(
      (name) => typeof proto[name] === 'function',
    );
    for (const methodName of methodNames) {
      const isKnown =
        exercised.has(methodName) || NON_POSTING_METHODS.has(methodName);
      expect({ methodName, isKnown }).toEqual({ methodName, isKnown: true });
    }
  });
});
