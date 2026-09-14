import { PrismaAuditLogRepository } from './prisma-audit-log.repository';
import { PrismaService } from '../../../common/database/prisma.service';
import { ImmutableAuditLogException } from '../application/exceptions/audit-log.exceptions';

describe('PrismaAuditLogRepository', () => {
  let repository: PrismaAuditLogRepository;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      identityAuditLog: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    repository = new PrismaAuditLogRepository(mockPrisma as PrismaService);
  });

  describe('append', () => {
    it('should insert record and return domain entity', async () => {
      const raw = {
        id: '11111111-1111-1111-1111-111111111111',
        action: 'USER_ROLE_CHANGED',
        userId: '22222222-2222-2222-2222-222222222222',
        targetUserId: '33333333-3333-3333-3333-333333333333',
        outcome: 'SUCCESS',
        errorCode: null,
        metadata: { role: 'ADMIN' },
        createdAt: new Date(),
      };

      mockPrisma.identityAuditLog.create.mockResolvedValueOnce(raw);

      const result = await repository.append({
        action: 'USER_ROLE_CHANGED',
        userId: '22222222-2222-2222-2222-222222222222',
        targetUserId: '33333333-3333-3333-3333-333333333333',
        outcome: 'SUCCESS',
        metadata: { role: 'ADMIN' },
      });

      expect(mockPrisma.identityAuditLog.create).toHaveBeenCalled();
      expect(result.id).toBe(raw.id);
      expect(result.action).toBe('USER_ROLE_CHANGED');
    });
  });

  describe('findMany', () => {
    it('should query with filters and pagination via $transaction', async () => {
      const rawLogs = [
        {
          id: '11111111-1111-1111-1111-111111111111',
          action: 'LOGIN_SUCCESS',
          userId: '22222222-2222-2222-2222-222222222222',
          targetUserId: null,
          outcome: 'SUCCESS',
          errorCode: null,
          metadata: null,
          createdAt: new Date(),
        },
      ];

      mockPrisma.$transaction.mockResolvedValueOnce([rawLogs, 1]);

      const result = await repository.findMany({
        page: 1,
        limit: 10,
        action: 'LOGIN_SUCCESS',
        outcome: 'SUCCESS',
      });

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.identityAuditLog.findMany).toHaveBeenCalledWith({
        where: {
          action: 'LOGIN_SUCCESS',
          outcome: 'SUCCESS',
        },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
      });
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].action).toBe('LOGIN_SUCCESS');
    });

    it('should query with all optional filters (userId, targetUserId, date range)', async () => {
      mockPrisma.$transaction.mockResolvedValueOnce([[], 0]);

      await repository.findMany({
        page: 2,
        limit: 5,
        userId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
        startDate: '2026-09-01T00:00:00.000Z',
        endDate: '2026-09-14T23:59:59.999Z',
      });

      expect(mockPrisma.identityAuditLog.findMany).toHaveBeenCalledWith({
        where: {
          userId: '11111111-1111-1111-1111-111111111111',
          targetUserId: '22222222-2222-2222-2222-222222222222',
          createdAt: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lte: new Date('2026-09-14T23:59:59.999Z'),
          },
        },
        skip: 5,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findById', () => {
    it('should return found audit log', async () => {
      const raw = {
        id: '11111111-1111-1111-1111-111111111111',
        action: 'USER_STATUS_CHANGED',
        userId: null,
        targetUserId: null,
        outcome: 'SUCCESS',
        errorCode: null,
        metadata: null,
        createdAt: new Date(),
      };

      mockPrisma.identityAuditLog.findUnique.mockResolvedValueOnce(raw);

      const result = await repository.findById(raw.id);
      expect(result).not.toBeNull();
      expect(result?.id).toBe(raw.id);
    });

    it('should return null if record does not exist', async () => {
      mockPrisma.identityAuditLog.findUnique.mockResolvedValueOnce(null);

      const result = await repository.findById('missing');
      expect(result).toBeNull();
    });
  });

  describe('Immutability Enforcement', () => {
    it('repository should not expose mutation methods', () => {
      expect((repository as any).update).toBeUndefined();
      expect((repository as any).delete).toBeUndefined();
    });

    it('PrismaService middleware should intercept mutation operations on IdentityAuditLog', async () => {
      const realPrismaService = new PrismaService();

      await expect(
        realPrismaService.identityAuditLog.update({
          where: { id: '00000000-0000-0000-0000-000000000000' },
          data: { action: 'MUTATED' },
        }),
      ).rejects.toThrow(ImmutableAuditLogException);

      await expect(
        realPrismaService.identityAuditLog.updateMany({
          data: { action: 'MUTATED' },
        }),
      ).rejects.toThrow(ImmutableAuditLogException);

      await expect(
        realPrismaService.identityAuditLog.delete({
          where: { id: '00000000-0000-0000-0000-000000000000' },
        }),
      ).rejects.toThrow(ImmutableAuditLogException);

      await expect(
        realPrismaService.identityAuditLog.deleteMany({}),
      ).rejects.toThrow(ImmutableAuditLogException);

      await expect(
        realPrismaService.identityAuditLog.upsert({
          where: { id: '00000000-0000-0000-0000-000000000000' },
          update: {},
          create: { action: 'TEST', outcome: 'SUCCESS' },
        }),
      ).rejects.toThrow(ImmutableAuditLogException);
    });
  });
});
