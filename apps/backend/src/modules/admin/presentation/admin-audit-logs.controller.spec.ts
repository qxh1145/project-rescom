import { AdminAuditLogsController } from './admin-audit-logs.controller';
import { AuditLogService } from '../application/audit-log.service';
import { AuditLog } from '../domain/audit-log.entity';
import { AuditLogNotFoundException } from '../application/exceptions/audit-log.exceptions';
import {
  paginatedAuditLogsResponseSchema,
  auditLogDetailResponseSchema,
} from '@rescom/schemas';

describe('AdminAuditLogsController', () => {
  let controller: AdminAuditLogsController;
  let mockAuditLogService: {
    listAuditLogs: jest.Mock;
    getAuditLogById: jest.Mock;
    displayLabels: jest.Mock;
  };

  const sampleLog = new AuditLog({
    id: '123e4567-e89b-12d3-a456-426614174000',
    action: 'USER_ROLE_CHANGED',
    userId: '123e4567-e89b-12d3-a456-426614174001',
    targetUserId: '123e4567-e89b-12d3-a456-426614174002',
    outcome: 'SUCCESS',
    errorCode: null,
    metadata: {
      role: 'ADMIN',
      password: 'plain_secret_text',
      accountNumber: '1234567890',
    },
    createdAt: new Date('2026-09-14T12:00:00.000Z'),
  });

  beforeEach(() => {
    mockAuditLogService = {
      listAuditLogs: jest.fn().mockResolvedValue({
        items: [sampleLog],
        total: 1,
      }),
      getAuditLogById: jest.fn().mockResolvedValue(sampleLog),
      displayLabels: jest.fn().mockResolvedValue(
        new Map([
          [sampleLog.userId!, '  Admin User  '],
          [sampleLog.targetUserId!, null],
        ]),
      ),
    };

    controller = new AdminAuditLogsController(
      mockAuditLogService as unknown as AuditLogService,
    );
  });

  describe('listAuditLogs', () => {
    it('should return paginated audit logs envelope conforming to schema with actor, targetUser, and masked metadata', async () => {
      const response = await controller.listAuditLogs({ page: 1, limit: 20 });

      expect(response.error).toBeNull();
      expect(response.data?.items).toHaveLength(1);
      const item = response.data!.items[0];
      expect(item.id).toBe(sampleLog.id);
      expect(item.createdAt).toBe('2026-09-14T12:00:00.000Z');
      expect(item.actor).toEqual({
        id: sampleLog.userId,
        displayName: 'Admin User',
      });
      expect(item.targetUser).toEqual({
        id: sampleLog.targetUserId,
        displayName: null,
      });
      expect(item.metadata).toEqual({
        role: 'ADMIN',
        password: '[ĐÃ ẨN]',
        accountNumber: '••••7890',
      });
      expect(response.data?.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });

      // Verify conforms to Zod contract
      expect(() =>
        paginatedAuditLogsResponseSchema.parse(response),
      ).not.toThrow();
    });

    it('maps null ids to null refs and a label miss to displayName null', async () => {
      const systemLog = new AuditLog({
        id: '123e4567-e89b-12d3-a456-426614174010',
        action: 'LOGIN_FAILED',
        userId: null,
        targetUserId: null,
        outcome: 'FAILURE',
        errorCode: 'INVALID_CREDENTIALS',
        metadata: null,
        createdAt: new Date('2026-09-14T12:00:00.000Z'),
      });
      const unlabeledLog = new AuditLog({
        id: '123e4567-e89b-12d3-a456-426614174011',
        action: 'USER_LOCKED',
        userId: '123e4567-e89b-12d3-a456-426614174099',
        targetUserId: null,
        outcome: 'SUCCESS',
        errorCode: null,
        metadata: null,
        createdAt: new Date('2026-09-14T11:00:00.000Z'),
      });
      mockAuditLogService.listAuditLogs.mockResolvedValueOnce({
        items: [systemLog, unlabeledLog],
        total: 2,
      });
      mockAuditLogService.displayLabels.mockResolvedValueOnce(new Map());

      const response = await controller.listAuditLogs({ page: 1, limit: 20 });

      const [system, unlabeled] = response.data!.items;
      expect(system.actor).toBeNull();
      expect(system.targetUser).toBeNull();
      expect(unlabeled.actor).toEqual({
        id: unlabeledLog.userId,
        displayName: null,
      });
      expect(unlabeled.targetUser).toBeNull();
      expect(() =>
        paginatedAuditLogsResponseSchema.parse(response),
      ).not.toThrow();
    });
  });

  describe('getAuditLogById', () => {
    it('should return audit log detail envelope conforming to schema with actor, targetUser, and masked metadata', async () => {
      const response = await controller.getAuditLogById(sampleLog.id);

      expect(response.error).toBeNull();
      const auditLog = response.data!.auditLog;
      expect(auditLog.id).toBe(sampleLog.id);
      expect(auditLog.action).toBe('USER_ROLE_CHANGED');
      expect(auditLog.actor).toEqual({
        id: sampleLog.userId,
        displayName: 'Admin User',
      });
      expect(auditLog.targetUser).toEqual({
        id: sampleLog.targetUserId,
        displayName: null,
      });
      expect(auditLog.metadata).toEqual({
        role: 'ADMIN',
        password: '[ĐÃ ẨN]',
        accountNumber: '••••7890',
      });

      // Verify conforms to Zod contract
      expect(() => auditLogDetailResponseSchema.parse(response)).not.toThrow();
    });

    it('should bubble up AuditLogNotFoundException if not found', async () => {
      mockAuditLogService.getAuditLogById.mockRejectedValueOnce(
        new AuditLogNotFoundException('nonexistent-id'),
      );

      await expect(
        controller.getAuditLogById('nonexistent-id'),
      ).rejects.toThrow(AuditLogNotFoundException);
    });
  });
});
