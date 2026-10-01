import type { UserStatus } from '../../domain/user.entity';

/**
 * Identity-owned account lookups for admin read views (mock-off plan 4.1 and
 * 4.2, AD-16). Every method is bounded by the caller's id list.
 */
export const ADMIN_USER_DIRECTORY_PORT = Symbol('ADMIN_USER_DIRECTORY_PORT');

export interface AdminUserLabel {
  displayName: string | null;
  email: string;
}

export interface AdminUserDirectoryPort {
  findStatuses(userIds: readonly string[]): Promise<Map<string, UserStatus>>;
  /** Display name and e-mail per existing id, in one query. */
  findLabels(userIds: readonly string[]): Promise<Map<string, AdminUserLabel>>;
  /**
   * The ids among `userIds` whose short code (`@rescom/schemas`
   * `shortCodePrefixOf`: a prefix of the id's hex digits), e-mail or display
   * name contains `term` (case-insensitive), in input order.
   */
  filterMatching(term: string, userIds: readonly string[]): Promise<string[]>;
}
