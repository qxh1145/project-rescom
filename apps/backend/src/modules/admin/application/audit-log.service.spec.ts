import { AuditLogService } from './audit-log.service';
import { InMemoryAuditLogRepository } from '../infrastructure/in-memory-audit-log.repository';
import { AuditLogNotFoundException } from './exceptions/audit-log.exceptions';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let repository: InMemoryAuditLogRepository;

  beforeEach(() => {
    repository = new InMemoryAuditLogRepository();
    service = new AuditLogService(repository);
  });

  describe('listAuditLogs', () => {
    it('should return paginated audit logs', async () => {
      await repository.append({
        action: 'USER_ROLE_CHANGED',
        userId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '22222222-2222-2222-2222-222222222222',
        outcome: 'SUCCESS',
        metadata: { role: 'ADMIN' },
      });

      await repository.append({
        action: 'USER_STATUS_CHANGED',
        userId: '11111111-1111-1111-1111-111111111111',
        targetUserId: '33333333-3333-3333-3333-333333333333',
        outcome: 'FAILURE',
        errorCode: 'CANNOT_LOCK_LAST_ADMIN',
      });

      const result = await service.listAuditLogs({ page: 1, limit: 10 });
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
    });

    it('should filter by action and outcome', async () => {
      await repository.append({
        action: 'USER_ROLE_CHANGED',
        outcome: 'SUCCESS',
      });

      await repository.append({
        action: 'USER_STATUS_CHANGED',
        outcome: 'FAILURE',
      });

      const result = await service.listAuditLogs({
        page: 1,
        limit: 10,
        action: 'USER_ROLE_CHANGED',
        outcome: 'SUCCESS',
      });

      expect(result.total).toBe(1);
      expect(result.items[0].action).toBe('USER_ROLE_CHANGED');
      expect(result.items[0].outcome).toBe('SUCCESS');
    });

    it('should filter by userId and targetUserId', async () => {
      const userA = '11111111-1111-1111-1111-111111111111';
      const userB = '22222222-2222-2222-2222-222222222222';
      const userC = '33333333-3333-3333-3333-333333333333';

      await repository.append({
        action: 'ACTION_A',
        userId: userA,
        targetUserId: userB,
        outcome: 'SUCCESS',
      });

      await repository.append({
        action: 'ACTION_B',
        userId: userA,
        targetUserId: userC,
        outcome: 'SUCCESS',
      });

      const filterByTarget = await service.listAuditLogs({
        page: 1,
        limit: 10,
        targetUserId: userB,
      });
      expect(filterByTarget.total).toBe(1);
      expect(filterByTarget.items[0].targetUserId).toBe(userB);

      const filterByUser = await service.listAuditLogs({
        page: 1,
        limit: 10,
        userId: userA,
      });
      expect(filterByUser.total).toBe(2);
    });

    it('should filter by date range', async () => {
      const now = new Date();
      await repository.append({
        action: 'TIME_TEST',
        outcome: 'SUCCESS',
      });

      const past = new Date(now.getTime() - 10000).toISOString();
      const future = new Date(now.getTime() + 10000).toISOString();

      const inRange = await service.listAuditLogs({
        page: 1,
        limit: 10,
        startDate: past,
        endDate: future,
      });
      expect(inRange.total).toBe(1);
    });
  });

  describe('getAuditLogById', () => {
    it('should return the audit log if found', async () => {
      const created = await repository.append({
        action: 'LOGIN_SUCCESS',
        userId: '11111111-1111-1111-1111-111111111111',
        outcome: 'SUCCESS',
      });

      const found = await service.getAuditLogById(created.id);
      expect(found.id).toBe(created.id);
      expect(found.action).toBe('LOGIN_SUCCESS');
    });

    it('should throw AuditLogNotFoundException if not found', async () => {
      await expect(
        service.getAuditLogById('00000000-0000-0000-0000-000000000000'),
      ).rejects.toThrow(AuditLogNotFoundException);
    });
  });
});
