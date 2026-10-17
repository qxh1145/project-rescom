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
const RACE_RUNS = 5;

describe('Top-Up Refund Resolution & Invariants on PostgreSQL (Story 13.12)', () => {
  let h: Harness;
  let adminActor: Actor;
  let otherAdminActor: Actor;
  let userActor: Actor;

  if (!dbAvailable) {
    if (requireDb) {
      it('reaches FINANCIAL_TEST_DATABASE_URL', () => {
        throw new Error(
          `FINANCIAL_TEST_DATABASE_URL is set (or CI) but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping 13.12 pg tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    h = await bootHarness();
    adminActor = await h.user('ADMIN');
    otherAdminActor = await h.user('ADMIN');
    userActor = await h.user('RESPONDENT');
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  async function createTopUpWithRefund(
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

    // Submit refund request as owner
    const submitRes = await h.send(
      'post',
      `/economy/top-ups/payos/${topUp.id}/refund-request`,
      owner,
      { reason: 'WRONG_AMOUNT', note: 'Wrong amount transfer' },
    );
    expect(submitRes.status).toBe(200);
    const refund = submitRes.body.data.request;

    return { topUp, refund };
  }

  async function refundHoldBalance(owner: Actor) {
    const acc = await h.prisma.ledgerAccount.findFirst({
      where: { userId: owner.id, accountClass: 'REFUND_HOLD' },
    });
    return acc?.balance ?? 0;
  }

  liveIt(
    'two concurrent resolve(REFUNDED) on the same refund: exactly one posts journal, second replays',
    async () => {
      const { refund } = await createTopUpWithRefund(userActor, 300);

      const [r1, r2] = await Promise.all([
        h.send(
          'post',
          `/admin/top-ups/refunds/${refund.id}/resolve`,
          adminActor,
          {
            decision: 'REFUNDED',
            destinationConfirmed: true,
          },
        ),
        h.send(
          'post',
          `/admin/top-ups/refunds/${refund.id}/resolve`,
          otherAdminActor,
          {
            decision: 'REFUNDED',
            destinationConfirmed: true,
          },
        ),
      ]);

      expect([r1.status, r2.status]).toEqual([200, 200]);
      const replays = [r1.body.data.replayed, r2.body.data.replayed];
      expect(replays.sort()).toEqual([false, true]);

      // Exactly one clearing journal exists
      const dbRow = await h.prisma.topUpRefundRequest.findUniqueOrThrow({
        where: { id: refund.id },
      });
      expect(dbRow.status).toBe('REFUNDED');
      expect(dbRow.resolveJournalId).toBeTruthy();

      const journal = await h.prisma.ledgerJournal.findUniqueOrThrow({
        where: { id: dbRow.resolveJournalId! },
        include: { entries: true },
      });
      expect(journal.idempotencyKey).toBe(`topup-refund-resolve:${refund.id}`);
      expect(journal.entries).toHaveLength(2);

      // Invariants check
      expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
    },
  );

  liveIt(
    'concurrent resolve(REFUNDED) vs withdraw: exactly one wins (repeated), loser gets 409 REFUND_ALREADY_RESOLVED, hold returns to 0',
    async () => {
      for (let i = 0; i < RACE_RUNS; i++) {
        const owner = await h.user('RESPONDENT');
        const { topUp, refund } = await createTopUpWithRefund(owner, 200);

        const [resolveRes, withdrawRes] = await Promise.all([
          h.send(
            'post',
            `/admin/top-ups/refunds/${refund.id}/resolve`,
            adminActor,
            { decision: 'REFUNDED', destinationConfirmed: true },
          ),
          h.send(
            'post',
            `/economy/top-ups/payos/${topUp.id}/refund-request/withdraw`,
            owner,
            {},
          ),
        ]);

        expect([resolveRes.status, withdrawRes.status].sort()).toEqual([
          200, 409,
        ]);
        const loser = resolveRes.status === 409 ? resolveRes : withdrawRes;
        expect(loser.body.error.code).toBe('REFUND_ALREADY_RESOLVED');

        const dbRow = await h.prisma.topUpRefundRequest.findUniqueOrThrow({
          where: { id: refund.id },
        });
        expect(['REFUNDED', 'WITHDRAWN']).toContain(dbRow.status);
        expect(await refundHoldBalance(owner)).toBe(0);
        expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
      }
    },
  );

  liveIt(
    'records bank transfer and rejects duplicate transfer reference',
    async () => {
      const { refund } = await createTopUpWithRefund(userActor, 150);

      const resolveRes = await h.send(
        'post',
        `/admin/top-ups/refunds/${refund.id}/resolve`,
        adminActor,
        {
          decision: 'REFUNDED',
          destinationConfirmed: true,
        },
      );
      expect(resolveRes.status).toBe(200);

      // First record bank transfer
      const record1 = await h.send(
        'post',
        `/admin/top-ups/refunds/${refund.id}/bank-transfer`,
        adminActor,
        {
          bankTransferReference: 'FT1312TEST01',
          bankTransferredAt: new Date().toISOString(),
        },
      );
      const stored = record1.body.data.request;
      expect(record1.status).toBe(200);
      expect(record1.body.data.replayed).toBe(false);
      expect(record1.body.data.request.bankTransferReference).toBe(
        'FT1312TEST01',
      );

      // Identical replay returns 200 replayed: true
      const replay = await h.send(
        'post',
        `/admin/top-ups/refunds/${refund.id}/bank-transfer`,
        adminActor,
        {
          bankTransferReference: 'FT1312TEST01',
          bankTransferredAt: stored.bankTransferredAt,
        },
      );
      expect(replay.status).toBe(200);
      expect(replay.body.data.replayed).toBe(true);

      // Different values return 409
      const record2 = await h.send(
        'post',
        `/admin/top-ups/refunds/${refund.id}/bank-transfer`,
        adminActor,
        {
          bankTransferReference: 'FT1312TEST02',
          bankTransferredAt: new Date().toISOString(),
        },
      );
      expect(record2.status).toBe(409);
      expect(record2.body.error.code).toBe(
        'REFUND_BANK_TRANSFER_ALREADY_RECORDED',
      );
    },
  );

  liveIt(
    'concurrent withdraw vs resolve(REJECTED): exactly one wins (repeated), loser gets 409 REFUND_ALREADY_RESOLVED, hold returns to 0',
    async () => {
      for (let i = 0; i < RACE_RUNS; i++) {
        const owner = await h.user('RESPONDENT');
        const { topUp, refund } = await createTopUpWithRefund(owner, 210);

        const [rejectRes, withdrawRes] = await Promise.all([
          h.send(
            'post',
            `/admin/top-ups/refunds/${refund.id}/resolve`,
            adminActor,
            { decision: 'REJECTED', reason: 'Not refundable' },
          ),
          h.send(
            'post',
            `/economy/top-ups/payos/${topUp.id}/refund-request/withdraw`,
            owner,
            {},
          ),
        ]);

        expect([rejectRes.status, withdrawRes.status].sort()).toEqual([
          200, 409,
        ]);
        const loser = rejectRes.status === 409 ? rejectRes : withdrawRes;
        expect(loser.body.error.code).toBe('REFUND_ALREADY_RESOLVED');
        const dbRow = await h.prisma.topUpRefundRequest.findUniqueOrThrow({
          where: { id: refund.id },
        });
        expect(['REJECTED', 'WITHDRAWN']).toContain(dbRow.status);
        expect(await refundHoldBalance(owner)).toBe(0);
        expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
      }
    },
  );

  liveIt(
    'concurrent resolve(REFUNDED) vs resolve(REJECTED): exactly one wins (repeated), loser gets 409 REFUND_ALREADY_RESOLVED, hold returns to 0',
    async () => {
      for (let i = 0; i < RACE_RUNS; i++) {
        const owner = await h.user('RESPONDENT');
        const { refund } = await createTopUpWithRefund(owner, 220);

        const [refundedRes, rejectedRes] = await Promise.all([
          h.send(
            'post',
            `/admin/top-ups/refunds/${refund.id}/resolve`,
            adminActor,
            { decision: 'REFUNDED', destinationConfirmed: true },
          ),
          h.send(
            'post',
            `/admin/top-ups/refunds/${refund.id}/resolve`,
            otherAdminActor,
            { decision: 'REJECTED', reason: 'Not refundable' },
          ),
        ]);

        expect([refundedRes.status, rejectedRes.status].sort()).toEqual([
          200, 409,
        ]);
        const loser = refundedRes.status === 409 ? refundedRes : rejectedRes;
        expect(loser.body.error.code).toBe('REFUND_ALREADY_RESOLVED');
        const dbRow = await h.prisma.topUpRefundRequest.findUniqueOrThrow({
          where: { id: refund.id },
        });
        expect(['REFUNDED', 'REJECTED']).toContain(dbRow.status);
        expect(await refundHoldBalance(owner)).toBe(0);
        expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
      }
    },
  );

  liveIt(
    'REJECTED with manualTransferRecorded on a held request returns 400 and leaves the hold intact',
    async () => {
      const { refund } = await createTopUpWithRefund(userActor, 230);

      const res = await h.send(
        'post',
        `/admin/top-ups/refunds/${refund.id}/resolve`,
        adminActor,
        {
          decision: 'REJECTED',
          reason: 'Paid manually',
          manualTransferRecorded: true,
        },
      );

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const dbRow = await h.prisma.topUpRefundRequest.findUniqueOrThrow({
        where: { id: refund.id },
      });
      expect(dbRow.status).toBe('REQUESTED');
      expect(dbRow.releaseJournalId).toBeNull();
      expect(dbRow.resolveJournalId).toBeNull();
      expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
    },
  );

  liveIt(
    'resolves REFUNDED and REJECTED for a LOCKED user (no user-status check)',
    async () => {
      const locked = await h.user('RESPONDENT');
      const a = await createTopUpWithRefund(locked, 220);
      const b = await createTopUpWithRefund(locked, 210);
      await h.prisma.user.update({
        where: { id: locked.id },
        data: { status: 'LOCKED' },
      });

      const refunded = await h.send(
        'post',
        `/admin/top-ups/refunds/${a.refund.id}/resolve`,
        adminActor,
        { decision: 'REFUNDED', destinationConfirmed: true },
      );
      expect(refunded.status).toBe(200);
      expect(refunded.body.data.request.status).toBe('REFUNDED');

      const rejected = await h.send(
        'post',
        `/admin/top-ups/refunds/${b.refund.id}/resolve`,
        otherAdminActor,
        { decision: 'REJECTED', reason: 'Tài khoản đã bị khóa' },
      );
      expect(rejected.status).toBe(200);
      expect(rejected.body.data.request.status).toBe('REJECTED');
      expect(await refundHoldBalance(locked)).toBe(0);
      expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
    },
  );

  liveIt('DB CHECK rejects bank-transfer facts on a REJECTED row', async () => {
    const { refund } = await createTopUpWithRefund(userActor, 240);
    const res = await h.send(
      'post',
      `/admin/top-ups/refunds/${refund.id}/resolve`,
      adminActor,
      { decision: 'REJECTED', reason: 'Not refundable' },
    );
    expect(res.status).toBe(200);

    await expect(
      h.prisma.$executeRaw`UPDATE top_up_refund_requests
          SET bank_transfer_reference = 'FT-ILLEGAL', bank_transfer_recorded_at = now()
          WHERE id = ${refund.id}::uuid`,
    ).rejects.toThrow(/top_up_refund_requests_bank_transfer_check/);
  });

  liveIt('DB CHECK rejects REFUNDED without resolve_journal_id', async () => {
    const owner = await h.user('RESPONDENT');
    const { refund } = await createTopUpWithRefund(owner, 260);

    await expect(
      h.prisma.$executeRaw`UPDATE top_up_refund_requests
          SET status = 'REFUNDED', resolved_at = now(), resolved_by_admin_id = ${adminActor.id}::uuid
          WHERE id = ${refund.id}::uuid`,
    ).rejects.toThrow(/top_up_refund_requests_refunded_check/);
  });

  liveIt('asserts all ledger invariants hold globally', async () => {
    expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
  });
});
