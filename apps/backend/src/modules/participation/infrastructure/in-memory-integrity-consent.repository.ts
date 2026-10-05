import { randomUUID } from 'crypto';
import {
  AcceptIntegrityConsentParams,
  IntegrityConsentRecord,
  IntegrityConsentRepositoryPort,
} from '../application/ports/integrity-consent-repository.port';

/** Same rules as the Prisma adapter (unique user + purpose + version). */
export class InMemoryIntegrityConsentRepository implements IntegrityConsentRepositoryPort {
  public readonly records: IntegrityConsentRecord[] = [];

  async findLatestAccepted(
    userId: string,
    purpose: string,
  ): Promise<IntegrityConsentRecord | null> {
    return (
      this.records
        .filter(
          (record) =>
            record.userId === userId &&
            record.purpose === purpose &&
            record.revokedAt === null,
        )
        .sort((a, b) => b.noticeVersion - a.noticeVersion)[0] ?? null
    );
  }

  async accept(
    params: AcceptIntegrityConsentParams,
  ): Promise<IntegrityConsentRecord> {
    const index = this.records.findIndex(
      (record) =>
        record.userId === params.userId &&
        record.purpose === params.purpose &&
        record.noticeVersion === params.noticeVersion,
    );
    if (index === -1) {
      const created: IntegrityConsentRecord = {
        id: randomUUID(),
        userId: params.userId,
        purpose: params.purpose,
        noticeVersion: params.noticeVersion,
        grantedAt: params.grantedAt,
        revokedAt: null,
      };
      this.records.push(created);
      return created;
    }
    const existing = this.records[index];
    if (existing.revokedAt === null) {
      return existing;
    }
    const regranted = {
      ...existing,
      revokedAt: null,
      grantedAt: params.grantedAt,
    };
    this.records[index] = regranted;
    return regranted;
  }
}
