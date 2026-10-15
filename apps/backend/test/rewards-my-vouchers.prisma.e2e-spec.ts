import { randomUUID } from 'crypto';
import {
  Actor,
  bootHarness,
  Harness,
  probeDatabase,
  requireDb,
  databaseUrl,
} from './fixtures/financial-pg-harness';
import { RewardsMyVouchersService } from '../src/modules/rewards/application/rewards-my-vouchers.service';
import { RewardsAdminCodeIssuesService } from '../src/modules/rewards/application/rewards-admin-code-issues.service';
import { VoucherReminderService } from '../src/modules/rewards/application/voucher-reminder.service';
import { CodeIssueNotificationHandler } from '../src/modules/rewards/application/code-issue-notification.handler';
import { PrismaRedemptionRepository } from '../src/modules/rewards/infrastructure/prisma-redemption.repository';
import { VoucherExpiryNotificationHandler } from '../src/modules/rewards/application/voucher-expiry-notification.handler';
import { PrismaMyVouchersRepository } from '../src/modules/rewards/infrastructure/prisma-my-vouchers.repository';
import { PrismaVoucherRepository } from '../src/modules/rewards/infrastructure/prisma-voucher.repository';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../src/common/database/unit-of-work.port';
import { CLOCK, Clock } from '../src/common/time/clock';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { REVERSE_SPEND_PORT } from '../src/modules/rewards/application/ports/reverse-spend.port';
import { RewardsRedemptionService } from '../src/modules/rewards/application/rewards-redemption.service';
import { RewardsQuoteService } from '../src/modules/rewards/application/rewards-quote.service';

const canRun = probeDatabase(databaseUrl);
if (!canRun && requireDb) {
  throw new Error(`PostgreSQL unreachable for ${databaseUrl}`);
}
if (!canRun) {
  // eslint-disable-next-line no-console
  console.warn(
    `[rewards-my-vouchers.prisma.e2e] PostgreSQL unreachable for ${databaseUrl}: suite NOT executed`,
  );
}
const describeSuite = canRun ? describe : describe.skip;

describeSuite('Story 12.10: PostgreSQL Concurrency & Invariants', () => {
  let harness: Harness;
  let myVouchersRepo: PrismaMyVouchersRepository;
  let voucherRepo: PrismaVoucherRepository;
  let myVouchersService: RewardsMyVouchersService;
  let adminService: RewardsAdminCodeIssuesService;
  let reminderService: VoucherReminderService;
  let redemptionService: RewardsRedemptionService;
  let quoteService: RewardsQuoteService;

  beforeAll(async () => {
    harness = await bootHarness({ databaseUrl });
    const uow = harness.app.get<UnitOfWorkPort>(UNIT_OF_WORK_PORT);
    const clock = harness.app.get<Clock>(CLOCK);
    const adminCap = harness.app.get(ADMIN_CAPABILITY_PORT, { strict: false });
    const reverseSpend = harness.app.get(REVERSE_SPEND_PORT, { strict: false });

    myVouchersRepo = new PrismaMyVouchersRepository(harness.prisma);
    voucherRepo = new PrismaVoucherRepository(harness.prisma);

    myVouchersService = new RewardsMyVouchersService({
      readRepo: myVouchersRepo,
      ticketWrite: myVouchersRepo,
      vouchers: voucherRepo,
      unitOfWork: uow,
      now: () => clock.now(),
    });

    adminService = new RewardsAdminCodeIssuesService({
      ticketWrite: myVouchersRepo,
      vouchers: voucherRepo,
      unitOfWork: uow,
      adminCapability: adminCap,
      reverseSpend,
      now: () => clock.now(),
    });

    reminderService = new VoucherReminderService({
      ticketWrite: myVouchersRepo,
      vouchers: voucherRepo,
      unitOfWork: uow,
    });

    redemptionService = harness.app.get(RewardsRedemptionService, {
      strict: false,
    });
    quoteService = harness.app.get(RewardsQuoteService, { strict: false });
  }, 60_000);

  afterAll(async () => {
    await harness?.close();
  });

  async function createVoucherWithCodes(stock: number, codesCount: number) {
    const voucherId = randomUUID();
    const now = new Date();
    await harness.prisma.voucher.create({
      data: {
        id: voucherId,
        title: `PG Voucher ${voucherId.slice(0, 8)}`,
        brandId: 'highlands',
        category: 'COFFEE',
        valueVnd: 50_000,
        basePoints: 100,
        promoPoints: 80,
        priceVersion: 1,
        stockTotal: stock,
        stockRemaining: stock,
        state: 'ACTIVE',
        isVisible: true,
        isSharedCode: false,
        createdById: voucherId,
        redeemStartsAt: new Date(now.getTime() - 3600_000),
        redeemEndsAt: new Date(now.getTime() + 86400_000),
        codeExpiresAt: new Date(now.getTime() + 86400_000 * 10),
      },
    });

    const codes = [];
    for (let i = 0; i < codesCount; i++) {
      const code = await harness.prisma.voucherCode.create({
        data: {
          id: randomUUID(),
          voucherId,
          code: `CODE-${voucherId.slice(0, 4)}-${i}-${randomUUID().slice(0, 4)}`,
        },
      });
      codes.push(code);
    }

    return { voucherId, codes };
  }

  async function activeRespondent(balance = 1000): Promise<Actor> {
    const user = await harness.user('RESPONDENT');
    await harness.fund(user.id, balance);
    // Starter-unlock journal + completed survey for eligibility
    const available = await harness.ledger.getOrCreateAccount(
      user.id,
      'USER_AVAILABLE',
    );
    const issuance = await harness.ledger.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    await harness.ledger.postJournal({
      idempotencyKey: `starter-unlock:${user.id}`,
      entries: [
        { accountId: issuance.id, amount: -1 },
        { accountId: available.id, amount: 1 },
      ],
    });
    const formId = randomUUID();
    const versionId = randomUUID();
    await harness.prisma.form.create({
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
    await harness.prisma.surveyAttempt.create({
      data: {
        id: randomUUID(),
        surveyId: formId,
        formVersionId: versionId,
        respondentId: user.id,
        status: 'COMPLETED',
        submittedAt: new Date(),
      },
    });
    return user;
  }

  async function getAvailableBalance(userId: string): Promise<number> {
    const wallet = await harness.ledger.getWallet(userId);
    return wallet.balance.available;
  }

  async function redeemVoucherForUser(user: Actor, voucherId: string) {
    const quote = await quoteService.createQuote(user.id, { voucherId });
    const result = await redemptionService.redeem(
      user.id,
      { quoteId: quote.quoteId },
      `idem-${randomUUID()}`,
    );
    return result;
  }

  it('parallel mark-used x2 => exactly one usage row', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(500);
    const redeemed = await redeemVoucherForUser(user, voucherId);

    const [res1, res2] = await Promise.all([
      myVouchersService.markUsed(user.id, redeemed.redemptionId),
      myVouchersService.markUsed(user.id, redeemed.redemptionId),
    ]);

    expect(res1.ticket.status).toBe('USED');
    expect(res2.ticket.status).toBe('USED');

    const usages = await harness.prisma.redemptionUsage.findMany({
      where: { redemptionId: redeemed.redemptionId },
    });
    expect(usages).toHaveLength(1);
  });

  it('mark-used racing undo commits a consistent usage state', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(500);
    const redeemed = await redeemVoucherForUser(user, voucherId);
    const results = await Promise.allSettled([
      myVouchersService.markUsed(user.id, redeemed.redemptionId),
      myVouchersService.undoUse(user.id, redeemed.redemptionId),
    ]);
    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    const usage = await harness.prisma.redemptionUsage.findUnique({
      where: { redemptionId: redeemed.redemptionId },
    });
    const ticket = await myVouchersService.getTicket(
      user.id,
      redeemed.redemptionId,
    );
    expect(ticket.ticket.status === 'USED').toBe(usage !== null);
    expect(
      await harness.prisma.redemptionUsage.count({
        where: { redemptionId: redeemed.redemptionId },
      }),
    ).toBeLessThanOrEqual(1);
  });

  it('mark-used racing refund leaves refunded ticket and one reversal', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(500);
    const admin = await harness.user('ADMIN');
    const balanceBefore = await getAvailableBalance(user.id);
    const redeemed = await redeemVoucherForUser(user, voucherId);
    const report = await myVouchersService.reportCodeIssue(
      user.id,
      redeemed.redemptionId,
      { reason: 'CODE_INVALID' },
    );
    const results = await Promise.allSettled([
      myVouchersService.markUsed(user.id, redeemed.redemptionId),
      adminService.resolve(
        report.id,
        { outcome: 'REFUND' },
        { id: admin.id, name: 'Admin' },
      ),
    ]);
    expect(results[1].status).toBe('fulfilled');
    if (results[0].status === 'rejected') {
      expect(results[0].reason.code).toBe('TICKET_REFUNDED');
    }
    expect(
      await harness.prisma.redemptionRefund.count({
        where: { redemptionId: redeemed.redemptionId },
      }),
    ).toBe(1);
    expect(
      await harness.prisma.ledgerJournal.count({
        where: { idempotencyKey: `redemption-refund:${report.id}` },
      }),
    ).toBe(1);
    expect(await getAvailableBalance(user.id)).toBe(balanceBefore);
    await expect(
      myVouchersService.markUsed(user.id, redeemed.redemptionId),
    ).rejects.toMatchObject({ code: 'TICKET_REFUNDED' });
  });

  it('double report submit => exactly one OPEN report (second CODE_ISSUE_ALREADY_OPEN)', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(500);
    const redeemed = await redeemVoucherForUser(user, voucherId);

    const results = await Promise.allSettled([
      myVouchersService.reportCodeIssue(user.id, redeemed.redemptionId, {
        reason: 'CODE_INVALID',
      }),
      myVouchersService.reportCodeIssue(user.id, redeemed.redemptionId, {
        reason: 'CODE_ALREADY_USED',
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe(
      'CODE_ISSUE_ALREADY_OPEN',
    );

    const openReports = await harness.prisma.codeIssueReport.findMany({
      where: { redemptionId: redeemed.redemptionId, status: 'OPEN' },
    });
    expect(openReports).toHaveLength(1);
  });

  it('REPLACE, REFUND and REJECT racing on one report => exactly one outcome', async () => {
    const { voucherId } = await createVoucherWithCodes(10, 10);
    const user = await activeRespondent(500);
    const admin = await harness.user('ADMIN');
    const redeemed = await redeemVoucherForUser(user, voucherId);

    const report = await myVouchersService.reportCodeIssue(
      user.id,
      redeemed.redemptionId,
      { reason: 'CODE_INVALID' },
    );

    const outcomes = await Promise.allSettled([
      adminService.resolve(
        report.id,
        { outcome: 'REPLACE' },
        { id: admin.id, name: 'Admin' },
      ),
      adminService.resolve(
        report.id,
        { outcome: 'REFUND' },
        { id: admin.id, name: 'Admin' },
      ),
      adminService.resolve(
        report.id,
        { outcome: 'REJECT', note: 'Rejected by admin' },
        { id: admin.id, name: 'Admin' },
      ),
    ]);

    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const dbReport = await harness.prisma.codeIssueReport.findUniqueOrThrow({
      where: { id: report.id },
    });
    expect(['REPLACED', 'REFUNDED', 'REJECTED']).toContain(dbReport.status);

    // Verify refund row count <= 1
    const refunds = await harness.prisma.redemptionRefund.findMany({
      where: { reportId: report.id },
    });
    expect(refunds.length).toBe(dbReport.status === 'REFUNDED' ? 1 : 0);
    const reversals = await harness.prisma.ledgerJournal.findMany({
      where: { idempotencyKey: `redemption-refund:${report.id}` },
      include: { entries: true },
    });
    expect(reversals).toHaveLength(refunds.length);
    for (const reversal of reversals) {
      expect(
        reversal.entries.reduce((sum, entry) => sum + entry.amount, 0),
      ).toBe(0);
      expect(
        reversal.entries
          .filter((entry) => entry.amount > 0)
          .reduce((sum, entry) => sum + entry.amount, 0),
      ).toBe(redeemed.pointsSpent);
    }
  });

  it('two Admins REFUND the same report => one reversal journal, one redemption_refunds row', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(500);
    const admin1 = await harness.user('ADMIN');
    const admin2 = await harness.user('ADMIN');
    const redeemed = await redeemVoucherForUser(user, voucherId);

    const report = await myVouchersService.reportCodeIssue(
      user.id,
      redeemed.redemptionId,
      { reason: 'CODE_INVALID' },
    );

    const [res1, res2] = await Promise.all([
      adminService.resolve(
        report.id,
        { outcome: 'REFUND' },
        { id: admin1.id, name: 'Admin 1' },
      ),
      adminService.resolve(
        report.id,
        { outcome: 'REFUND' },
        { id: admin2.id, name: 'Admin 2' },
      ),
    ]);

    expect(res1.status).toBe('REFUNDED');
    expect(res2.status).toBe('REFUNDED');

    const refundRows = await harness.prisma.redemptionRefund.findMany({
      where: { redemptionId: redeemed.redemptionId },
    });
    expect(refundRows).toHaveLength(1);
  });

  it('REPLACE racing last-unit redemption never oversells or assigns a code twice', async () => {
    const { voucherId } = await createVoucherWithCodes(2, 2);
    const firstUser = await activeRespondent(500);
    const secondUser = await activeRespondent(500);
    const admin = await harness.user('ADMIN');
    const first = await redeemVoucherForUser(firstUser, voucherId);
    const report = await myVouchersService.reportCodeIssue(
      firstUser.id,
      first.redemptionId,
      { reason: 'CODE_INVALID' },
    );
    const quote = await quoteService.createQuote(secondUser.id, { voucherId });
    const results = await Promise.allSettled([
      adminService.resolve(
        report.id,
        { outcome: 'REPLACE' },
        { id: admin.id, name: 'Admin' },
      ),
      redemptionService.redeem(
        secondUser.id,
        { quoteId: quote.quoteId },
        `idem-${randomUUID()}`,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const voucher = await harness.prisma.voucher.findUniqueOrThrow({
      where: { id: voucherId },
    });
    const redemptions = await harness.prisma.redemption.findMany({
      where: { voucherId, status: 'SUCCEEDED' },
    });
    const replacements = await harness.prisma.codeIssueReport.findMany({
      where: { redemptionId: first.redemptionId, status: 'REPLACED' },
    });
    expect(voucher.stockRemaining).toBe(0);
    expect(redemptions.length + replacements.length).toBe(voucher.stockTotal);
    const issued = await harness.prisma.voucherCode.findMany({
      where: {
        voucherId,
        OR: [{ redemptionId: { not: null } }, { issueReportId: { not: null } }],
      },
    });
    expect(issued).toHaveLength(voucher.stockTotal);
    expect(new Set(issued.map((code) => code.id)).size).toBe(
      voucher.stockTotal,
    );
    expect(
      new Set(issued.map((code) => code.redemptionId ?? code.issueReportId))
        .size,
    ).toBe(voucher.stockTotal);
  });

  it('refunded redemption does not consume per-voucher 30-day limit', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(1000);
    const admin = await harness.user('ADMIN');
    const first = await redeemVoucherForUser(user, voucherId);
    await redeemVoucherForUser(user, voucherId);
    const report = await myVouchersService.reportCodeIssue(
      user.id,
      first.redemptionId,
      { reason: 'CODE_INVALID' },
    );
    await adminService.resolve(
      report.id,
      { outcome: 'REFUND' },
      { id: admin.id, name: 'Admin' },
    );
    const third = await redeemVoucherForUser(user, voucherId);
    expect(third.redemptionId).not.toBe(first.redemptionId);
    expect(
      await harness.prisma.redemption.count({
        where: {
          userId: user.id,
          voucherId,
          status: 'SUCCEEDED',
          refund: null,
        },
      }),
    ).toBe(2);
  });

  it('REFUND balance check: wallet after refund equals wallet before redemption', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(1000);
    const admin = await harness.user('ADMIN');

    const initialBalance = await getAvailableBalance(user.id);
    expect(initialBalance).toBeGreaterThan(0);

    const redeemed = await redeemVoucherForUser(user, voucherId);
    const balanceAfterRedeem = await getAvailableBalance(user.id);
    expect(balanceAfterRedeem).toBe(initialBalance - redeemed.pointsSpent);

    const report = await myVouchersService.reportCodeIssue(
      user.id,
      redeemed.redemptionId,
      { reason: 'CODE_INVALID' },
    );

    await adminService.resolve(
      report.id,
      { outcome: 'REFUND' },
      { id: admin.id, name: 'Admin' },
    );

    const balanceAfterRefund = await getAvailableBalance(user.id);
    expect(balanceAfterRefund).toBe(initialBalance);
  });

  it('append-only trigger rejects UPDATE and DELETE on redemption_refunds', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(500);
    const admin = await harness.user('ADMIN');
    const redeemed = await redeemVoucherForUser(user, voucherId);

    const report = await myVouchersService.reportCodeIssue(
      user.id,
      redeemed.redemptionId,
      { reason: 'STORE_REFUSED' },
    );

    await adminService.resolve(
      report.id,
      { outcome: 'REFUND' },
      { id: admin.id, name: 'Admin' },
    );

    const refund = await harness.prisma.redemptionRefund.findUniqueOrThrow({
      where: { redemptionId: redeemed.redemptionId },
    });

    // Attempting UPDATE directly on PostgreSQL
    await expect(
      harness.prisma.$executeRaw`
        UPDATE redemption_refunds SET points = 9999 WHERE id = ${refund.id}::uuid
      `,
    ).rejects.toThrow();

    // Attempting DELETE directly on PostgreSQL
    await expect(
      harness.prisma.$executeRaw`
        DELETE FROM redemption_refunds WHERE id = ${refund.id}::uuid
      `,
    ).rejects.toThrow();
  });

  it('reminder job twice in parallel => one Outbox event + one marker per window', async () => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 5 * 86400_000); // 5 days from now -> 7D window

    // Drain prior due reminders from earlier tests so count starts at 0
    await reminderService.runDue(now, 1000);

    const voucher = await harness.prisma.voucher.create({
      data: {
        id: randomUUID(),
        title: 'Expiring Voucher',
        brandId: 'highlands',
        category: 'COFFEE',
        valueVnd: 20_000,
        basePoints: 50,
        priceVersion: 1,
        stockTotal: 5,
        stockRemaining: 5,
        state: 'ACTIVE',
        isVisible: true,
        isSharedCode: true,
        sharedCode: 'SHARED123',
        createdById: randomUUID(),
        redeemStartsAt: new Date(now.getTime() - 86400_000 * 10),
        redeemEndsAt: new Date(now.getTime() - 86400_000 * 3),
        codeExpiresAt: expiresAt,
      },
    });

    const user = await activeRespondent(500);
    const redemptionId = randomUUID();
    await harness.prisma.redemption.create({
      data: {
        id: redemptionId,
        idempotencyKey: `idem-${randomUUID()}`,
        userId: user.id,
        voucherId: voucher.id,
        priceVersion: 1,
        status: 'SUCCEEDED',
        pricePoints: 50,
        priceSource: 'BASE',
        journalId: randomUUID(),
        balanceAfter: 450,
        reference: `RDM-2610-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        createdAt: new Date(now.getTime() - 86400_000 * 8),
      },
    });

    const [run1, run2] = await Promise.all([
      reminderService.runDue(now, 100),
      reminderService.runDue(now, 100),
    ]);

    expect(run1.emitted + run2.emitted).toBe(1);

    const reminders = await harness.prisma.redemptionReminder.findMany({
      where: { redemptionId },
    });
    expect(reminders).toHaveLength(1);
    expect(reminders[0].window).toBe('7D');
    expect(
      await harness.prisma.outboxEvent.count({
        where: {
          idempotencyKey: `rewards:voucher-reminder:${redemptionId}:7D`,
        },
      }),
    ).toBe(1);
    expect(
      (await myVouchersRepo.findReminderCandidates(now, 1)).some(
        (candidate) => candidate.redemptionId === redemptionId,
      ),
    ).toBe(false);

    const restarted = new VoucherReminderService({
      ticketWrite: new PrismaMyVouchersRepository(harness.prisma),
      vouchers: new PrismaVoucherRepository(harness.prisma),
      unitOfWork: harness.app.get<UnitOfWorkPort>(UNIT_OF_WORK_PORT),
    });
    expect((await restarted.runDue(now, 100)).emitted).toBe(0);
    expect(
      await harness.prisma.redemptionReminder.count({
        where: { redemptionId },
      }),
    ).toBe(1);
    const key = `rewards:voucher-reminder:${redemptionId}:7D`;
    const event = await harness.prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: key },
    });
    const handler = harness.app.get(VoucherExpiryNotificationHandler, {
      strict: false,
    });
    const envelope = { ...event, attempts: 1 };
    await handler.handle(envelope);
    await handler.handle(envelope);
    expect(
      await harness.prisma.notification.count({
        where: { userId: user.id, dedupeKey: key },
      }),
    ).toBe(1);
  });

  it('reminder skips ticket used after scan but before redemption lock', async () => {
    const now = new Date();
    const voucher = await createVoucherWithCodes(2, 2);
    const user = await activeRespondent(500);
    const redeemed = await redeemVoucherForUser(user, voucher.voucherId);
    const id = redeemed.redemptionId;
    const currentVoucher = await harness.prisma.voucher.findUniqueOrThrow({
      where: { id: voucher.voucherId },
    });
    const expiresAt = currentVoucher.codeExpiresAt;
    await harness.prisma.redemptionUsage.create({
      data: {
        redemptionId: id,
        usedAt: now,
        undoUntil: new Date(now.getTime() + 86_400_000),
      },
    });
    const staleReader = Object.create(
      myVouchersRepo,
    ) as PrismaMyVouchersRepository;
    staleReader.findReminderCandidates = async () => [
      {
        redemptionId: id,
        userId: user.id,
        voucherId: voucher.voucherId,
        redeemedAt: new Date(now.getTime() - 8 * 86_400_000),
        expiresAt,
      },
    ];
    const service = new VoucherReminderService({
      ticketWrite: staleReader,
      vouchers: voucherRepo,
      unitOfWork: harness.app.get<UnitOfWorkPort>(UNIT_OF_WORK_PORT),
    });
    expect((await service.runDue(now, 1)).emitted).toBe(0);
    expect(
      await harness.prisma.redemptionReminder.count({
        where: { redemptionId: id },
      }),
    ).toBe(0);
  });

  it('refunded redemption does not consume the daily points cap', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(1000);
    const admin = await harness.user('ADMIN');
    const redeemed = await redeemVoucherForUser(user, voucherId);
    const redemptionRepo = new PrismaRedemptionRepository(harness.prisma);
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    expect(
      await redemptionRepo.countTodayRedeemedPoints(user.id, from, to),
    ).toBeGreaterThan(0);

    const report = await myVouchersService.reportCodeIssue(
      user.id,
      redeemed.redemptionId,
      { reason: 'CODE_INVALID' },
    );
    await adminService.resolve(
      report.id,
      { outcome: 'REFUND' },
      { id: admin.id, name: 'Admin' },
    );
    expect(
      await redemptionRepo.countTodayRedeemedPoints(user.id, from, to),
    ).toBe(0);
  });

  it('reminder candidates skip tickets redeemed inside the window (no starvation)', async () => {
    const now = new Date();
    await reminderService.runDue(now, 1000);
    const voucher = await harness.prisma.voucher.create({
      data: {
        id: randomUUID(),
        title: 'Window Voucher',
        brandId: 'highlands',
        category: 'COFFEE',
        valueVnd: 20_000,
        basePoints: 50,
        priceVersion: 1,
        stockTotal: 5,
        stockRemaining: 5,
        state: 'ACTIVE',
        isVisible: true,
        isSharedCode: true,
        sharedCode: 'SHARED-WIN',
        createdById: randomUUID(),
        redeemStartsAt: new Date(now.getTime() - 86400_000 * 10),
        redeemEndsAt: new Date(now.getTime() - 86400_000 * 3),
        codeExpiresAt: new Date(now.getTime() + 5 * 86400_000),
      },
    });
    const user = await activeRespondent(500);
    const mk = async (createdAt: Date) => {
      const id = randomUUID();
      await harness.prisma.redemption.create({
        data: {
          id,
          idempotencyKey: `idem-${randomUUID()}`,
          userId: user.id,
          voucherId: voucher.id,
          priceVersion: 1,
          status: 'SUCCEEDED',
          pricePoints: 50,
          priceSource: 'BASE',
          journalId: randomUUID(),
          balanceAfter: 450,
          reference: `RDM-2610-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          createdAt,
        },
      });
      return id;
    };
    // redeemed 1 day ago, expires in 5 days: inside the 7D window => never due
    const inside = await mk(new Date(now.getTime() - 86_400_000));
    // redeemed 8 days ago: due
    const due = await mk(new Date(now.getTime() - 8 * 86_400_000));
    const ids = (await myVouchersRepo.findReminderCandidates(now, 100)).map(
      (c) => c.redemptionId,
    );
    expect(ids).toContain(due);
    expect(ids).not.toContain(inside);
  });

  it('history pages are stable, complete and total is exact', async () => {
    const { voucherId } = await createVoucherWithCodes(5, 5);
    const user = await activeRespondent(1000);
    const admin = await harness.user('ADMIN');
    const a = await redeemVoucherForUser(user, voucherId);
    await redeemVoucherForUser(user, voucherId);
    const report = await myVouchersService.reportCodeIssue(
      user.id,
      a.redemptionId,
      { reason: 'CODE_INVALID' },
    );
    await adminService.resolve(
      report.id,
      { outcome: 'REFUND' },
      { id: admin.id, name: 'Admin' },
    );
    // 2 redemptions + 1 refund
    const p1 = await myVouchersRepo.listHistory(user.id, 2, 0);
    const p2 = await myVouchersRepo.listHistory(user.id, 2, 2);
    expect(p1.total).toBe(3);
    expect(p1.items).toHaveLength(2);
    expect(p2.items).toHaveLength(1);
    const all = [...p1.items, ...p2.items];
    expect(new Set(all.map((i) => i.id)).size).toBe(3);
    expect(all.filter((i) => i.kind === 'REFUNDED')).toHaveLength(1);
    expect(p1.monthSummaryRows.length).toBeGreaterThan(0);
  });

  it('code-issue outbox handler runs twice => one notification, REFUNDED mentions points', async () => {
    const { voucherId } = await createVoucherWithCodes(3, 3);
    const user = await activeRespondent(1000);
    const admin = await harness.user('ADMIN');
    const redeemed = await redeemVoucherForUser(user, voucherId);
    const report = await myVouchersService.reportCodeIssue(
      user.id,
      redeemed.redemptionId,
      { reason: 'CODE_INVALID' },
    );
    await adminService.resolve(
      report.id,
      { outcome: 'REFUND' },
      { id: admin.id, name: 'Admin' },
    );
    const key = `rewards:code-issue:${report.id}:resolved`;
    const event = await harness.prisma.outboxEvent.findUniqueOrThrow({
      where: { idempotencyKey: key },
    });
    const handler = harness.app.get(CodeIssueNotificationHandler, {
      strict: false,
    });
    const envelope = { ...event, attempts: 1 };
    await handler.handle(envelope);
    await handler.handle(envelope);
    const notes = await harness.prisma.notification.findMany({
      where: { userId: user.id, dedupeKey: key },
    });
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/Đã hoàn \d+ điểm/);
  });
});
