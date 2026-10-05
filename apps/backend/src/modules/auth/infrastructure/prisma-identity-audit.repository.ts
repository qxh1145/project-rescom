import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  IdentityAuditPort,
  CreateIdentityAuditRecord,
} from '../application/ports/identity-audit.port';
import {
  IdentityLockReasonReader,
  lockReasonOf,
} from '../application/ports/identity-lock-reason-reader.port';

@Injectable()
export class PrismaIdentityAuditRepository
  implements IdentityAuditPort, IdentityLockReasonReader
{
  constructor(private readonly prisma: PrismaService) {}

  async append(record: CreateIdentityAuditRecord): Promise<void> {
    await this.prisma.identityAuditLog.create({
      data: {
        action: record.action,
        userId: record.userId,
        targetUserId: record.targetUserId,
        outcome: record.outcome,
        errorCode: record.errorCode,
        metadata: record.metadata as any,
      },
    });
  }

  async findLatestLockReasons(
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    // Latest effective status change per target (index on target_user_id).
    const rows = await this.prisma.$queryRaw<
      Array<{ targetUserId: string; metadata: unknown }>
    >`
      SELECT DISTINCT ON (target_user_id)
        target_user_id::text AS "targetUserId", metadata
      FROM identity_audit_logs
      WHERE action = 'USER_STATUS_CHANGED'
        AND outcome = 'SUCCESS'
        AND target_user_id = ANY(${ids}::uuid[])
        AND metadata->>'changed' = 'true'
      ORDER BY target_user_id, created_at DESC, id DESC
    `;
    const reasons = new Map<string, string>();
    for (const row of rows) {
      const reason = lockReasonOf(row.metadata);
      if (reason) reasons.set(row.targetUserId, reason);
    }
    return reasons;
  }
}
