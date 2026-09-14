import { User, UserRole, UserStatus } from '../domain/user.entity';
import {
  UserRepositoryPort,
  ListUsersParams,
  PaginatedUsersResult,
} from './ports/user.repository.port';
import {
  UserAdminTransactionPort,
} from './ports/user-admin-transaction.port';
import {
  IdentityAuditPort,
} from '../../auth/application/ports/identity-audit.port';
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
    private readonly auditPort?: IdentityAuditPort,
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
      if (this.auditPort) {
        await this.auditPort.append({
          action: 'USER_STATUS_CHANGED',
          userId: actorUserId,
          targetUserId,
          outcome: 'FAILURE',
          errorCode: 'CANNOT_LOCK_SELF',
          metadata: auditMetadata,
        });
      }
      throw new CannotLockSelfException();
    }

    // 2. Transactional execution with fresh snapshot
    try {
      return await this.transactionPort.run(async (ctx) => {
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

        // If locking an active admin, lock active admin rows and verify invariant
        if (
          target.role === 'ADMIN' &&
          target.status === 'ACTIVE' &&
          newStatus === 'LOCKED'
        ) {
          const activeAdminCount = await ctx.lockActiveAdmins();
          const freshTarget = await ctx.findUserById(targetUserId);
          if (!freshTarget) {
            throw new UserNotFoundException();
          }
          if (freshTarget.status === newStatus) {
            return freshTarget;
          }
          if (
            freshTarget.role === 'ADMIN' &&
            freshTarget.status === 'ACTIVE' &&
            activeAdminCount <= 1
          ) {
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
        if (this.auditPort) {
          await this.auditPort.append({
            action: 'USER_STATUS_CHANGED',
            userId: actorUserId,
            targetUserId,
            outcome: 'FAILURE',
            errorCode: err.code,
            metadata: auditMetadata,
          });
        }
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
      if (this.auditPort) {
        await this.auditPort.append({
          action: 'USER_ROLE_CHANGED',
          userId: actorUserId,
          targetUserId,
          outcome: 'FAILURE',
          errorCode: 'CANNOT_DEMOTE_SELF',
          metadata: auditMetadata,
        });
      }
      throw new CannotDemoteSelfException();
    }

    // 2. Transactional execution with fresh snapshot
    try {
      return await this.transactionPort.run(async (ctx) => {
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

        // If demoting an active admin to non-admin, lock active admin rows and verify invariant
        if (
          target.role === 'ADMIN' &&
          target.status === 'ACTIVE' &&
          newRole !== 'ADMIN'
        ) {
          const activeAdminCount = await ctx.lockActiveAdmins();
          const freshTarget = await ctx.findUserById(targetUserId);
          if (!freshTarget) {
            throw new UserNotFoundException();
          }
          if (freshTarget.role === newRole) {
            return freshTarget;
          }
          if (
            freshTarget.role === 'ADMIN' &&
            freshTarget.status === 'ACTIVE' &&
            activeAdminCount <= 1
          ) {
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
        if (this.auditPort) {
          await this.auditPort.append({
            action: 'USER_ROLE_CHANGED',
            userId: actorUserId,
            targetUserId,
            outcome: 'FAILURE',
            errorCode: err.code,
            metadata: auditMetadata,
          });
        }
      }
      throw err;
    }
  }
}
