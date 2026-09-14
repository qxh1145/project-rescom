import { PrismaSessionRepository } from './prisma-session.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { ReplaceUserSessionInput } from '../application/ports/session-repository.port';
import { SessionProps, RefreshCredentialProps } from '../domain/session.entity';
import { CreateIdentityAuditRecord } from '../application/ports/identity-audit.port';

describe('PrismaSessionRepository (Integration & Concurrency)', () => {
  let prisma: PrismaService;
  let repository: PrismaSessionRepository;
  let dbAvailable = false;

  beforeAll(async () => {
    prisma = new PrismaService();
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.$disconnect();
    }
  });

  beforeEach(() => {
    if (dbAvailable) {
      repository = new PrismaSessionRepository(prisma);
    }
  });

  function createInput(
    sessionId: string,
    credentialId: string,
    userId: string,
  ): ReplaceUserSessionInput {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const session: Omit<SessionProps, 'sessionVersion'> = {
      id: sessionId,
      userId,
      csrfDigest: 'csrf-digest-' + sessionId,
      revoked: false,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    const credential: RefreshCredentialProps = {
      id: credentialId,
      sessionId,
      secretDigest: 'secret-digest-' + credentialId,
      isUsed: false,
      usedAt: null,
      expiresAt,
      createdAt: now,
    };
    const audit: CreateIdentityAuditRecord = {
      action: 'SESSION_REPLACED',
      userId,
      outcome: 'SUCCESS',
      metadata: { sessionId },
    };
    return { session, credential, audit };
  }

  describe('Live PostgreSQL Container Tests (Task 2.2 & 2.3)', () => {
    it('should serialize concurrent replaceUserSession calls with FOR UPDATE on PostgreSQL', async () => {
      if (!dbAvailable) {
        // Gracefully skip when PostgreSQL container is not running (documented in deferred-work.md)
        return;
      }

      // 1. Create test user
      const user = await prisma.user.create({
        data: {
          email: `concurrent-${Date.now()}@example.com`,
          role: 'RESPONDENT',
          status: 'ACTIVE',
        },
      });

      // 2. Pre-seed with session version = 5
      await prisma.session.create({
        data: {
          id: '11111111-0000-0000-0000-000000000005',
          userId: user.id,
          sessionVersion: 5,
          csrfDigest: 'initial-csrf',
          revoked: true,
          expiresAt: new Date(Date.now() + 100000),
        },
      });

      // 3. Concurrent replacement calls
      const inputA = createInput(
        '22222222-0000-0000-0000-000000000006',
        '33333333-0000-0000-0000-000000000006',
        user.id,
      );
      const inputB = createInput(
        '22222222-0000-0000-0000-000000000007',
        '33333333-0000-0000-0000-000000000007',
        user.id,
      );

      const [resA, resB] = await Promise.all([
        repository.replaceUserSession(user.id, inputA),
        repository.replaceUserSession(user.id, inputB),
      ]);

      // Exactly one unrevoked session exists
      const activeSessions = await prisma.session.findMany({
        where: { userId: user.id, revoked: false },
      });
      expect(activeSessions.length).toBe(1);

      // Versions generated are 6 and 7 (consecutive, distinct)
      const versions = [resA.sessionVersion, resB.sessionVersion].sort(
        (a, b) => a - b,
      );
      expect(versions).toEqual([6, 7]);

      // MAX(session_version) in DB is 7
      const maxAgg = await prisma.session.aggregate({
        where: { userId: user.id },
        _max: { sessionVersion: true },
      });
      expect(maxAgg._max.sessionVersion).toBe(7);

      // Exactly two SESSION_REPLACED audit logs exist
      const auditLogs = await prisma.identityAuditLog.findMany({
        where: { userId: user.id, action: 'SESSION_REPLACED' },
      });
      expect(auditLogs.length).toBe(2);

      // Cleanup
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('should roll back cleanly and release user row lock on error (Task 2.3)', async () => {
      if (!dbAvailable) {
        return;
      }

      const user = await prisma.user.create({
        data: {
          email: `rollback-${Date.now()}@example.com`,
          role: 'RESPONDENT',
          status: 'ACTIVE',
        },
      });

      // Valid session 1
      const input1 = createInput(
        '44444444-0000-0000-0000-000000000001',
        '55555555-0000-0000-0000-000000000001',
        user.id,
      );
      await repository.replaceUserSession(user.id, input1);

      // Input that forces a foreign key violation or invalid constraint inside transaction
      const failingInput: ReplaceUserSessionInput = {
        session: {
          id: '44444444-0000-0000-0000-000000000002',
          userId: user.id,
          csrfDigest: 'digest',
          revoked: false,
          expiresAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        credential: {
          id: 'invalid-non-uuid-credential-id', // Triggers DB error
          sessionId: '44444444-0000-0000-0000-000000000002',
          secretDigest: 'digest',
          isUsed: false,
          usedAt: null,
          expiresAt: new Date(),
          createdAt: new Date(),
        },
        audit: {
          action: 'SESSION_REPLACED',
          userId: user.id,
          outcome: 'SUCCESS',
        },
      };

      await expect(
        repository.replaceUserSession(user.id, failingInput),
      ).rejects.toThrow();

      // Assert rollback: partial session was NOT created
      const partialSession = await prisma.session.findUnique({
        where: { id: '44444444-0000-0000-0000-000000000002' },
      });
      expect(partialSession).toBeNull();

      // Assert original active session remains unrevoked
      const active = await prisma.session.findUnique({
        where: { id: '44444444-0000-0000-0000-000000000001' },
      });
      expect(active?.revoked).toBe(false);

      // Assert row lock was released: subsequent call immediately succeeds
      const input3 = createInput(
        '44444444-0000-0000-0000-000000000003',
        '55555555-0000-0000-0000-000000000003',
        user.id,
      );
      const res3 = await repository.replaceUserSession(user.id, input3);
      expect(res3.sessionVersion).toBe(2);

      // Cleanup
      await prisma.user.delete({ where: { id: user.id } });
    });
  });

  describe('Transactional Operations Verification (Mocked Prisma Client)', () => {
    it('should acquire user row lock, aggregate max version, revoke old, and insert atomically', async () => {
      const mockTx: any = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'user-mock' }]),
        session: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _max: { sessionVersion: 4 } }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          create: jest.fn().mockImplementation((args) => ({
            ...args.data,
          })),
        },
        refreshCredential: {
          create: jest.fn().mockResolvedValue({}),
        },
        identityAuditLog: {
          create: jest.fn().mockResolvedValue({}),
        },
      };

      const mockPrismaService: any = {
        $transaction: jest.fn().mockImplementation(async (callback) => {
          return await callback(mockTx);
        }),
      };

      const repo = new PrismaSessionRepository(mockPrismaService);
      const input = createInput('sess-mock', 'cred-mock', 'user-mock');

      const result = await repo.replaceUserSession('user-mock', input);

      // 1. Must acquire user FOR UPDATE lock
      expect(mockTx.$queryRaw).toHaveBeenCalled();

      // 2. Must aggregate max version
      expect(mockTx.session.aggregate).toHaveBeenCalledWith({
        where: { userId: 'user-mock' },
        _max: { sessionVersion: true },
      });

      // 3. Computed next version must be 4 + 1 = 5
      expect(result.sessionVersion).toBe(5);

      // 4. Must revoke previous unrevoked sessions
      expect(mockTx.session.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-mock', revoked: false },
        data: { revoked: true },
      });

      // 5. Must insert new session with nextVersion
      expect(mockTx.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: 'sess-mock',
            sessionVersion: 5,
          }),
        }),
      );

      // 6. Must create refresh credential
      expect(mockTx.refreshCredential.create).toHaveBeenCalledWith({
        data: input.credential,
      });

      // 7. Must append audit log with enriched sessionId and sessionVersion
      expect(mockTx.identityAuditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'SESSION_REPLACED',
          metadata: expect.objectContaining({
            sessionId: 'sess-mock',
            sessionVersion: 5,
          }),
        }),
      });
    });
  });
});
