import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  UserAdminTransactionPort,
  UserAdminTransactionContext,
} from '../application/ports/user-admin-transaction.port';
import { User, UserRole, UserStatus } from '../domain/user.entity';
import { CreateIdentityAuditRecord } from '../../auth/application/ports/identity-audit.port';

@Injectable()
export class PrismaUserAdminTransactionAdapter
  implements UserAdminTransactionPort
{
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(
    work: (ctx: UserAdminTransactionContext) => Promise<T>,
  ): Promise<T> {
    return await this.prisma.$transaction(async (tx) => {
      const ctx: UserAdminTransactionContext = {
        findUserById: async (userId: string): Promise<User | null> => {
          const raw = await tx.user.findUnique({
            where: { id: userId },
          });
          if (!raw) return null;
          return new User({
            id: raw.id,
            email: raw.email,
            passwordHash: raw.passwordHash,
            role: raw.role as UserRole,
            status: raw.status as UserStatus,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
          });
        },

        lockActiveAdmins: async (): Promise<number> => {
          const lockedRows = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id" FROM "users" WHERE "role" = 'ADMIN'::"Role" AND "status" = 'ACTIVE'::"UserStatus" FOR UPDATE
          `;
          return lockedRows.length;
        },

        updateUserStatus: async (
          userId: string,
          status: UserStatus,
        ): Promise<User> => {
          const raw = await tx.user.update({
            where: { id: userId },
            data: { status },
          });
          return new User({
            id: raw.id,
            email: raw.email,
            passwordHash: raw.passwordHash,
            role: raw.role as UserRole,
            status: raw.status as UserStatus,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
          });
        },

        updateUserRole: async (
          userId: string,
          role: UserRole,
        ): Promise<User> => {
          const raw = await tx.user.update({
            where: { id: userId },
            data: { role },
          });
          return new User({
            id: raw.id,
            email: raw.email,
            passwordHash: raw.passwordHash,
            role: raw.role as UserRole,
            status: raw.status as UserStatus,
            createdAt: raw.createdAt,
            updatedAt: raw.updatedAt,
          });
        },

        revokeUserSessions: async (userId: string): Promise<void> => {
          await tx.session.updateMany({
            where: { userId, revoked: false },
            data: { revoked: true },
          });
        },

        appendAuditLog: async (
          record: CreateIdentityAuditRecord,
        ): Promise<void> => {
          await tx.identityAuditLog.create({
            data: {
              action: record.action,
              userId: record.userId,
              targetUserId: record.targetUserId,
              outcome: record.outcome,
              errorCode: record.errorCode,
              metadata: record.metadata as any,
            },
          });
        },
      };

      return await work(ctx);
    });
  }
}
