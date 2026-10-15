import { FixedClock } from '../../../common/time/clock';
import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import { InMemoryMyVouchersRepository } from '../infrastructure/in-memory-my-vouchers.repository';
import { RewardsMyVouchersService } from './rewards-my-vouchers.service';
import { RewardsAdminCodeIssuesService } from './rewards-admin-code-issues.service';
import { VoucherReminderService } from './voucher-reminder.service';
import {
  VoucherRepositoryPort,
  RewardsAuditEvent,
} from './ports/voucher-repository.port';
import { ReverseSpendPort } from './ports/reverse-spend.port';
import { AdminCapabilityPort } from '../../economy/application/ports/admin-capability.port';
import {
  TicketNotFoundException,
  TicketExpiredException,
  UndoWindowClosedException,
  CodeIssueAlreadyOpenException,
  CodeIssueAlreadyResolvedException,
  NoReplacementAvailableException,
  ReplacementNotSupportedException,
} from './exceptions/rewards.exceptions';
import {
  voucherTicketListSchema,
  voucherTicketResponseSchema,
  codeIssueReportSchema,
  redemptionHistoryListSchema,
  adminCodeIssueListSchema,
  adminCodeIssueSchema,
} from '@rescom/schemas';

describe('Story 12.10: Application Services (My Vouchers, Admin Code Issues, Reminders)', () => {
  const adminId = '10000000-0000-4000-8000-000000000001';
  const userId = '20000000-0000-4000-8000-000000000002';
  const otherUserId = '20000000-0000-4000-8000-000000000003';
  const voucherId = '30000000-0000-4000-8000-000000000001';
  const redemptionId = '40000000-0000-4000-8000-000000000001';
  const journalId = '50000000-0000-4000-8000-000000000001';

  let clock: FixedClock;
  let repo: InMemoryMyVouchersRepository;
  let uow: PassThroughUnitOfWork;
  let audits: RewardsAuditEvent[];
  let vouchersMock: VoucherRepositoryPort;
  let adminCapMock: AdminCapabilityPort;
  let reverseSpendMock: ReverseSpendPort;

  let myVouchersService: RewardsMyVouchersService;
  let adminService: RewardsAdminCodeIssuesService;
  let reminderService: VoucherReminderService;

  beforeEach(() => {
    clock = new FixedClock(new Date('2026-10-16T10:00:00.000Z'));
    repo = new InMemoryMyVouchersRepository();
    uow = new PassThroughUnitOfWork();
    audits = [];

    // Seed voucher in repo
    repo.seedVoucher({
      id: voucherId,
      title: 'Highlands Coffee 50K',
      brand: { id: 'highlands', name: 'Highlands Coffee' },
      category: 'COFFEE',
      valueVnd: 50000,
      basePoints: 500,
      promoPoints: 400,
      priceVersion: 1,
      stockTotal: 10,
      stockRemaining: 5,
      codesAvailable: 5,
      state: 'ACTIVE',
      isVisible: true,
      isSharedCode: false,
      sharedCode: null,
      redeemStartsAt: '2026-10-01T00:00:00.000Z',
      redeemEndsAt: '2026-10-31T23:59:59.000Z',
      codeExpiresAt: '2026-11-15T23:59:59.000Z',
      description: null,
      whereToUse: null,
      terms: ['Term 1'],
      howToUse: ['Show code to cashier'],
      imageUrl: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      createdById: adminId,
    });

    // Seed codes
    repo.seedCode({
      id: 'code-1',
      voucherId,
      code: 'HL-ORIGINAL-01',
      redemptionId,
      issueReportId: null,
      claimedAt: new Date('2026-10-10T08:00:00.000Z'),
    });
    repo.seedCode({
      id: 'code-replacement',
      voucherId,
      code: 'HL-REPLACE-02',
      redemptionId: null,
      issueReportId: null,
      claimedAt: null,
    });

    // Seed redemption
    repo.seedRedemption({
      id: redemptionId,
      userId,
      voucherId,
      voucherCodeId: 'code-1',
      flashSaleItemId: null,
      quoteId: null,
      status: 'SUCCEEDED',
      pricePoints: 400,
      priceSource: 'PROMO',
      journalId,
      reference: 'RDM-2610-ABCD',
      createdAt: new Date('2026-10-10T08:00:00.000Z'),
    });

    vouchersMock = {
      lock: async () => {},
      list: async () => [],
      findById: async (id) => repo.vouchers.get(id) ?? null,
      listBrands: async () => [],
      create: async (v) => v,
      save: async (v) => v,
      adjustStock: async () => null,
      appendPriceVersion: async () => {},
      priceHistory: async () => [],
      redemptions: async () => [],
      decrementRegularStock: async (id) => {
        const v = repo.vouchers.get(id);
        if (!v || v.stockRemaining <= 0) return false;
        v.stockRemaining--;
        return true;
      },
      appendAudit: async (event) => {
        audits.push(event);
      },
    };

    adminCapMock = {
      findCurrentCapability: async (uid) =>
        uid === adminId
          ? { userId: adminId, role: 'ADMIN', status: 'ACTIVE' }
          : { userId: uid, role: 'USER', status: 'ACTIVE' },
    };

    reverseSpendMock = {
      reverseSpend: async (params) => ({
        journalId: 'rev-' + params.journalId,
      }),
    };

    myVouchersService = new RewardsMyVouchersService({
      readRepo: repo,
      ticketWrite: repo,
      vouchers: vouchersMock,
      unitOfWork: uow,
      now: () => clock.now(),
    });

    adminService = new RewardsAdminCodeIssuesService({
      ticketWrite: repo,
      vouchers: vouchersMock,
      unitOfWork: uow,
      adminCapability: adminCapMock,
      reverseSpend: reverseSpendMock,
      now: () => clock.now(),
    });

    reminderService = new VoucherReminderService({
      ticketWrite: repo,
      vouchers: vouchersMock,
      unitOfWork: uow,
    });
  });

  describe('RewardsMyVouchersService', () => {
    it('listTickets: returns user active tickets matching schema and excludes refunded', async () => {
      const res = await myVouchersService.listTickets(userId);
      const parsed = voucherTicketListSchema.parse(res);
      expect(parsed.total).toBe(1);
      expect(parsed.items[0].id).toBe(redemptionId);
      expect(parsed.items[0].code).toBe('HL-ORIGINAL-01');
      expect(parsed.items[0].status).toBe('UNUSED');
    });

    it('ticket status uses same clock as serverTime at expiry boundary', async () => {
      repo.vouchers.get(voucherId)!.codeExpiresAt = clock.now().toISOString();
      const listed = await myVouchersService.listTickets(userId);
      const detail = await myVouchersService.getTicket(userId, redemptionId);
      expect(listed.serverTime).toBe(clock.now().toISOString());
      expect(listed.items[0].status).toBe('EXPIRED');
      expect(detail.serverTime).toBe(listed.serverTime);
      expect(detail.ticket.status).toBe('EXPIRED');
    });

    it('getTicket: returns ticket detail for owner and 404 for other user or non-existent', async () => {
      const res = await myVouchersService.getTicket(userId, redemptionId);
      const parsed = voucherTicketResponseSchema.parse(res);
      expect(parsed.ticket.id).toBe(redemptionId);

      await expect(
        myVouchersService.getTicket(otherUserId, redemptionId),
      ).rejects.toThrow(TicketNotFoundException);
      await expect(
        myVouchersService.getTicket(
          userId,
          '00000000-0000-4000-8000-000000000000',
        ),
      ).rejects.toThrow(TicketNotFoundException);
    });

    it('markUsed: sets usedAt and undoUntil (+24h), appends audit event', async () => {
      const res = await myVouchersService.markUsed(userId, redemptionId);
      expect(res.ticket.status).toBe('USED');
      expect(res.ticket.usedAt).toBe(clock.now().toISOString());
      expect(res.ticket.undoUntil).toBe(
        new Date(clock.now().getTime() + 86400000).toISOString(),
      );

      expect(audits).toHaveLength(1);
      expect(audits[0].eventType).toBe('REWARDS_TICKET_MARKED_USED');

      // Idempotency: second markUsed returns 200 no-op, same usedAt, no duplicate audit
      const second = await myVouchersService.markUsed(userId, redemptionId);
      expect(second.ticket.usedAt).toBe(res.ticket.usedAt);
      expect(audits).toHaveLength(1);
    });

    it('undoUse: within 24h deletes usage row and appends audit event', async () => {
      await myVouchersService.markUsed(userId, redemptionId);

      // Advance 1 hour
      clock.advance(3600000);
      const undone = await myVouchersService.undoUse(userId, redemptionId);
      expect(undone.ticket.status).toBe('UNUSED');
      expect(undone.ticket.usedAt).toBeNull();
      expect(undone.ticket.undoUntil).toBeNull();

      expect(audits).toHaveLength(2);
      expect(audits[1].eventType).toBe('REWARDS_TICKET_USAGE_UNDONE');

      // Idempotency: second undo returns 200 no-op
      const secondUndo = await myVouchersService.undoUse(userId, redemptionId);
      expect(secondUndo.ticket.status).toBe('UNUSED');
      expect(audits).toHaveLength(2);
    });

    it('use-undo-use in one millisecond writes distinct audit keys', async () => {
      await myVouchersService.markUsed(userId, redemptionId);
      await myVouchersService.undoUse(userId, redemptionId);
      await myVouchersService.markUsed(userId, redemptionId);
      expect(audits).toHaveLength(3);
      expect(new Set(audits.map((event) => event.idempotencyKey)).size).toBe(3);
    });

    it('undoUse: fails with 409 UNDO_WINDOW_CLOSED when now >= undoUntil', async () => {
      await myVouchersService.markUsed(userId, redemptionId);

      // Advance 24 hours + 1 ms
      clock.advance(86400000 + 1);
      await expect(
        myVouchersService.undoUse(userId, redemptionId),
      ).rejects.toThrow(UndoWindowClosedException);
    });

    it('markUsed: fails with 409 TICKET_EXPIRED on expired unused ticket', async () => {
      // Advance clock past voucher expiry (2026-11-15T23:59:59.000Z)
      clock.set(new Date('2026-11-16T00:00:01.000Z'));
      await expect(
        myVouchersService.markUsed(userId, redemptionId),
      ).rejects.toThrow(TicketExpiredException);
    });

    it('reportCodeIssue: creates OPEN report and prevents second open report with 409', async () => {
      const rep = await myVouchersService.reportCodeIssue(
        userId,
        redemptionId,
        { reason: 'CODE_INVALID', note: 'Cashier said invalid' },
      );
      const parsed = codeIssueReportSchema.parse(rep);
      expect(parsed.status).toBe('OPEN');
      expect(parsed.reason).toBe('CODE_INVALID');

      // Second open report rejected with 409 CODE_ISSUE_ALREADY_OPEN
      await expect(
        myVouchersService.reportCodeIssue(userId, redemptionId, {
          reason: 'STORE_REFUSED',
        }),
      ).rejects.toThrow(CodeIssueAlreadyOpenException);
    });

    it('history: returns mixed history and calculates monthSummary', async () => {
      // Seed a failed redemption
      repo.seedRedemption({
        id: '60000000-0000-4000-8000-000000000001',
        userId,
        voucherId,
        voucherCodeId: null,
        flashSaleItemId: null,
        quoteId: null,
        status: 'FAILED',
        pricePoints: 0,
        priceSource: 'BASE',
        journalId: null,
        reference: 'RDM-2610-FAIL',
        createdAt: new Date('2026-10-12T10:00:00.000Z'),
        failureCode: 'SOLD_OUT',
      });

      const hist = await myVouchersService.history(userId, {
        limit: 10,
        offset: 0,
      });
      const parsed = redemptionHistoryListSchema.parse(hist);
      expect(parsed.total).toBe(2);
      expect(parsed.monthSummary.pointsSpent).toBe(400);
      expect(parsed.monthSummary.voucherCount).toBe(1);
    });
  });

  describe('RewardsAdminCodeIssuesService', () => {
    let reportId: string;

    beforeEach(async () => {
      const rep = await myVouchersService.reportCodeIssue(
        userId,
        redemptionId,
        { reason: 'CODE_INVALID', note: 'Defective code' },
      );
      reportId = rep.id;
    });

    it('list and get: enforces admin capability check', async () => {
      await expect(
        adminService.list({ status: 'OPEN', limit: 10, offset: 0 }, userId),
      ).rejects.toThrow('Admin capability required');

      const list = await adminService.list(
        { status: 'OPEN', limit: 10, offset: 0 },
        adminId,
      );
      const parsed = adminCodeIssueListSchema.parse(list);
      expect(parsed.total).toBe(1);
      expect(parsed.items[0].id).toBe(reportId);

      const item = await adminService.get(reportId, adminId);
      const parsedItem = adminCodeIssueSchema.parse(item);
      expect(parsedItem.id).toBe(reportId);
    });

    it('resolve REPLACE: claims replacement code, decrements stock, updates ticket code', async () => {
      const initialStock = repo.vouchers.get(voucherId)!.stockRemaining;

      const resolved = await adminService.resolve(
        reportId,
        { outcome: 'REPLACE', note: 'Replaced with fresh code' },
        { id: adminId, name: 'Admin User' },
      );
      expect(resolved.status).toBe('REPLACED');
      expect(resolved.resolution?.outcome).toBe('REPLACED');
      expect(repo.vouchers.get(voucherId)!.stockRemaining).toBe(
        initialStock - 1,
      );

      // Now user ticket shows replacement code
      const ticketRes = await myVouchersService.getTicket(userId, redemptionId);
      expect(ticketRes.ticket.code).toBe('HL-REPLACE-02');
      expect(ticketRes.ticket.openIssue?.status).toBe('REPLACED');

      // Idempotency: resolving again with REPLACE returns 200 no-op
      const second = await adminService.resolve(
        reportId,
        { outcome: 'REPLACE' },
        { id: adminId, name: 'Admin User' },
      );
      expect(second.status).toBe('REPLACED');

      // Conflicting resolution with different outcome throws 409
      await expect(
        adminService.resolve(
          reportId,
          { outcome: 'REFUND' },
          { id: adminId, name: 'Admin User' },
        ),
      ).rejects.toThrow(CodeIssueAlreadyResolvedException);
    });

    it('resolve REPLACE: keeps replacement code after a later report and resets usage', async () => {
      await myVouchersService.markUsed(userId, redemptionId);
      await adminService.resolve(
        reportId,
        { outcome: 'REPLACE' },
        { id: adminId, name: 'Admin User' },
      );

      // new code has never been used
      const afterReplace = await myVouchersService.getTicket(
        userId,
        redemptionId,
      );
      expect(afterReplace.ticket.status).not.toBe('USED');
      expect(afterReplace.ticket.usedAt).toBeNull();

      // user reports again: replacement code must stay visible
      await myVouchersService.reportCodeIssue(userId, redemptionId, {
        reason: 'OTHER',
      });
      const afterSecond = await myVouchersService.getTicket(
        userId,
        redemptionId,
      );
      expect(afterSecond.ticket.code).toBe('HL-REPLACE-02');
    });

    it('resolve REFUND: reverses journal, inserts refund, frees flash claim, excludes from active tickets', async () => {
      repo.flashClaims.add(redemptionId);

      const resolved = await adminService.resolve(
        reportId,
        { outcome: 'REFUND', note: 'Points refunded' },
        { id: adminId, name: 'Admin User' },
      );
      expect(resolved.status).toBe('REFUNDED');
      expect(resolved.resolution?.outcome).toBe('REFUNDED');
      expect(resolved.resolution?.refundReference).toMatch(
        /^RFD-\d{4}-[0-9A-Z]{4}$/,
      );
      expect(repo.flashClaims.has(redemptionId)).toBe(false);

      // Active ticket list now excludes refunded ticket
      const list = await myVouchersService.listTickets(userId);
      expect(list.items).toHaveLength(0);

      // Deep link still returns ticket explaining what happened
      const deepLink = await myVouchersService.getTicket(userId, redemptionId);
      expect(deepLink.ticket.openIssue?.status).toBe('REFUNDED');
      expect(deepLink.ticket.code).toBe('••••');

      // History now shows both original redemption and refund
      const hist = await myVouchersService.history(userId, {
        limit: 10,
        offset: 0,
      });
      expect(hist.total).toBe(2);
      expect(hist.monthSummary.pointsSpent).toBe(0);
      expect(hist.monthSummary.voucherCount).toBe(0);
    });

    it('resolve REJECT: requires non-empty note, moves no stock/code, allows user to report again', async () => {
      const resolved = await adminService.resolve(
        reportId,
        { outcome: 'REJECT', note: 'Customer used code already' },
        { id: adminId, name: 'Admin User' },
      );
      expect(resolved.status).toBe('REJECTED');
      expect(resolved.resolution?.outcome).toBe('REJECTED');

      // Ticket still shows original code
      const ticketRes = await myVouchersService.getTicket(userId, redemptionId);
      expect(ticketRes.ticket.code).toBe('HL-ORIGINAL-01');

      // User can open a new report because no OPEN report remains
      const secondRep = await myVouchersService.reportCodeIssue(
        userId,
        redemptionId,
        { reason: 'OTHER', note: 'Appeal rejection' },
      );
      expect(secondRep.status).toBe('OPEN');
    });

    it('resolve REPLACE: blocked for shared-code voucher', async () => {
      const v = repo.vouchers.get(voucherId)!;
      v.isSharedCode = true;

      await expect(
        adminService.resolve(
          reportId,
          { outcome: 'REPLACE' },
          { id: adminId, name: 'Admin User' },
        ),
      ).rejects.toThrow(ReplacementNotSupportedException);
    });

    it('resolve REPLACE: blocked when no stock remaining', async () => {
      const v = repo.vouchers.get(voucherId)!;
      v.stockRemaining = 0;

      await expect(
        adminService.resolve(
          reportId,
          { outcome: 'REPLACE' },
          { id: adminId, name: 'Admin User' },
        ),
      ).rejects.toThrow(NoReplacementAvailableException);
    });

    it('resolve REPLACE: blocked when code expired or no code available', async () => {
      const v = repo.vouchers.get(voucherId)!;
      v.codeExpiresAt = clock.now().toISOString();
      await expect(
        adminService.resolve(
          reportId,
          { outcome: 'REPLACE' },
          { id: adminId, name: 'Admin User' },
        ),
      ).rejects.toThrow(TicketExpiredException);

      v.codeExpiresAt = '2026-11-15T23:59:59.000Z';
      v.codesAvailable = 0;
      await expect(
        adminService.resolve(
          reportId,
          { outcome: 'REPLACE' },
          { id: adminId, name: 'Admin User' },
        ),
      ).rejects.toThrow(NoReplacementAvailableException);
    });
  });

  describe('VoucherReminderService', () => {
    it('runDue: emits reminder for ticket in 7D window, skips if already emitted', async () => {
      // Set voucher code_expires_at to 6 days from now
      const v = repo.vouchers.get(voucherId)!;
      v.codeExpiresAt = new Date(
        clock.now().getTime() + 6 * 86400000,
      ).toISOString();

      const run1 = await reminderService.runDue(clock.now(), 50);
      expect(run1.emitted).toBe(1);
      expect(run1.skipped).toBe(0);
      expect(run1.errored).toBe(0);

      expect(audits).toHaveLength(1);
      expect(audits[0].eventType).toBe('REWARDS_VOUCHER_EXPIRY_REMINDER');
      expect(audits[0].payload).toMatchObject({
        redemptionId,
        window: '7D',
      });

      // Second run: already-sent window is excluded before the batch limit
      const run2 = await reminderService.runDue(clock.now(), 50);
      expect(run2.emitted).toBe(0);
      expect(run2.skipped).toBe(0);
      expect(audits).toHaveLength(1);
    });

    it('runDue: persists 7D and 1D windows across service restarts', async () => {
      const v = repo.vouchers.get(voucherId)!;
      v.codeExpiresAt = new Date(
        clock.now().getTime() + 6 * 86400000,
      ).toISOString();

      expect(await reminderService.runDue(clock.now(), 50)).toMatchObject({
        emitted: 1,
      });
      const restarted = new VoucherReminderService({
        ticketWrite: repo,
        vouchers: vouchersMock,
        unitOfWork: uow,
      });
      expect(await restarted.runDue(clock.now(), 50)).toMatchObject({
        emitted: 0,
      });

      clock.advance(5 * 86400000);
      expect(await restarted.runDue(clock.now(), 50)).toMatchObject({
        emitted: 1,
      });
      expect(audits.map((event) => event.payload.window)).toEqual(['7D', '1D']);
      expect(await reminderService.runDue(clock.now(), 50)).toMatchObject({
        emitted: 0,
      });
    });

    it('runDue: skips tickets already marked used or refunded', async () => {
      const v = repo.vouchers.get(voucherId)!;
      v.codeExpiresAt = new Date(
        clock.now().getTime() + 6 * 86400000,
      ).toISOString();

      // Mark used
      await myVouchersService.markUsed(userId, redemptionId);
      audits.length = 0;

      const run = await reminderService.runDue(clock.now(), 50);
      expect(run.emitted).toBe(0);
      expect(audits).toHaveLength(0);
    });
  });
});
