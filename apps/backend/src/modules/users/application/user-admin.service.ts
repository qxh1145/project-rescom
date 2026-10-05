import { randomUUID } from 'crypto';
import { User, UserRole, UserStatus } from '../domain/user.entity';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import {
  UserRepositoryPort,
  ListUsersParams,
  PaginatedUsersResult,
} from './ports/user.repository.port';
import { UserAdminTransactionPort } from './ports/user-admin-transaction.port';
import { IdentityAuditPort } from '../../auth/application/ports/identity-audit.port';
import { IdentityLockReasonReader } from '../../auth/application/ports/identity-lock-reason-reader.port';
import {
  UserNotFoundException,
  CannotLockSelfException,
  CannotLockLastAdminException,
  CannotDemoteSelfException,
  CannotDemoteLastAdminException,
  UserAdminActorNotActiveAdminException,
} from './exceptions/user-admin.exceptions';

export class UserAdminService {
  constructor(
    private readonly userRepository: UserRepositoryPort,
    private readonly transactionPort: UserAdminTransactionPort,
    private readonly auditPort: IdentityAuditPort,
    /** Mock-off plan 4.6: `lockReason` of the admin user DTO; none when absent. */
    private readonly lockReasons?: IdentityLockReasonReader,
    /** Story IR.4b B3: ACCOUNT_LOCKED / ACCOUNT_UNLOCKED (in-app + email). */
    private readonly notificationPublisher?: NotificationPublisherPort,
    private readonly generateId: () => string = randomUUID,
  ) {}

  /** Lock reason per LOCKED user among `users` (one bounded audit read). */
  async findLockReasons(users: readonly User[]): Promise<Map<string, string>> {
    const locked = users
      .filter((user) => user.status === 'LOCKED')
      .map((user) => user.id);
    if (locked.length === 0 || !this.lockReasons) return new Map();
    return this.lockReasons.findLatestLockReasons(locked);
  }

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

    // Story IR.4b B3: one id per effective change, shared by the audit row
    // and the notification dedupe key.
    const changeId = this.generateId();
    let changed = false;

    // 2. Transactional execution with fresh snapshot
    try {
      const result = await this.transactionPort.run(async (ctx) => {
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

        // BE-8: the acting admin may have been locked/demoted concurrently
        // between the controller's auth check and this transaction acquiring
        // the lock. Re-verify their privilege against the locked snapshot
        // right before applying the mutation (the last-admin invariant above
        // still takes precedence over actor liveness).
        const actor = await ctx.findUserById(actorUserId);
        if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
          throw new UserAdminActorNotActiveAdminException();
        }

        const updated = await ctx.updateUserStatus(targetUserId, newStatus);
        if (newStatus === 'LOCKED') {
          await ctx.revokeUserSessions(targetUserId, 'ADMIN_LOCK');
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
            changeId,
          },
        });

        changed = true;
        return updated;
      });
      if (changed) {
        await this.notifyStatusChanged(targetUserId, newStatus, changeId);
      }
      return result;
    } catch (err: any) {
      if (
        err instanceof UserNotFoundException ||
        err instanceof CannotLockLastAdminException ||
        err instanceof UserAdminActorNotActiveAdminException
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

        // BE-8: the acting admin may have been locked/demoted concurrently
        // between the controller's auth check and this transaction acquiring
        // the lock. Re-verify their privilege against the locked snapshot
        // right before applying the mutation (the last-admin invariant above
        // still takes precedence over actor liveness).
        const actor = await ctx.findUserById(actorUserId);
        if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
          throw new UserAdminActorNotActiveAdminException();
        }

        const updated = await ctx.updateUserRole(targetUserId, newRole);
        await ctx.revokeUserSessions(targetUserId, 'ROLE_CHANGED');

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
        err instanceof CannotDemoteLastAdminException ||
        err instanceof UserAdminActorNotActiveAdminException
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

  /**
   * Story IR.4b B3: after the commit, only for an effective change. Never
   * changes the HTTP result: the port never throws, and anything unexpected
   * is swallowed here too. The locked user cannot sign in to read the notice,
   * so the email (queued by Notifications) is the channel that reaches them.
   */
  private async notifyStatusChanged(
    userId: string,
    status: UserStatus,
    changeId: string,
  ): Promise<void> {
    try {
      await this.notificationPublisher?.publish({
        userId,
        type: status === 'LOCKED' ? 'ACCOUNT_LOCKED' : 'ACCOUNT_UNLOCKED',
        message:
          status === 'LOCKED'
            ? 'Your account was locked by an administrator.'
            : 'Your account was unlocked by an administrator.',
        dedupeKey: `account-status:${userId}:${changeId}`,
      });
    } catch {
      // Best effort (decision E9-D3).
    }
  }
}
