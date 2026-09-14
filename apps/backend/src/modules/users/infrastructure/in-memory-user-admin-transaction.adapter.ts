import {
  UserAdminTransactionPort,
  UserAdminTransactionContext,
} from '../application/ports/user-admin-transaction.port';
import { User, UserRole, UserStatus } from '../domain/user.entity';
import {
  CreateIdentityAuditRecord,
  IdentityAuditPort,
} from '../../auth/application/ports/identity-audit.port';
import { SessionRepositoryPort } from '../../auth/application/ports/session-repository.port';
import { InMemoryUserRepository } from './in-memory-user.repository';

export class InMemoryUserAdminTransactionAdapter implements UserAdminTransactionPort {
  private adminLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly userRepository: InMemoryUserRepository,
    private readonly sessionRepository?: SessionRepositoryPort,
    private readonly auditPort?: IdentityAuditPort,
  ) {}

  async run<T>(
    work: (ctx: UserAdminTransactionContext) => Promise<T>,
  ): Promise<T> {
    let releaseLock: (() => void) | null = null;

    const ctx: UserAdminTransactionContext = {
      findUserById: async (userId: string): Promise<User | null> => {
        return await this.userRepository.findById(userId);
      },

      lockActiveAdmins: async (): Promise<number> => {
        if (!releaseLock) {
          const prevLock = this.adminLock;
          let resolveLock!: () => void;
          const nextLock = new Promise<void>((r) => {
            resolveLock = r;
          });
          this.adminLock = prevLock.then(
            () => nextLock,
            () => nextLock,
          );
          await prevLock;
          releaseLock = resolveLock;
        }
        await new Promise((r) => setImmediate(r));
        return await this.userRepository.countByRoleAndStatus(
          'ADMIN',
          'ACTIVE',
        );
      },

      updateUserStatus: async (
        userId: string,
        status: UserStatus,
      ): Promise<User> => {
        const existing = await this.userRepository.findById(userId);
        if (!existing) {
          throw new Error('User not found in in-memory store');
        }
        const updated = new User({
          id: existing.id,
          email: existing.email,
          passwordHash: existing.passwordHash,
          role: existing.role,
          status,
          createdAt: existing.createdAt,
          updatedAt: new Date(),
        });
        this.userRepository.save(updated);
        return updated;
      },

      updateUserRole: async (userId: string, role: UserRole): Promise<User> => {
        const existing = await this.userRepository.findById(userId);
        if (!existing) {
          throw new Error('User not found in in-memory store');
        }
        const updated = new User({
          id: existing.id,
          email: existing.email,
          passwordHash: existing.passwordHash,
          role,
          status: existing.status,
          createdAt: existing.createdAt,
          updatedAt: new Date(),
        });
        this.userRepository.save(updated);
        return updated;
      },

      revokeUserSessions: async (userId: string): Promise<void> => {
        if (this.sessionRepository) {
          await this.sessionRepository.revokeAllByUserId(userId);
        }
      },

      appendAuditLog: async (
        record: CreateIdentityAuditRecord,
      ): Promise<void> => {
        if (this.auditPort) {
          await this.auditPort.append(record);
        }
      },
    };

    try {
      return await work(ctx);
    } finally {
      if (typeof releaseLock === 'function') {
        (releaseLock as () => void)();
      }
    }
  }
}
