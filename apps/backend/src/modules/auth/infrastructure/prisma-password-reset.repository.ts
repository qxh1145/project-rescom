import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  IssuePasswordResetToken,
  PasswordResetRepositoryPort,
  RedeemPasswordResetToken,
  RedeemedPasswordReset,
} from '../application/ports/password-reset.repository.port';

/**
 * Plan 5.4: `password_reset_tokens` plus the reset itself (password hash,
 * session revocation, identity audit) in one transaction.
 */
@Injectable()
export class PrismaPasswordResetRepository implements PasswordResetRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async issue(
    input: IssuePasswordResetToken,
  ): Promise<{ tokenId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      // Serializes concurrent requests for one account, so the hourly limit holds.
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${input.userId}::uuid FOR UPDATE`;
      const recent = await tx.passwordResetToken.count({
        where: { userId: input.userId, createdAt: { gte: input.windowStart } },
      });
      if (recent >= input.maxPerWindow) return null;
      // Older unused links stay valid (review M1): redeeming one cancels the rest.
      const token = await tx.passwordResetToken.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          createdAt: input.now,
        },
        select: { id: true },
      });
      await tx.identityAuditLog.create({
        data: {
          action: 'PASSWORD_RESET_REQUESTED',
          userId: input.userId,
          outcome: 'SUCCESS',
          metadata: { tokenId: token.id },
        },
      });
      return { tokenId: token.id };
    });
  }

  async findValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ tokenId: string; userId: string } | null> {
    const token = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
      select: { id: true, userId: true },
    });
    return token ? { tokenId: token.id, userId: token.userId } : null;
  }

  async purgeBefore(cutoff: Date, limit: number): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM "password_reset_tokens"
       WHERE "id" IN (
         SELECT "id" FROM "password_reset_tokens"
          WHERE "used_at" < ${cutoff} OR "expires_at" < ${cutoff}
          LIMIT ${limit}
       )`;
  }

  async redeem(
    input: RedeemPasswordResetToken,
  ): Promise<RedeemedPasswordReset | null> {
    return this.prisma.$transaction(async (tx) => {
      // Compare-and-set: of two concurrent redemptions only one sees the row.
      const [consumed] = await tx.$queryRaw<
        Array<{ id: string; user_id: string }>
      >`
        UPDATE "password_reset_tokens" AS t
           SET "used_at" = ${input.now}
          FROM "users" AS u
         WHERE t."user_id" = u."id"
           AND t."token_hash" = ${input.tokenHash}
           AND t."used_at" IS NULL
           AND t."expires_at" > ${input.now}
           AND u."status" = 'ACTIVE'::"UserStatus"
        RETURNING t."id", t."user_id"`;
      if (!consumed) return null;
      const userId = consumed.user_id;

      await tx.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: input.now },
      });
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: input.passwordHash },
      });
      const revoked = await tx.session.updateMany({
        where: { userId, revoked: false },
        data: {
          revoked: true,
          revokedAt: input.now,
          revokedReason: 'PASSWORD_RESET',
        },
      });
      await tx.identityAuditLog.create({
        data: {
          action: 'PASSWORD_RESET_COMPLETED',
          userId,
          outcome: 'SUCCESS',
          metadata: { tokenId: consumed.id, revokedSessions: revoked.count },
        },
      });
      return {
        userId,
        tokenId: consumed.id,
        revokedSessions: revoked.count,
      };
    });
  }
}
