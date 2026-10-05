import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { currentClient } from '../../../common/database/prisma-unit-of-work';
import {
  AcceptIntegrityConsentParams,
  IntegrityConsentRecord,
  IntegrityConsentRepositoryPort,
} from '../application/ports/integrity-consent-repository.port';

function toRecord(row: {
  id: string;
  userId: string;
  purpose: string;
  noticeVersion: number;
  grantedAt: Date;
  revokedAt: Date | null;
}): IntegrityConsentRecord {
  return {
    id: row.id,
    userId: row.userId,
    purpose: row.purpose,
    noticeVersion: row.noticeVersion,
    grantedAt: row.grantedAt,
    revokedAt: row.revokedAt,
  };
}

@Injectable()
export class PrismaIntegrityConsentRepository implements IntegrityConsentRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findLatestAccepted(
    userId: string,
    purpose: string,
  ): Promise<IntegrityConsentRecord | null> {
    const row = await currentClient(this.prisma).integrityConsent.findFirst({
      where: { userId, purpose, revokedAt: null },
      orderBy: { noticeVersion: 'desc' },
    });
    return row ? toRecord(row) : null;
  }

  /**
   * `INSERT … ON CONFLICT DO NOTHING` on the unique (user, purpose, notice
   * version): a replay or a concurrent acceptance keeps the first row and
   * its `granted_at`. The only update re-grants a revoked acceptance.
   */
  async accept(
    params: AcceptIntegrityConsentParams,
  ): Promise<IntegrityConsentRecord> {
    const client = currentClient(this.prisma);
    const key = {
      userId: params.userId,
      purpose: params.purpose,
      noticeVersion: params.noticeVersion,
    };
    await client.integrityConsent.createMany({
      data: [{ ...key, grantedAt: params.grantedAt }],
      skipDuplicates: true,
    });
    const row = await client.integrityConsent.findUniqueOrThrow({
      where: { userId_purpose_noticeVersion: key },
    });
    if (row.revokedAt === null) {
      return toRecord(row);
    }
    await client.integrityConsent.updateMany({
      where: { id: row.id, revokedAt: { not: null } },
      data: { revokedAt: null, grantedAt: params.grantedAt },
    });
    return toRecord(
      await client.integrityConsent.findUniqueOrThrow({
        where: { id: row.id },
      }),
    );
  }
}
