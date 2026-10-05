import { randomUUID } from 'crypto';
import { User } from '../../users/domain/user.entity';
import { InMemoryUserRepository } from '../../users/infrastructure/in-memory-user.repository';
import { IdentityAuditPort } from '../application/ports/identity-audit.port';
import {
  IssuePasswordResetToken,
  PasswordResetRepositoryPort,
  RedeemPasswordResetToken,
  RedeemedPasswordReset,
} from '../application/ports/password-reset.repository.port';
import { InMemorySessionRepository } from './in-memory-session.repository';

interface StoredToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/** In-memory twin of `PrismaPasswordResetRepository` (unit and e2e tests). */
export class InMemoryPasswordResetRepository implements PasswordResetRepositoryPort {
  private readonly tokens: StoredToken[] = [];

  constructor(
    private readonly users: InMemoryUserRepository,
    private readonly sessions: InMemorySessionRepository,
    private readonly audit?: IdentityAuditPort,
  ) {}

  async issue(
    input: IssuePasswordResetToken,
  ): Promise<{ tokenId: string } | null> {
    const recent = this.tokens.filter(
      (token) =>
        token.userId === input.userId && token.createdAt >= input.windowStart,
    ).length;
    if (recent >= input.maxPerWindow) return null;
    const id = randomUUID();
    this.tokens.push({
      id,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt,
      usedAt: null,
      createdAt: input.now,
    });
    await this.audit?.append({
      action: 'PASSWORD_RESET_REQUESTED',
      userId: input.userId,
      outcome: 'SUCCESS',
      metadata: { tokenId: id },
    });
    return { tokenId: id };
  }

  async findValid(
    tokenHash: string,
    now: Date,
  ): Promise<{ tokenId: string; userId: string } | null> {
    const token = await this.usable(tokenHash, now);
    return token ? { tokenId: token.id, userId: token.userId } : null;
  }

  async redeem(
    input: RedeemPasswordResetToken,
  ): Promise<RedeemedPasswordReset | null> {
    const token = await this.usable(input.tokenHash, input.now);
    // Re-checked synchronously after the await: one of two concurrent calls wins.
    if (!token || token.usedAt) return null;
    token.usedAt = input.now;
    for (const other of this.tokens) {
      if (other.userId === token.userId && !other.usedAt) {
        other.usedAt = input.now;
      }
    }
    const user = (await this.users.findById(token.userId))!;
    this.users.save(
      new User({
        id: user.id,
        email: user.email,
        passwordHash: input.passwordHash,
        role: user.role,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: input.now,
      }),
    );
    const active = this.sessions
      .snapshot()
      .sessions.filter(
        (session) => session.userId === token.userId && !session.revoked,
      ).length;
    await this.sessions.revokeAllByUserId(token.userId, 'PASSWORD_RESET');
    await this.audit?.append({
      action: 'PASSWORD_RESET_COMPLETED',
      userId: token.userId,
      outcome: 'SUCCESS',
      metadata: { tokenId: token.id, revokedSessions: active },
    });
    return { userId: token.userId, tokenId: token.id, revokedSessions: active };
  }

  async purgeBefore(cutoff: Date, limit: number): Promise<number> {
    let deleted = 0;
    for (let i = this.tokens.length - 1; i >= 0 && deleted < limit; i--) {
      const token = this.tokens[i];
      if ((token.usedAt && token.usedAt < cutoff) || token.expiresAt < cutoff) {
        this.tokens.splice(i, 1);
        deleted++;
      }
    }
    return deleted;
  }

  /** Test helper: stored rows (hashes only). */
  all(): StoredToken[] {
    return this.tokens.map((token) => ({ ...token }));
  }

  private async usable(
    tokenHash: string,
    now: Date,
  ): Promise<StoredToken | null> {
    const token = this.tokens.find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        !candidate.usedAt &&
        candidate.expiresAt > now,
    );
    if (!token) return null;
    const user = await this.users.findById(token.userId);
    return user?.status === 'ACTIVE' ? token : null;
  }
}
