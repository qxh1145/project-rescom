import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  IdentityAuditPort,
  CreateIdentityAuditRecord,
} from '../application/ports/identity-audit.port';

@Injectable()
export class PrismaIdentityAuditRepository implements IdentityAuditPort {
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
}
