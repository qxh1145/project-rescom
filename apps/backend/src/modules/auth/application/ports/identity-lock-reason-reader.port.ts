/**
 * Read side of the identity audit log for the admin user DTO (mock-off plan
 * 4.6): the reason an Admin gave when locking an account
 * (`PATCH /admin/users/:id/status`, stored in the `USER_STATUS_CHANGED`
 * audit metadata). Implemented by the identity audit repositories.
 */
export interface IdentityLockReasonReader {
  /**
   * For each id whose latest effective (`changed: true`) status change locked
   * the account, the reason recorded with it. Ids without one are absent.
   */
  findLatestLockReasons(
    userIds: readonly string[],
  ): Promise<Map<string, string>>;
}

export function isIdentityLockReasonReader(
  value: unknown,
): value is IdentityLockReasonReader {
  return (
    typeof (value as Partial<IdentityLockReasonReader> | null)
      ?.findLatestLockReasons === 'function'
  );
}

/** The reason of one audit record, when it is an effective lock with a reason. */
export function lockReasonOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  if (record.newStatus !== 'LOCKED' || typeof record.reason !== 'string') {
    return null;
  }
  return record.reason.trim() || null;
}
