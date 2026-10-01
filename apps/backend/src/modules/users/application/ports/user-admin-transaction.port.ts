import { User, UserRole, UserStatus } from '../../domain/user.entity';
import { CreateIdentityAuditRecord } from '../../../auth/application/ports/identity-audit.port';
import { SessionRevokeReason } from '../../../auth/domain/session.entity';

export interface UserAdminTransactionContext {
  findUserById(userId: string): Promise<User | null>;
  lockActiveAdmins(): Promise<number>;
  updateUserStatus(userId: string, status: UserStatus): Promise<User>;
  updateUserRole(userId: string, role: UserRole): Promise<User>;
  /** Plan 5.6: `ADMIN_LOCK` or `ROLE_CHANGED`. */
  revokeUserSessions(
    userId: string,
    reason: SessionRevokeReason,
  ): Promise<void>;
  appendAuditLog(record: CreateIdentityAuditRecord): Promise<void>;
}

export interface UserAdminTransactionPort {
  run<T>(work: (ctx: UserAdminTransactionContext) => Promise<T>): Promise<T>;
}

export const USER_ADMIN_TRANSACTION_PORT = Symbol('UserAdminTransactionPort');
