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
  };

  const sampleLog = new AuditLog({
    id: '123e4567-e89b-12d3-a456-426614174000',
    action: 'USER_ROLE_CHANGED',
    userId: '123e4567-e89b-12d3-a456-426614174001',
    targetUserId: '123e4567-e89b-12d3-a456-426614174002',
    outcome: 'SUCCESS',
    errorCode: null,
    metadata: { role: 'ADMIN' },
    createdAt: new Date('2026-09-14T12:00:00.000Z'),
  });

  beforeEach(() => {
    mockAuditLogService = {
      listAuditLogs: jest.fn().mockResolvedValue({
        items: [sampleLog],
        total: 1,
      }),
      getAuditLogById: jest.fn().mockResolvedValue(sampleLog),
    };

    controller = new AdminAuditLogsController(
      mockAuditLogService as unknown as AuditLogService,
    );
  });

  describe('listAuditLogs', () => {
    it('should return paginated audit logs envelope conforming to schema', async () => {
      const response = await controller.listAuditLogs({ page: 1, limit: 20 });

      expect(response.error).toBeNull();
      expect(response.data?.items).toHaveLength(1);
      expect(response.data?.items[0].id).toBe(sampleLog.id);
      expect(response.data?.items[0].createdAt).toBe(
        '2026-09-14T12:00:00.000Z',
      );
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
  });

  describe('getAuditLogById', () => {
    it('should return audit log detail envelope conforming to schema', async () => {
      const response = await controller.getAuditLogById(sampleLog.id);

      expect(response.error).toBeNull();
      expect(response.data?.auditLog.id).toBe(sampleLog.id);
      expect(response.data?.auditLog.action).toBe('USER_ROLE_CHANGED');

      // Verify conforms to Zod contract
      expect(() => auditLogDetailResponseSchema.parse(response)).not.toThrow();
    });

    it('should bubble up AuditLogNotFoundException if not found', async () => {
      mockAuditLogService.getAuditLogById!.mockRejectedValueOnce(
        new AuditLogNotFoundException('nonexistent-id'),
      );

      await expect(
        controller.getAuditLogById('nonexistent-id'),
      ).rejects.toThrow(AuditLogNotFoundException);
    });
  });
});
