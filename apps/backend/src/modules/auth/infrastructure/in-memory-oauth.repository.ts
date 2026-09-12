import { randomUUID } from 'crypto';
import {
  OAuthPersistencePort,
  ResolveGoogleLoginParams,
  ResolveGoogleLoginResult,
  LinkGoogleIdentityParams,
  UnlinkGoogleIdentityParams,
} from '../application/ports/oauth-persistence.port';
import { InMemoryUserRepository } from '../../users/infrastructure/in-memory-user.repository';
import {
  GoogleLinkRequiredException,
  GoogleIdentityConflictException,
  FinalLoginMethodException,
  UserLockedException,
} from '../application/exceptions/auth.exceptions';
import { IdentityAuditPort } from '../application/ports/identity-audit.port';

export interface StoredAuthIdentity {
  id: string;
  userId: string;
  provider: 'LOCAL' | 'GOOGLE';
  providerSubjectId: string;
}

export class InMemoryOAuthRepository implements OAuthPersistencePort {
  private identities = new Map<string, StoredAuthIdentity>();

  constructor(
    private readonly userRepo: InMemoryUserRepository,
    private readonly auditPort?: IdentityAuditPort,
  ) {}

  async resolveGoogleUser(
    params: ResolveGoogleLoginParams,
  ): Promise<ResolveGoogleLoginResult> {
    const normalizedEmail = params.email.trim().toLowerCase();

    // 1. Resolve by provider subject (AC5)
    for (const identity of this.identities.values()) {
      if (
        identity.provider === 'GOOGLE' &&
        identity.providerSubjectId === params.sub
      ) {
        const user = await this.userRepo.findById(identity.userId);
        if (!user) {
          throw new Error('Identity points to non-existent user');
        }
        if (user.isLocked()) {
          throw new UserLockedException();
        }
        return { user, isNewUser: false };
      }
    }

    // 2. Not found by provider subject. Check if normalized email exists in User table (AC6)
    const existingUser = await this.userRepo.findByEmail(normalizedEmail);
    if (existingUser) {
      // Matching password email never auto-links!
      throw new GoogleLinkRequiredException();
    }

    // 3. New user creation (AC4)
    const newUserId = randomUUID();
    const newUser = await this.userRepo.create({
      id: newUserId,
      email: normalizedEmail,
      passwordHash: null,
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    const identityId = randomUUID();
    this.identities.set(identityId, {
      id: identityId,
      userId: newUserId,
      provider: 'GOOGLE',
      providerSubjectId: params.sub,
    });

    return { user: newUser, isNewUser: true };
  }

  async linkGoogleIdentity(params: LinkGoogleIdentityParams): Promise<void> {
    // Check if provider subject is already linked to ANY user
    for (const identity of this.identities.values()) {
      if (
        identity.provider === 'GOOGLE' &&
        identity.providerSubjectId === params.sub
      ) {
        throw new GoogleIdentityConflictException(
          'Google account is already linked to another user',
        );
      }
    }

    // Check if target user already has a Google identity
    for (const identity of this.identities.values()) {
      if (identity.userId === params.userId && identity.provider === 'GOOGLE') {
        throw new GoogleIdentityConflictException(
          'User already has a linked Google identity',
        );
      }
    }

    const id = randomUUID();
    this.identities.set(id, {
      id,
      userId: params.userId,
      provider: 'GOOGLE',
      providerSubjectId: params.sub,
    });

    if (params.auditRecord && this.auditPort) {
      await this.auditPort.append(params.auditRecord);
    }
  }

  async unlinkGoogleIdentity(
    params: UnlinkGoogleIdentityParams,
  ): Promise<void> {
    const user = await this.userRepo.findById(params.userId);
    if (!user) {
      throw new Error('User not found');
    }

    if (!user.hasPassword() || !user.passwordHash) {
      throw new FinalLoginMethodException();
    }

    let identityIdToDelete: string | null = null;
    for (const [id, identity] of this.identities.entries()) {
      if (identity.userId === params.userId && identity.provider === 'GOOGLE') {
        identityIdToDelete = id;
        break;
      }
    }

    if (!identityIdToDelete) {
      throw new GoogleIdentityConflictException(
        'No Google identity linked to this account',
      );
    }

    this.identities.delete(identityIdToDelete);

    if (params.auditRecord && this.auditPort) {
      await this.auditPort.append(params.auditRecord);
    }
  }

  async countUserLoginMethods(
    userId: string,
  ): Promise<{ hasPassword: boolean; identityCount: number }> {
    const user = await this.userRepo.findById(userId);
    const hasPassword = !!(user && user.hasPassword() && user.passwordHash);

    let count = 0;
    for (const identity of this.identities.values()) {
      if (identity.userId === userId) {
        count += 1;
      }
    }

    return { hasPassword, identityCount: count };
  }

  clear(): void {
    this.identities.clear();
  }
}
