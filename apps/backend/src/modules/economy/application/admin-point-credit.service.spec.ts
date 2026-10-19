import { PassThroughUnitOfWork } from '../../../common/database/unit-of-work.port';
import {
  CreateIdentityAuditRecord,
  IdentityAuditPort,
} from '../../auth/application/ports/identity-audit.port';
import { UserNotFoundException } from '../../users/application/exceptions/user-admin.exceptions';
import { InMemoryAdminPointCreditOutbox } from '../infrastructure/in-memory-admin-point-credit-outbox';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { AdminPointCreditService } from './admin-point-credit.service';
import {
  AdminPointCreditCapabilityRequiredException,
  AdminSelfCreditForbiddenException,
  IdempotencyConflictException,
  UserBannedException,
} from './exceptions/economy.exceptions';
import { LedgerService } from './ledger.service';
import {
  ActorCapability,
  AdminCapabilityPort,
} from './ports/admin-capability.port';

describe('AdminPointCreditService', () => {
  let ledgerRepo: InMemoryLedgerRepository;
  let ledgerService: LedgerService;
  let unitOfWork: PassThroughUnitOfWork;
  let outbox: InMemoryAdminPointCreditOutbox;
  let capabilities: Map<string, ActorCapability>;
  let audits: CreateIdentityAuditRecord[];
  let service: AdminPointCreditService;

  const adminId = '11111111-1111-4111-8111-111111111111';
  const targetId = '22222222-2222-4222-8222-222222222222';
  const lockedId = '33333333-3333-4333-8333-333333333333';
  const nonAdminId = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    ledgerRepo = new InMemoryLedgerRepository();
    ledgerService = new LedgerService(ledgerRepo);
    unitOfWork = new PassThroughUnitOfWork();
    outbox = new InMemoryAdminPointCreditOutbox();
    audits = [];
    capabilities = new Map<string, ActorCapability>([
      [adminId, { userId: adminId, role: 'ADMIN', status: 'ACTIVE' }],
      [targetId, { userId: targetId, role: 'RESPONDENT', status: 'ACTIVE' }],
      [lockedId, { userId: lockedId, role: 'RESPONDENT', status: 'LOCKED' }],
      [nonAdminId, { userId: nonAdminId, role: 'PUBLISHER', status: 'ACTIVE' }],
    ]);

    const adminCapability: AdminCapabilityPort = {
      findCurrentCapability: async (userId: string) =>
        capabilities.get(userId) ?? null,
      listActiveAdminIds: async () => [adminId],
    };

    const audit: IdentityAuditPort = {
      append: async (record: CreateIdentityAuditRecord) => {
        audits.push(record);
      },
    };

    service = new AdminPointCreditService(
      ledgerService,
      adminCapability,
      unitOfWork,
      audit,
      outbox,
    );
  });

  const validInput = {
    amount: 1000,
    reason: 'Đền bù sự cố giao dịch PayOS',
    idempotencyKey: '99999999-9999-4999-8999-999999999999',
  };

  it('credits points, posts journal, appends audit, enqueues outbox event', async () => {
    const result = await service.credit(adminId, targetId, validInput);

    expect(result.amount).toBe(1000);
    expect(result.userId).toBe(targetId);
    expect(result.reason).toBe(validInput.reason);
    expect(result.replayed).toBe(false);

    // Ledger balance check
    const wallet = await ledgerService.getWallet(targetId);
    expect(wallet.balance.available).toBe(1000);

    // Audit check
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'ADMIN_POINTS_CREDITED',
      userId: adminId,
      targetUserId: targetId,
      outcome: 'SUCCESS',
      metadata: {
        journalId: result.journalId,
        amount: 1000,
        reason: validInput.reason,
      },
    });

    // Outbox check
    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]).toMatchObject({
      journalId: result.journalId,
      userId: targetId,
      amount: 1000,
      reason: validInput.reason,
      actorId: adminId,
    });
  });

  it('replays same request: returns existing journal with replayed: true, no duplicate audit or outbox', async () => {
    const first = await service.credit(adminId, targetId, validInput);
    const second = await service.credit(adminId, targetId, validInput);

    expect(second.journalId).toBe(first.journalId);
    expect(second.replayed).toBe(true);

    // Wallet balance remains 1000 (not 2000)
    const wallet = await ledgerService.getWallet(targetId);
    expect(wallet.balance.available).toBe(1000);

    // No second audit or outbox
    expect(audits).toHaveLength(1);
    expect(outbox.enqueued).toHaveLength(1);
  });

  it('incompatible replay with different amount throws IdempotencyConflictException', async () => {
    await service.credit(adminId, targetId, validInput);

    await expect(
      service.credit(adminId, targetId, {
        ...validInput,
        amount: 2000,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictException);

    expect(audits).toHaveLength(1);
    expect(outbox.enqueued).toHaveLength(1);
  });

  it('refuses when actor is not an active admin: throws AdminPointCreditCapabilityRequiredException, posts nothing', async () => {
    await expect(
      service.credit(nonAdminId, targetId, validInput),
    ).rejects.toBeInstanceOf(AdminPointCreditCapabilityRequiredException);

    const wallet = await ledgerService.getWallet(targetId);
    expect(wallet.balance.available).toBe(0);
    expect(audits).toHaveLength(0);
    expect(outbox.enqueued).toHaveLength(0);
  });

  it('refuses self-credit: throws AdminSelfCreditForbiddenException, posts nothing', async () => {
    await expect(
      service.credit(adminId, adminId, validInput),
    ).rejects.toBeInstanceOf(AdminSelfCreditForbiddenException);

    const wallet = await ledgerService.getWallet(adminId);
    expect(wallet.balance.available).toBe(0);
    expect(audits).toHaveLength(0);
    expect(outbox.enqueued).toHaveLength(0);
  });

  it('refuses when target user not found: throws UserNotFoundException, posts nothing', async () => {
    const missingTarget = '88888888-8888-4888-8888-888888888888';
    await expect(
      service.credit(adminId, missingTarget, validInput),
    ).rejects.toBeInstanceOf(UserNotFoundException);

    expect(audits).toHaveLength(0);
    expect(outbox.enqueued).toHaveLength(0);
  });

  it('refuses when target user is LOCKED: throws UserBannedException, posts nothing', async () => {
    await expect(
      service.credit(adminId, lockedId, validInput),
    ).rejects.toBeInstanceOf(UserBannedException);

    const wallet = await ledgerService.getWallet(lockedId);
    expect(wallet.balance.available).toBe(0);
    expect(audits).toHaveLength(0);
    expect(outbox.enqueued).toHaveLength(0);
  });
});
