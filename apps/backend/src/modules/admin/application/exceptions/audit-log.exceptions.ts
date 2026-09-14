export class AuditLogNotFoundException extends Error {
  readonly code = 'AUDIT_LOG_NOT_FOUND';

  constructor(id: string) {
    super(`Audit log record with ID ${id} not found.`);
    this.name = 'AuditLogNotFoundException';
  }
}

export class ImmutableAuditLogException extends Error {
  readonly code = 'IMMUTABLE_AUDIT_LOG';

  constructor(operation: string) {
    super(
      `Audit log records are strictly immutable. Operation '${operation}' is prohibited.`,
    );
    this.name = 'ImmutableAuditLogException';
  }
}
