import { InMemoryUserRepository } from './in-memory-user.repository';
import { PrismaUserRepository } from './prisma-user.repository';
import { EmailAlreadyRegisteredException } from '../../auth/application/exceptions/auth.exceptions';
import { User } from '../domain/user.entity';
import { PrismaUserAdminTransactionAdapter } from './prisma-user-admin-transaction.adapter';

describe('UserRepository (Task 3 Integration)', () => {
  let repository: InMemoryUserRepository;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
  });

  it('should find user by normalized email regardless of input casing/whitespace', async () => {
    await repository.create({
      email: 'user@example.com',
      passwordHash: '$2a$12$somehash',
    });

    const found = await repository.findByEmail('  USER@example.COM  ');
    expect(found).not.toBeNull();
    expect(found?.email).toBe('user@example.com');
    expect(found?.role).toBe('RESPONDENT');
    expect(found?.status).toBe('ACTIVE');
  });

  it('should create user with explicit and default properties', async () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const user = await repository.create({
      id,
      email: 'test@example.com',
      passwordHash: '$2a$12$hashed',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    expect(user.id).toBe(id);
    expect(user.email).toBe('test@example.com');
    expect(user.passwordHash).toBe('$2a$12$hashed');
    expect(user.role).toBe('RESPONDENT');
    expect(user.status).toBe('ACTIVE');
  });

  it('should prevent duplicate registration and handle concurrent creations safely', async () => {
    const registration1 = repository.create({
      email: 'concurrent@example.com',
      passwordHash: '$2a$12$hash1',
    });

    const registration2 = repository.create({
      email: 'concurrent@example.com',
      passwordHash: '$2a$12$hash2',
    });

    const results = await Promise.allSettled([registration1, registration2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (rejected[0].status === 'rejected') {
      expect((rejected[0].reason as any).code).toBe(
        'AUTH_EMAIL_ALREADY_REGISTERED',
      );
    }
  });

  it('should support nullable passwordHash for future identity providers', async () => {
    const user = await repository.create({
      email: 'oauth@example.com',
      passwordHash: null,
    });

    expect(user.passwordHash).toBeNull();
    expect(user.hasPassword()).toBe(false);
  });

  it('uses id as a deterministic tie-breaker for equal creation times', async () => {
    const createdAt = new Date('2026-09-14T10:00:00.000Z');
    repository.save(
      new User({
        id: '00000000-0000-0000-0000-000000000001',
        email: 'one@example.com',
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
        createdAt,
      }),
    );
    repository.save(
      new User({
        id: '00000000-0000-0000-0000-000000000002',
        email: 'two@example.com',
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
        createdAt,
      }),
    );

    const result = await repository.findMany({ page: 1, limit: 10 });
    expect(result.users.map((user) => user.id)).toEqual([
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
    ]);
  });
});

describe('PrismaUserRepository', () => {
  it('should map Prisma P2002 error to EmailAlreadyRegisteredException', async () => {
    const mockPrisma: any = {
      user: {
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };
    const repo = new PrismaUserRepository(mockPrisma);

    await expect(
      repo.create({
        email: 'duplicate@example.com',
        passwordHash: '$2a$12$hash',
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredException);
  });

  it('applies filters, stable pagination ordering, and returns the matching count', async () => {
    const rawUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'admin@example.com',
      passwordHash: 'hash',
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    };
    const mockPrisma: any = {
      user: {
        findMany: jest.fn().mockResolvedValue([rawUser]),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const repo = new PrismaUserRepository(mockPrisma);

    const result = await repo.findMany({
      page: 2,
      limit: 5,
      search: ' ADMIN ',
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    const where = {
      email: { contains: 'ADMIN', mode: 'insensitive' },
      role: 'ADMIN',
      status: 'ACTIVE',
    };
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where,
      skip: 5,
      take: 5,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect(mockPrisma.user.count).toHaveBeenCalledWith({ where });
    expect(result.total).toBe(1);
    expect(result.users[0].id).toBe(rawUser.id);
  });

  it('counts users by role and status', async () => {
    const mockPrisma: any = {
      user: { count: jest.fn().mockResolvedValue(2) },
    };
    const repo = new PrismaUserRepository(mockPrisma);

    await expect(repo.countByRoleAndStatus('ADMIN', 'ACTIVE')).resolves.toBe(2);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({
      where: { role: 'ADMIN', status: 'ACTIVE' },
    });
  });
});

describe('PrismaUserAdminTransactionAdapter', () => {
  it('executes lock, mutation, session revocation, and audit in one transaction context', async () => {
    const rawUser = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      email: 'admin@example.com',
      passwordHash: 'hash',
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: rawUser.id }]),
      user: {
        findUnique: jest.fn().mockResolvedValue(rawUser),
        update: jest.fn().mockResolvedValue({ ...rawUser, status: 'LOCKED' }),
      },
      session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      identityAuditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      $transaction: jest.fn(async (work: (client: any) => Promise<unknown>) =>
        work(tx),
      ),
    };
    const adapter = new PrismaUserAdminTransactionAdapter(prisma);

    const result = await adapter.run(async (ctx) => {
      expect(await ctx.lockActiveAdmins()).toBe(1);
      expect(await ctx.findUserById(rawUser.id)).not.toBeNull();
      const updated = await ctx.updateUserStatus(rawUser.id, 'LOCKED');
      await ctx.revokeUserSessions(rawUser.id);
      await ctx.appendAuditLog({
        action: 'USER_STATUS_CHANGED',
        userId: rawUser.id,
        targetUserId: rawUser.id,
        outcome: 'SUCCESS',
      });
      return updated;
    });

    expect(result.status).toBe('LOCKED');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.session.updateMany).toHaveBeenCalledWith({
      where: { userId: rawUser.id, revoked: false },
      data: { revoked: true },
    });
    expect(tx.identityAuditLog.create).toHaveBeenCalledTimes(1);
  });
});
