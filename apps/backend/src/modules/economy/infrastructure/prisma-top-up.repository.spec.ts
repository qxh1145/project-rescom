import { PrismaService } from '../../../common/database/prisma.service';
import { TopUpRequestEntity } from '../domain/top-up-request.entity';
import { TopUpReferenceConflictException } from '../application/exceptions/economy.exceptions';
import { TopUpAdminAuditOutboxEvent } from '../application/ports/top-up-repository.port';
import { PrismaTopUpRepository } from './prisma-top-up.repository';
import { PrismaAdminCapabilityRepository } from './prisma-admin-capability.repository';

function sqlOf(call: unknown[]): string {
  const strings = call[0] as TemplateStringsArray;
  return strings.join('?');
}

describe('Story 6.6: PrismaTopUpRepository', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const topUpId = '33333333-3333-4333-8333-333333333333';
  const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const createdAt = new Date('2026-09-26T09:00:00.000Z');

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: topUpId,
    userId,
    amount: 100,
    amountVnd: 20_000,
    transferReference: 'RESCOMABCDEFGH',
    status: 'PENDING',
    adminId: null,
    journalId: null,
    rejectionReason: null,
    correlationId: null,
    reviewedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  });

  let tx: {
    $queryRaw: jest.Mock;
    topUpRequest: Record<string, jest.Mock>;
    outboxEvent: { create: jest.Mock };
  };
  let prisma: {
    $transaction: jest.Mock;
    topUpRequest: Record<string, jest.Mock>;
  };
  let repo: PrismaTopUpRepository;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      topUpRequest: {
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        updateMany: jest.fn(),
      },
      outboxEvent: { create: jest.fn() },
    };
    prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
      topUpRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    repo = new PrismaTopUpRepository(prisma as unknown as PrismaService);
  });

  const pendingEntity = () =>
    TopUpRequestEntity.create({
      id: topUpId,
      userId,
      amount: 100,
      amountVnd: 20_000,
      transferReference: 'RESCOMABCDEFGH',
      createdAt,
    });

  describe('createPending', () => {
    it('serialises per user with an advisory lock, then inserts a PENDING row', async () => {
      tx.topUpRequest.count.mockResolvedValue(2);
      tx.topUpRequest.create.mockResolvedValue(row());

      const result = await repo.createPending(pendingEntity(), 3);

      expect(result.outcome).toBe('CREATED');
      expect(sqlOf(tx.$queryRaw.mock.calls[0])).toContain(
        'pg_advisory_xact_lock',
      );
      expect(tx.$queryRaw.mock.calls[0][1]).toBe(`top-up:${userId}`);
      expect(tx.topUpRequest.count).toHaveBeenCalledWith({
        where: { userId, status: 'PENDING' },
      });
      expect(tx.topUpRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: topUpId,
          amountVnd: 20_000,
          transferReference: 'RESCOMABCDEFGH',
          status: 'PENDING',
        }),
      });
    });

    it('reports LIMIT_REACHED without inserting', async () => {
      tx.topUpRequest.count.mockResolvedValue(3);
      await expect(repo.createPending(pendingEntity(), 3)).resolves.toEqual({
        outcome: 'LIMIT_REACHED',
        pendingCount: 3,
      });
      expect(tx.topUpRequest.create).not.toHaveBeenCalled();
    });

    it('maps a transfer-reference unique violation to a retryable conflict', async () => {
      tx.topUpRequest.count.mockResolvedValue(0);
      tx.topUpRequest.create.mockRejectedValue(
        Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
          meta: { target: ['transfer_reference'] },
        }),
      );
      await expect(repo.createPending(pendingEntity(), 3)).rejects.toThrow(
        TopUpReferenceConflictException,
      );
    });

    it('rethrows unrelated errors', async () => {
      tx.topUpRequest.count.mockRejectedValue(new Error('connection lost'));
      await expect(repo.createPending(pendingEntity(), 3)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  it('locks the request row FOR UPDATE before reading it', async () => {
    tx.topUpRequest.findUnique.mockResolvedValue(row());
    const entity = await repo.findByIdForUpdate(topUpId);

    expect(sqlOf(tx.$queryRaw.mock.calls[0])).toMatch(
      /FROM top_up_requests WHERE id = \?::uuid FOR UPDATE/,
    );
    expect(entity?.status).toBe('PENDING');
  });

  describe('saveReviewDecision', () => {
    const auditEvent: TopUpAdminAuditOutboxEvent = {
      id: '77777777-7777-4777-8777-777777777777',
      idempotencyKey: `admin-audit:topup-approval:${topUpId}`,
      eventType: 'AdminTopUpApproved',
      producer: 'economy-service',
      aggregateType: 'TopUpRequest',
      aggregateId: topUpId,
      aggregateVersion: 2,
      correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      payload: {
        schemaVersion: 1,
        auditCategory: 'MODERATION_ADMIN_ACTION',
        action: 'TOPUP_APPROVED',
        topUpId,
        userId,
        adminId,
        amount: 100,
        amountVnd: 20_000,
        transferReference: 'RESCOMABCDEFGH',
        journalId: '44444444-4444-4444-8444-444444444444',
        ledgerIdempotencyKey: `topup-approval:${topUpId}`,
        rejectionReason: null,
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        occurredAt: '2026-09-26T10:00:00.000Z',
      },
    };

    const decision = () =>
      pendingEntity().approve({
        adminId,
        journalId: '44444444-4444-4444-8444-444444444444',
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        reviewedAt: new Date('2026-09-26T10:00:00.000Z'),
      });

    it('transitions only a PENDING row and appends the Outbox audit event in the same transaction', async () => {
      tx.topUpRequest.updateMany.mockResolvedValue({ count: 1 });
      tx.topUpRequest.findUniqueOrThrow.mockResolvedValue(
        row({
          status: 'APPROVED',
          adminId,
          journalId: '44444444-4444-4444-8444-444444444444',
        }),
      );

      const saved = await repo.saveReviewDecision(decision(), auditEvent);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.topUpRequest.updateMany).toHaveBeenCalledWith({
        where: { id: topUpId, status: 'PENDING' },
        data: expect.objectContaining({
          status: 'APPROVED',
          adminId,
          journalId: '44444444-4444-4444-8444-444444444444',
          correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        }),
      });
      expect(tx.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          idempotencyKey: `admin-audit:topup-approval:${topUpId}`,
          eventType: 'AdminTopUpApproved',
          producer: 'economy-service',
          aggregateType: 'TopUpRequest',
          aggregateId: topUpId,
          aggregateVersion: 2,
          schemaVersion: 1,
          status: 'PENDING',
          correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          payload: auditEvent.payload,
        }),
      });
      expect(saved?.status).toBe('APPROVED');
    });

    it('returns null and writes no event when the row is no longer PENDING', async () => {
      tx.topUpRequest.updateMany.mockResolvedValue({ count: 0 });
      await expect(
        repo.saveReviewDecision(decision(), auditEvent),
      ).resolves.toBeNull();
      expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    });
  });

  it('lists the PENDING review queue oldest first with the owner email', async () => {
    prisma.topUpRequest.findMany.mockResolvedValue([
      { ...row(), user: { email: 'student@fpt.edu.vn' } },
    ]);
    prisma.topUpRequest.count.mockResolvedValue(1);

    const page = await repo.listForReview({
      limit: 20,
      offset: 0,
      status: 'PENDING',
    });

    expect(prisma.topUpRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'PENDING' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: { user: { select: { email: true } } },
      }),
    );
    expect(page.total).toBe(1);
    expect(page.items[0].userEmail).toBe('student@fpt.edu.vn');
  });

  it("lists a user's requests newest first", async () => {
    prisma.topUpRequest.findMany.mockResolvedValue([row()]);
    prisma.topUpRequest.count.mockResolvedValue(1);

    await repo.listByUser(userId, { limit: 5, offset: 10 });

    expect(prisma.topUpRequest.findMany).toHaveBeenCalledWith({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 5,
    });
  });
});

describe('Story 6.6: PrismaAdminCapabilityRepository', () => {
  it('reads the live role/status FOR SHARE inside the transaction', async () => {
    const tx = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            role: 'ADMIN',
            status: 'ACTIVE',
          },
        ])
        .mockResolvedValueOnce([]),
    };
    const prisma = {
      $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
    };
    const repo = new PrismaAdminCapabilityRepository(
      prisma as unknown as PrismaService,
    );

    await expect(
      repo.findCurrentCapability('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ).resolves.toEqual({
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      role: 'ADMIN',
      status: 'ACTIVE',
    });
    expect(sqlOf(tx.$queryRaw.mock.calls[0])).toContain('FOR SHARE');

    await expect(
      repo.findCurrentCapability('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ).resolves.toBeNull();
  });
});
