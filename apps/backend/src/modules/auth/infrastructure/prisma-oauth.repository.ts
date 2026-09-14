import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  OAuthPersistencePort,
  ResolveGoogleLoginParams,
  ResolveGoogleLoginResult,
  LinkGoogleIdentityParams,
  UnlinkGoogleIdentityParams,
} from '../application/ports/oauth-persistence.port';
import { User } from '../../users/domain/user.entity';
import {
  GoogleLinkRequiredException,
  GoogleIdentityConflictException,
  FinalLoginMethodException,
  UserLockedException,
} from '../application/exceptions/auth.exceptions';

@Injectable()
export class PrismaOAuthRepository implements OAuthPersistencePort {
  constructor(private readonly prisma: PrismaService) {}

  async resolveGoogleUser(
    params: ResolveGoogleLoginParams,
  ): Promise<ResolveGoogleLoginResult> {
    const normalizedEmail = params.email.trim().toLowerCase();

    // 1. Resolve by provider subject (AC5)
    const existingIdentity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerSubjectId: {
          provider: 'GOOGLE',
          providerSubjectId: params.sub,
        },
      },
      include: {
        user: true,
      },
    });

    if (existingIdentity) {
      if (existingIdentity.user.status === 'LOCKED') {
        throw new UserLockedException();
      }
      return {
        user: new User(existingIdentity.user as any),
        isNewUser: false,
      };
    }

    // 2. Not found by provider subject. Check if email matches existing User (AC6)
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingUser) {
      throw new GoogleLinkRequiredException();
    }

    // 3. Atomically create User and AuthIdentity (AC4)
    try {
      const createdUser = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: normalizedEmail,
            passwordHash: null,
            role: 'RESPONDENT',
            status: 'ACTIVE',
          },
        });

        await tx.authIdentity.create({
          data: {
            userId: user.id,
            provider: 'GOOGLE',
            providerSubjectId: params.sub,
          },
        });

        return user;
      });

      return {
        user: new User(createdUser as any),
        isNewUser: true,
      };
    } catch (err: any) {
      if (err.code === 'P2002') {
        const winner = await this.prisma.authIdentity.findUnique({
          where: {
            provider_providerSubjectId: {
              provider: 'GOOGLE',
              providerSubjectId: params.sub,
            },
          },
          include: { user: true },
        });
        if (winner) {
          if (winner.user.status === 'LOCKED') {
            throw new UserLockedException();
          }
          return {
            user: new User(winner.user as any),
            isNewUser: false,
          };
        }
        throw new GoogleLinkRequiredException();
      }
      throw err;
    }
  }

  async linkGoogleIdentity(params: LinkGoogleIdentityParams): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.authIdentity.create({
          data: {
            userId: params.userId,
            provider: 'GOOGLE',
            providerSubjectId: params.sub,
          },
        });

        if (params.auditRecord) {
          await tx.identityAuditLog.create({
            data: {
              action: params.auditRecord.action,
              userId: params.auditRecord.userId,
              targetUserId: params.auditRecord.targetUserId,
              outcome: params.auditRecord.outcome,
              errorCode: params.auditRecord.errorCode,
              metadata: params.auditRecord.metadata as any,
            },
          });
        }
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new GoogleIdentityConflictException(
          'Google identity is already linked to an account',
        );
      }
      throw err;
    }
  }

  async unlinkGoogleIdentity(
    params: UnlinkGoogleIdentityParams,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: params.userId },
      });
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.passwordHash) {
        throw new FinalLoginMethodException();
      }

      const deleted = await tx.authIdentity.deleteMany({
        where: {
          userId: params.userId,
          provider: 'GOOGLE',
        },
      });

      if (deleted.count === 0) {
        throw new GoogleIdentityConflictException(
          'No Google identity linked to this account',
        );
      }

      if (params.auditRecord) {
        await tx.identityAuditLog.create({
          data: {
            action: params.auditRecord.action,
            userId: params.auditRecord.userId,
            targetUserId: params.auditRecord.targetUserId,
            outcome: params.auditRecord.outcome,
            errorCode: params.auditRecord.errorCode,
            metadata: params.auditRecord.metadata as any,
          },
        });
      }
    });
  }

  async countUserLoginMethods(
    userId: string,
  ): Promise<{ hasPassword: boolean; identityCount: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    const count = await this.prisma.authIdentity.count({
      where: { userId },
    });
    return {
      hasPassword: !!user?.passwordHash,
      identityCount: count,
    };
  }
}
