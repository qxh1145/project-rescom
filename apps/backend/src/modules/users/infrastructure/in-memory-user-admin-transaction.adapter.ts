import {
  UserAdminTransactionPort,
  UserAdminTransactionContext,
} from '../application/ports/user-admin-transaction.port';
import { User, UserRole, UserStatus } from '../domain/user.entity';
import { CreateIdentityAuditRecord } from '../../auth/application/ports/identity-audit.port';
import { InMemoryUserRepository } from './in-memory-user.repository';
import { InMemorySessionRepository } from '../../auth/infrastructure/in-memory-session.repository';
import { InMemoryIdentityAuditRepository } from '../../auth/infrastructure/in-memory-identity-audit.repository';

export class InMemoryUserAdminTransactionAdapter implements UserAdminTransactionPort {
  private transactionLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly userRepository: InMemoryUserRepository,
    private readonly sessionRepository: InMemorySessionRepository,
    private readonly auditPort: InMemoryIdentityAuditRepository,
  ) {}

  async run<T>(
    work: (ctx: UserAdminTransactionContext) => Promise<T>,
  ): Promise<T> {
    const previousLock = this.transactionLock;
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.transactionLock = previousLock.then(
      () => currentLock,
      () => currentLock,
    );
    await previousLock;

    const userSnapshot = this.userRepository.snapshot();
    const sessionSnapshot = this.sessionRepository.snapshot();
    const auditSnapshot = this.auditPort.snapshot();

    const ctx: UserAdminTransactionContext = {
      findUserById: async (userId: string): Promise<User | null> => {
        return await this.userRepository.findById(userId);
      },

      lockActiveAdmins: async (): Promise<number> => {
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
        await this.sessionRepository.revokeAllByUserId(userId);
      },

      appendAuditLog: async (
        record: CreateIdentityAuditRecord,
      ): Promise<void> => {
        await this.auditPort.append(record);
      },
    };

    try {
      return await work(ctx);
    } catch (error) {
      this.userRepository.restore(userSnapshot);
      this.sessionRepository.restore(sessionSnapshot);
      this.auditPort.restore(auditSnapshot);
      throw error;
    } finally {
      releaseLock();
    }
  }
}
