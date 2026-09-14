import { User, UserRole, UserStatus } from '../domain/user.entity';
import {
  UserRepositoryPort,
  ListUsersParams,
  PaginatedUsersResult,
} from './ports/user.repository.port';
import { UserAdminTransactionPort } from './ports/user-admin-transaction.port';
import { IdentityAuditPort } from '../../auth/application/ports/identity-audit.port';
import {
  UserNotFoundException,
  CannotLockSelfException,
  CannotLockLastAdminException,
  CannotDemoteSelfException,
  CannotDemoteLastAdminException,
} from './exceptions/user-admin.exceptions';

export class UserAdminService {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly transactionPort: UserAdminTransactionPort,
    private readonly auditPort: IdentityAuditPort,
  ) {}

  async listUsers(params: ListUsersParams): Promise<PaginatedUsersResult> {
    return await this.userRepository.findMany(params);
  }

  async getUserById(userId: string): Promise<User> {
    const user = await this.userRepository.findById(userId);
    if (!user) {
      throw new UserNotFoundException();
    }
    return user;
  }

  async updateUserStatus(
    actorUserId: string,
    targetUserId: string,
    newStatus: UserStatus,
    auditMetadata?: Record<string, unknown>,
  ): Promise<User> {
    // 1. Check self-lock outside transaction (depends only on IDs)
    if (actorUserId === targetUserId && newStatus === 'LOCKED') {
      await this.auditPort.append({
        action: 'USER_STATUS_CHANGED',
        userId: actorUserId,
        targetUserId,
        outcome: 'FAILURE',
        errorCode: 'CANNOT_LOCK_SELF',
        metadata: auditMetadata,
      });
      throw new CannotLockSelfException();
    }

    // 2. Transactional execution with fresh snapshot
    try {
      return await this.transactionPort.run(async (ctx) => {
        // Serialize every role/status transition against the active-admin set.
        // This prevents a concurrent promotion/unlock from entering the set
        // between an unlocked predicate check and the eventual mutation.
        const activeAdminCount = await ctx.lockActiveAdmins();
        const target = await ctx.findUserById(targetUserId);
        if (!target) {
          throw new UserNotFoundException();
        }

        // No-op check inside transaction
        if (target.status === newStatus) {
          await ctx.appendAuditLog({
            action: 'USER_STATUS_CHANGED',
            userId: actorUserId,
            targetUserId,
            outcome: 'SUCCESS',
            metadata: {
              ...auditMetadata,
              previousStatus: target.status,
              newStatus,
              changed: false,
              noOp: true,
            },
          });
          return target;
        }

        // If locking an active admin, verify the invariant against the rows
        // locked before the target snapshot was read.
        if (
          target.role === 'ADMIN' &&
          target.status === 'ACTIVE' &&
          newStatus === 'LOCKED'
        ) {
          if (activeAdminCount <= 1) {
            throw new CannotLockLastAdminException();
          }
        }

        const updated = await ctx.updateUserStatus(targetUserId, newStatus);
        if (newStatus === 'LOCKED') {
          await ctx.revokeUserSessions(targetUserId);
        }

        await ctx.appendAuditLog({
          action: 'USER_STATUS_CHANGED',
          userId: actorUserId,
          targetUserId,
          outcome: 'SUCCESS',
          metadata: {
            ...auditMetadata,
            previousStatus: target.status,
            newStatus,
            changed: true,
          },
        });

        return updated;
      });
    } catch (err: any) {
      if (
        err instanceof UserNotFoundException ||
        err instanceof CannotLockLastAdminException
      ) {
        await this.auditPort.append({
          action: 'USER_STATUS_CHANGED',
          userId: actorUserId,
          targetUserId,
          outcome: 'FAILURE',
          errorCode: err.code,
          metadata: auditMetadata,
        });
      }
      throw err;
    }
  }

  async updateUserRole(
    actorUserId: string,
    targetUserId: string,
    newRole: UserRole,
    auditMetadata?: Record<string, unknown>,
  ): Promise<User> {
    // 1. Check self-demotion outside transaction (depends only on IDs)
    if (actorUserId === targetUserId && newRole !== 'ADMIN') {
      await this.auditPort.append({
        action: 'USER_ROLE_CHANGED',
        userId: actorUserId,
        targetUserId,
        outcome: 'FAILURE',
        errorCode: 'CANNOT_DEMOTE_SELF',
        metadata: auditMetadata,
      });
      throw new CannotDemoteSelfException();
    }

    // 2. Transactional execution with fresh snapshot
    try {
      return await this.transactionPort.run(async (ctx) => {
        const activeAdminCount = await ctx.lockActiveAdmins();
        const target = await ctx.findUserById(targetUserId);
        if (!target) {
          throw new UserNotFoundException();
        }

        // No-op check inside transaction
        if (target.role === newRole) {
          await ctx.appendAuditLog({
            action: 'USER_ROLE_CHANGED',
            userId: actorUserId,
            targetUserId,
            outcome: 'SUCCESS',
            metadata: {
              ...auditMetadata,
              previousRole: target.role,
              newRole,
              changed: false,
              noOp: true,
            },
          });
          return target;
        }

        // If demoting an active admin to non-admin, verify the invariant against
        // the active-admin set locked before reading the target snapshot.
        if (
          target.role === 'ADMIN' &&
          target.status === 'ACTIVE' &&
          newRole !== 'ADMIN'
        ) {
          if (activeAdminCount <= 1) {
            throw new CannotDemoteLastAdminException();
          }
        }

        const updated = await ctx.updateUserRole(targetUserId, newRole);
        await ctx.revokeUserSessions(targetUserId);

        await ctx.appendAuditLog({
          action: 'USER_ROLE_CHANGED',
          userId: actorUserId,
          targetUserId,
          outcome: 'SUCCESS',
          metadata: {
            ...auditMetadata,
            previousRole: target.role,
            newRole,
            changed: true,
          },
        });

        return updated;
      });
    } catch (err: any) {
      if (
        err instanceof UserNotFoundException ||
        err instanceof CannotDemoteLastAdminException
      ) {
        await this.auditPort.append({
          action: 'USER_ROLE_CHANGED',
          userId: actorUserId,
          targetUserId,
          outcome: 'FAILURE',
          errorCode: err.code,
          metadata: auditMetadata,
        });
      }
      throw err;
    }
  }
}
