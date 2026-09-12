import {
  IdentityAuditPort,
  CreateIdentityAuditRecord,
} from '../application/ports/identity-audit.port';

export class InMemoryIdentityAuditRepository implements IdentityAuditPort {
  records: CreateIdentityAuditRecord[] = [];

  async append(record: CreateIdentityAuditRecord): Promise<void> {
    // Append-only. Enforce immutability.
    this.records.push(Object.freeze({ ...record }));
  }

  clear(): void {
    this.records = [];
  }
}
