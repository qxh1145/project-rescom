import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  SessionRepositoryPort,
  ReplaceUserSessionInput,
} from '../application/ports/session-repository.port';
import {
  Session,
  RefreshCredential,
  RefreshCredentialProps,
} from '../domain/session.entity';
import { CreateIdentityAuditRecord } from '../application/ports/identity-audit.port';
import { InvalidRefreshTokenException } from '../application/exceptions/auth.exceptions';

@Injectable()
export class PrismaSessionRepository implements SessionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async replaceUserSession(
    userId: string,
    input: ReplaceUserSessionInput,
  ): Promise<Session> {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Row-level lock on user record to serialize concurrent session replacements for this user
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;

      // 2. Query latest historical sessionVersion across ALL user's sessions
      const maxResult = await tx.session.aggregate({
        where: { userId },
        _max: { sessionVersion: true },
      });
      const nextVersion = (maxResult._max.sessionVersion ?? 0) + 1;

      // 3. Revoke existing active sessions
      await tx.session.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true },
      });

      // 4. Create new Session record with nextVersion
      const createdSession = await tx.session.create({
        data: {
          id: input.session.id,
          userId: input.session.userId,
          sessionVersion: nextVersion,
          csrfDigest: input.session.csrfDigest,
          revoked: input.session.revoked,
          expiresAt: input.session.expiresAt,
          createdAt: input.session.createdAt,
          updatedAt: input.session.updatedAt,
        },
      });

      // 5. Create RefreshCredential
      await tx.refreshCredential.create({
        data: {
          id: input.credential.id,
          sessionId: input.credential.sessionId,
          secretDigest: input.credential.secretDigest,
          isUsed: input.credential.isUsed,
          usedAt: input.credential.usedAt,
          expiresAt: input.credential.expiresAt,
          createdAt: input.credential.createdAt,
        },
      });

      // 6. Append mandatory SESSION_REPLACED audit record enriched with committed session info
      await tx.identityAuditLog.create({
        data: {
          action: input.audit.action,
          userId: input.audit.userId,
          targetUserId: input.audit.targetUserId,
          outcome: input.audit.outcome,
          errorCode: input.audit.errorCode,
          metadata: {
            ...(input.audit.metadata ?? {}),
            sessionId: createdSession.id,
            sessionVersion: nextVersion,
          },
        },
      });

      return new Session(createdSession);
    });
  }

  async findById(sessionId: string): Promise<Session | null> {
    const s = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    return s ? new Session(s) : null;
  }

  async findActiveByUserId(userId: string): Promise<Session | null> {
    const s = await this.prisma.session.findFirst({
      where: { userId, revoked: false, expiresAt: { gt: new Date() } },
    });
    return s ? new Session(s) : null;
  }

  async findCredentialWithSession(
    credentialId: string,
  ): Promise<{ credential: RefreshCredential; session: Session } | null> {
    const c = await this.prisma.refreshCredential.findUnique({
      where: { id: credentialId },
      include: { session: true },
    });
    if (!c || !c.session) return null;
    return {
      credential: new RefreshCredential(c),
      session: new Session(c.session),
    };
  }

  async rotateRefreshCredential(
    currentCredentialId: string,
    newCredential: RefreshCredentialProps,
    newCsrfDigest: string,
    auditRecord: CreateIdentityAuditRecord,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.refreshCredential.updateMany({
        where: { id: currentCredentialId, isUsed: false },
        data: { isUsed: true, usedAt: new Date() },
      });

      if (updated.count === 0) {
        throw new InvalidRefreshTokenException();
      }

      await tx.refreshCredential.create({
        data: {
          id: newCredential.id,
          sessionId: newCredential.sessionId,
          secretDigest: newCredential.secretDigest,
          isUsed: newCredential.isUsed,
          usedAt: newCredential.usedAt,
          expiresAt: newCredential.expiresAt,
          createdAt: newCredential.createdAt,
        },
      });

      await tx.session.update({
        where: { id: newCredential.sessionId },
        data: { csrfDigest: newCsrfDigest },
      });

      await tx.identityAuditLog.create({
        data: {
          action: auditRecord.action,
          userId: auditRecord.userId,
          targetUserId: auditRecord.targetUserId,
          outcome: auditRecord.outcome,
          errorCode: auditRecord.errorCode,
          metadata: auditRecord.metadata as any,
        },
      });
    });
  }

  async revokeSession(
    sessionId: string,
    auditRecord?: CreateIdentityAuditRecord,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.update({
        where: { id: sessionId },
        data: { revoked: true },
      });

      if (auditRecord) {
        await tx.identityAuditLog.create({
          data: {
            action: auditRecord.action,
            userId: auditRecord.userId,
            targetUserId: auditRecord.targetUserId,
            outcome: auditRecord.outcome,
            errorCode: auditRecord.errorCode,
            metadata: auditRecord.metadata as any,
          },
        });
      }
    });
  }

  async revokeAllByUserId(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  async updateCsrfDigest(
    sessionId: string,
    newCsrfDigest: string,
  ): Promise<void> {
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { csrfDigest: newCsrfDigest },
    });
  }
}
