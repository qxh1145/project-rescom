import {
  IdentityAuditPort,
  CreateIdentityAuditRecord,
} from '../application/ports/identity-audit.port';
import {
  IdentityLockReasonReader,
  lockReasonOf,
} from '../application/ports/identity-lock-reason-reader.port';

export class InMemoryIdentityAuditRepository
  implements IdentityAuditPort, IdentityLockReasonReader
{
  records: CreateIdentityAuditRecord[] = [];

  async append(record: CreateIdentityAuditRecord): Promise<void> {
    // Append-only. Enforce immutability.
    this.records.push(Object.freeze({ ...record }));
  }

  snapshot(): CreateIdentityAuditRecord[] {
    return [...this.records];
  }

  restore(snapshot: readonly CreateIdentityAuditRecord[]): void {
    this.records = [...snapshot];
  }

  clear(): void {
    this.records = [];
  }

  async findLatestLockReasons(
    userIds: readonly string[],
  ): Promise<Map<string, string>> {
    const reasons = new Map<string, string>();
    for (const userId of new Set(userIds)) {
      // Records are appended in order: the last effective change wins.
      const latest = [...this.records]
        .reverse()
        .find(
          (record) =>
            record.action === 'USER_STATUS_CHANGED' &&
            record.outcome === 'SUCCESS' &&
            record.targetUserId === userId &&
            record.metadata?.changed === true,
        );
      const reason = latest ? lockReasonOf(latest.metadata) : null;
      if (reason) reasons.set(userId, reason);
    }
    return reasons;
  }
}
