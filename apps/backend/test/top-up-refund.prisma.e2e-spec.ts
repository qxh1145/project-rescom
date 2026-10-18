import { randomUUID } from 'crypto';
import {
  Actor,
  Harness,
  bootHarness,
  databaseUrl,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';
import {
  BALANCED_LEDGER,
  ledgerInvariants,
} from './fixtures/ledger-invariants';

const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;

describe('Top-Up Refund Request & Hold on PostgreSQL (Story 13.10)', () => {
  let h: Harness;

  if (!dbAvailable) {
    if (requireDb) {
      it('reaches FINANCIAL_TEST_DATABASE_URL', () => {
        throw new Error(
          `FINANCIAL_TEST_DATABASE_URL is set (or CI) but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping 13.10 pg tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    h = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  async function createSuccessfulTopUp(
    owner: Actor,
    points = 250,
    amountVnd = points * 200,
  ) {
    const [code] = await h.prisma.$queryRaw<
      Array<{ code: number }>
    >`SELECT nextval('top_up_order_code_seq')::int AS code`;

    const topUp = await h.prisma.topUpRequest.create({
      data: {
        userId: owner.id,
        amount: points,
        amountVnd,
        channel: 'PAYOS',
        orderCode: code.code,
        status: 'SUCCESSFUL',
        expiresAt: new Date(Date.now() + 600_000),
        amountPaidVnd: amountVnd,
        pointsCredited: points,
        paidAt: new Date(),
        counterAccountBankId: '970422',
        counterAccountBankName: 'MB Bank',
        counterAccountName: 'NGUYEN VAN A',
        counterAccountNumber: '0123456789',
      },
    });

    const creditJournal = await h.ledger.creditPayosTopUp({
      topUpId: topUp.id,
      userId: owner.id,
      points,
      orderCode: code.code,
    });

    await h.prisma.topUpRequest.update({
      where: { id: topUp.id },
      data: { journalId: creditJournal.id },
    });

    return { topUp, creditJournal };
  }

  liveIt(
    'two concurrent submitRefund on the same top-up: exactly one creates request and hold, second gets 409',
    async () => {
      const user = await h.user('PUBLISHER');
      const { topUp } = await createSuccessfulTopUp(user, 300);

      // Race 2 submitRefund requests
      const [res1, res2] = await Promise.all([
        h.send(
          'post',
          `/economy/top-ups/payos/${topUp.id}/refund-request`,
          user,
          {
            reason: 'WRONG_AMOUNT',
            note: 'concurrent 1',
          },
        ),
        h.send(
          'post',
          `/economy/top-ups/payos/${topUp.id}/refund-request`,
          user,
          {
            reason: 'WRONG_AMOUNT',
            note: 'concurrent 2',
          },
        ),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const successRes = res1.status === 200 ? res1 : res2;
      const conflictRes = res1.status === 409 ? res1 : res2;

      expect(successRes.body.data.request.status).toBe('REQUESTED');
      expect(successRes.body.data.request.eligibility).toBe('ELIGIBLE');
      expect(conflictRes.body.error.code).toBe(
        'TOPUP_REFUND_ALREADY_REQUESTED',
      );

      // Exactly 1 row in DB
      const requests = await h.prisma.topUpRefundRequest.findMany({
        where: { topUpId: topUp.id },
      });
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe('REQUESTED');
      expect(requests[0].eligibility).toBe('ELIGIBLE');
      expect(requests[0].holdJournalId).not.toBeNull();

      // Check balances: Available 0, RefundHold 300
      const available = await h.prisma.ledgerAccount.findFirst({
        where: { userId: user.id, accountClass: 'USER_AVAILABLE' },
      });
      const refundHold = await h.prisma.ledgerAccount.findFirst({
        where: { userId: user.id, accountClass: 'REFUND_HOLD' },
      });
      expect(available?.balance).toBe(0);
      expect(refundHold?.balance).toBe(300);

      // Outbox events emitted
      const outbox = await h.prisma.outboxEvent.findMany({
        where: { aggregateId: requests[0].id },
      });
      expect(outbox.length).toBeGreaterThanOrEqual(2); // user event + admin notice
    },
  );

  liveIt(
    'two concurrent withdrawRefund on the same request: exactly one releases hold, second replays with replayed=true',
    async () => {
      const user = await h.user('PUBLISHER');
      const { topUp } = await createSuccessfulTopUp(user, 200);

      // Submit refund
      const submitRes = await h.send(
        'post',
        `/economy/top-ups/payos/${topUp.id}/refund-request`,
        user,
        { reason: 'WRONG_AMOUNT', note: 'withdraw test' },
      );
      expect(submitRes.status).toBe(200);

      // Race 2 withdraw calls
      const [res1, res2] = await Promise.all([
        h.send(
          'post',
          `/economy/top-ups/payos/${topUp.id}/refund-request/withdraw`,
          user,
        ),
        h.send(
          'post',
          `/economy/top-ups/payos/${topUp.id}/refund-request/withdraw`,
          user,
        ),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const replayedFlags = [
        res1.body.data.replayed,
        res2.body.data.replayed,
      ].sort();
      expect(replayedFlags).toEqual([false, true]);

      // Request is WITHDRAWN
      const request = await h.prisma.topUpRefundRequest.findUnique({
        where: { topUpId: topUp.id },
      });
      expect(request?.status).toBe('WITHDRAWN');
      expect(request?.releaseJournalId).not.toBeNull();

      // Balance restored: Available 200, RefundHold 0
      const available = await h.prisma.ledgerAccount.findFirst({
        where: { userId: user.id, accountClass: 'USER_AVAILABLE' },
      });
      const refundHold = await h.prisma.ledgerAccount.findFirst({
        where: { userId: user.id, accountClass: 'REFUND_HOLD' },
      });
      expect(available?.balance).toBe(200);
      expect(refundHold?.balance).toBe(0);

      // Exactly 1 release journal
      const releaseJournals = await h.prisma.ledgerJournal.findMany({
        where: {
          idempotencyKey: `topup-refund-withdraw:${request!.id}`,
        },
      });
      expect(releaseJournals).toHaveLength(1);
    },
  );

  async function draftForm(user: Actor, points: number) {
    const res = await h.send('post', '/forms', user, {
      title: 'Survey Race',
      type: 'INTERNAL',
      rewardPerResponse: 10,
      estimatedDurationMinutes: 5,
      expectedCompletions: points / 10,
      schema: {
        schemaVersion: 1,
        title: 'Survey Race',
        blocks: [{ id: 'q1', type: 'text', order: 0, title: 'Q1' }],
      },
    });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  async function balances(userId: string) {
    const rows = await h.prisma.ledgerAccount.findMany({
      where: {
        userId,
        accountClass: { in: ['USER_AVAILABLE', 'REFUND_HOLD'] },
      },
    });
    const of = (c: string) =>
      rows.find((r) => r.accountClass === c)?.balance ?? 0;
    return { available: of('USER_AVAILABLE'), hold: of('REFUND_HOLD') };
  }

  const submitUrl = (topUpId: string) =>
    `/economy/top-ups/payos/${topUpId}/refund-request`;
  const RACE_RUNS = 5;

  liveIt(
    `submitRefund vs publish (reserveEscrow) x${RACE_RUNS}: exactly one winner, no overdraft`,
    async () => {
      for (let i = 0; i < RACE_RUNS; i++) {
        const user = await h.user('PUBLISHER');
        const { topUp } = await createSuccessfulTopUp(user, 400);
        const formId = await draftForm(user, 400);

        const [refundRes, publishRes] = await Promise.all([
          h.send('post', submitUrl(topUp.id), user, {
            reason: 'WRONG_AMOUNT',
            note: 'race with publish',
          }),
          h.send('post', `/forms/${formId}/publish`, user),
        ]);
        expect(refundRes.status).toBe(200);
        const req = refundRes.body.data.request;
        const bal = await balances(user.id);

        if (req.eligibility === 'ELIGIBLE') {
          expect(publishRes.status).toBe(409);
          expect(publishRes.body.error.code).toBe(
            'INSUFFICIENT_ESCROW_BALANCE',
          );
          expect(publishRes.body.error.details.refundHoldPoints).toBe(400);
          expect(bal).toEqual({ available: 0, hold: 400 });
        } else {
          expect(publishRes.status).toBe(200);
          expect(req.eligibility).toBe('NOT_ELIGIBLE');
          expect(req.ineligibleReason).toBe('SPENT_SINCE_TOP_UP');
          expect(bal.hold).toBe(0);
          expect(bal.available).toBeGreaterThanOrEqual(0);
        }
      }
    },
    120_000,
  );

  liveIt(
    `submitRefund vs voucher redemption x${RACE_RUNS}: exactly one winner, no overdraft`,
    async () => {
      const POINTS = 250;
      for (let i = 0; i < RACE_RUNS; i++) {
        const user = await h.user('RESPONDENT');
        // Activation prerequisites (starter unlock, 1 point) predate the top-up
        // so they are not "spend since top-up"; redemption costs POINTS + 1.
        const avail = await h.ledger.getOrCreateAccount(
          user.id,
          'USER_AVAILABLE',
        );
        const issuance = await h.ledger.getOrCreateAccount(
          null,
          'SYSTEM_ISSUANCE',
        );
        await h.ledger.postJournal({
          idempotencyKey: `starter-unlock:${user.id}`,
          entries: [
            { accountId: issuance.id, amount: -1 },
            { accountId: avail.id, amount: 1 },
          ],
        });
        const formId = randomUUID();
        const versionId = randomUUID();
        await h.prisma.form.create({
          data: {
            id: formId,
            publisherId: user.id,
            title: 'Survey',
            type: 'INTERNAL',
            status: 'PUBLISHED',
            rewardPerResponse: 10,
            expectedCompletions: 10,
            versions: {
              create: {
                id: versionId,
                versionNumber: 1,
                schemaJson: {},
                isPublished: true,
              },
            },
          },
        });
        await h.prisma.surveyAttempt.create({
          data: {
            id: randomUUID(),
            surveyId: formId,
            formVersionId: versionId,
            respondentId: user.id,
            status: 'COMPLETED',
            submittedAt: new Date(),
          },
        });
        const { topUp } = await createSuccessfulTopUp(user, POINTS);

        const now = Date.now();
        const voucher = await h.prisma.voucher.create({
          data: {
            id: randomUUID(),
            title: `Race Voucher ${i}`,
            brandId: 'highlands',
            category: 'COFFEE',
            valueVnd: 50_000,
            basePoints: POINTS + 1,
            priceVersion: 1,
            stockTotal: 1,
            stockRemaining: 1,
            state: 'ACTIVE',
            isVisible: true,
            isSharedCode: false,
            createdById: randomUUID(),
            redeemStartsAt: new Date(now - 3600_000),
            redeemEndsAt: new Date(now + 86400_000),
            codeExpiresAt: new Date(now + 86400_000 * 10),
          },
        });
        await h.prisma.voucherCode.create({
          data: {
            id: randomUUID(),
            voucherId: voucher.id,
            code: `CODE-${randomUUID().slice(0, 8).toUpperCase()}`,
          },
        });
        const quoteRes = await h.send('post', '/rewards/quotes', user, {
          voucherId: voucher.id,
        });
        expect(quoteRes.status).toBe(201);

        const [refundRes, redeemRes] = await Promise.all([
          h.send('post', submitUrl(topUp.id), user, {
            reason: 'WRONG_AMOUNT',
            note: 'race with redemption',
          }),
          h
            .send('post', '/rewards/redemptions', user, {
              quoteId: quoteRes.body.data.quoteId,
            })
            .set('Idempotency-Key', `race-${randomUUID()}`),
        ]);
        expect(refundRes.status).toBe(200);
        const req = refundRes.body.data.request;
        const bal = await balances(user.id);

        if (req.eligibility === 'ELIGIBLE') {
          expect(redeemRes.status).toBe(409);
          expect(redeemRes.body.error.code).toBe('INSUFFICIENT_POINTS');
          expect(bal).toEqual({ available: 1, hold: POINTS });
        } else {
          expect(redeemRes.status).toBe(201);
          expect(req.ineligibleReason).toBe('SPENT_SINCE_TOP_UP');
          expect(bal).toEqual({ available: 0, hold: 0 });
        }
      }
    },
    120_000,
  );

  liveIt(
    'submit after a spend commits a NOT_ELIGIBLE row, no hold journal, outbox events present',
    async () => {
      const user = await h.user('PUBLISHER');
      const { topUp } = await createSuccessfulTopUp(user, 400);
      const formId = await draftForm(user, 400);
      expect(
        (await h.send('post', `/forms/${formId}/publish`, user)).status,
      ).toBe(200);

      const res = await h.send('post', submitUrl(topUp.id), user, {
        reason: 'WRONG_AMOUNT',
        note: 'after spend',
      });
      expect(res.status).toBe(200);
      expect(res.body.data.request.eligibility).toBe('NOT_ELIGIBLE');

      const rows = await h.prisma.$queryRaw<
        Array<{
          id: string;
          eligibility: string;
          ineligible_reason: string;
          hold_journal_id: string | null;
        }>
      >`SELECT id, eligibility, ineligible_reason, hold_journal_id
        FROM top_up_refund_requests WHERE top_up_id = ${topUp.id}::uuid`;
      expect(rows).toHaveLength(1);
      expect(rows[0].eligibility).toBe('NOT_ELIGIBLE');
      expect(rows[0].ineligible_reason).toBe('SPENT_SINCE_TOP_UP');
      expect(rows[0].hold_journal_id).toBeNull();

      expect(
        await h.prisma.ledgerJournal.count({
          where: { idempotencyKey: `topup-refund-hold:${rows[0].id}` },
        }),
      ).toBe(0);
      expect(
        await h.prisma.outboxEvent.count({
          where: { aggregateId: rows[0].id },
        }),
      ).toBeGreaterThanOrEqual(2);
    },
  );

  liveIt(
    'enforces PostgreSQL check constraints on TopUpRefundRequest',
    async () => {
      const user = await h.user('PUBLISHER');
      const { topUp, creditJournal } = await createSuccessfulTopUp(user, 100);

      // 1. ELIGIBLE REQUESTED row without hold_journal_id must violate ck_top_up_refund_requests_hold_journal_shape
      await expect(
        h.prisma.$executeRaw`
        INSERT INTO top_up_refund_requests (
          id, top_up_id, user_id, top_up_journal_id, points, amount_vnd, reason, note, status, eligibility, ineligible_reason,
          destination_verified, hold_journal_id, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${topUp.id}::uuid, ${user.id}::uuid, ${creditJournal.id}::uuid, 100, 20000, 'WRONG_AMOUNT', 'test',
          'REQUESTED', 'ELIGIBLE', NULL,
          true, NULL, NOW(), NOW()
        )
      `,
      ).rejects.toThrow();

      // 2. NOT_ELIGIBLE row with hold_journal_id must violate ck_top_up_refund_requests_hold_journal_shape
      const dummyJournal = await h.ledger.postJournal({
        idempotencyKey: `dummy:${randomUUID()}`,
        entries: [
          {
            accountId: (
              await h.ledger.getOrCreateAccount(null, 'SYSTEM_ISSUANCE')
            ).id,
            amount: -1,
          },
          {
            accountId: (
              await h.ledger.getOrCreateAccount(user.id, 'USER_AVAILABLE')
            ).id,
            amount: 1,
          },
        ],
      });

      await expect(
        h.prisma.$executeRaw`
        INSERT INTO top_up_refund_requests (
          id, top_up_id, user_id, top_up_journal_id, points, amount_vnd, reason, note, status, eligibility, ineligible_reason,
          destination_verified, hold_journal_id, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${topUp.id}::uuid, ${user.id}::uuid, ${creditJournal.id}::uuid, 100, 20000, 'WRONG_AMOUNT', 'test',
          'REQUESTED', 'NOT_ELIGIBLE', 'SPENT_SINCE_TOP_UP',
          true, ${dummyJournal.id}::uuid, NOW(), NOW()
        )
      `,
      ).rejects.toThrow();
    },
  );

  liveIt('asserts all ledger invariants hold globally', async () => {
    const report = await ledgerInvariants(h.prisma);
    expect(report).toEqual(BALANCED_LEDGER);
  });
});
