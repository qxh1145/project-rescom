import { createHash, randomBytes } from 'crypto';
import {
  PASSWORD_RESET_MAX_TOKENS_PER_ACCOUNT_HOUR,
  PASSWORD_RESET_MAX_TOKENS_PER_HOUR,
  PASSWORD_RESET_PAGE_PATH,
  PASSWORD_RESET_TOKEN_TTL_MINUTES,
  ResetPasswordDto,
} from '@rescom/schemas';
import { UserRepositoryPort } from '../../users/application/ports/user.repository.port';
import { EmailSenderPort } from '../../notifications/application/ports/email-sender.port';
import { renderPasswordResetEmail } from '../../notifications/application/email-templates';
import { RateLimitCounterStorePort } from '../../../common/security/rate-limit-counter-store.port';
import { PasswordHasherPort } from './ports/password-hasher.port';
import { PasswordResetRepositoryPort } from './ports/password-reset.repository.port';
import { PasswordResetTokenInvalidException } from './exceptions/auth.exceptions';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export interface PasswordResetLogger {
  log(message: string): void;
  warn(message: string): void;
}

export interface PasswordResetConfig {
  /** Frontend base URL without a trailing slash (`EMAIL_APP_BASE_URL`). */
  appBaseUrl: string;
  /** Fixed forgot-password answer time (the work itself runs in the background). */
  minimumRequestMs: number;
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Plan 5.4: forgot / reset password.
 *
 * - `requestReset` never reveals whether the address has an account: it
 *   answers after the same fixed floor in every case and never throws; the
 *   lookup, the token write and the email all run in the background, so
 *   neither their time nor lock contention can leak existence. Only an
 *   ACTIVE account with a password credential gets a link; a Google-only or
 *   locked account gets nothing (the forgot screen already tells Google users
 *   to sign in with Google).
 * - Limits (review M1): 3 links per hour per (account, client IP), so a third
 *   party cannot use up the owner's links from another address, and at most
 *   10 per account per hour across all IPs (mail-bomb ceiling). Older unused
 *   links stay valid until they expire or one is redeemed (redeeming cancels
 *   the rest). A link whose email failed still counts toward both limits
 *   (accepted for the pilot: the user can ask again within the window).
 *   Limitation: the per-IP counter is per process (`RATE_LIMIT_COUNTER_STORE`,
 *   single replica), and behind a proxy without TRUST_PROXY_HOPS every client
 *   shares one IP; an attacker with 4+ IPs can still exhaust the account
 *   ceiling for an hour.
 * - The token is 32 random bytes (base64url); only its SHA-256 is stored. The
 *   raw token exists only in the email link: never persisted, never logged,
 *   never put in an Outbox payload. The email is sent directly through
 *   `EmailSenderPort` after the commit, best effort, and not awaited by the
 *   request (a slow SMTP server must not make existing accounts slower).
 * - `resetPassword` applies the registration policy (shared schema), consumes
 *   the token, sets the password and revokes every session
 *   (`PASSWORD_RESET`) in one transaction.
 */
export class PasswordResetService {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly users: Pick<UserRepositoryPort, 'findByEmail'>,
    private readonly resets: PasswordResetRepositoryPort,
    private readonly passwordHasher: Pick<PasswordHasherPort, 'hash'>,
    private readonly emailSender: EmailSenderPort | undefined,
    private readonly counters: RateLimitCounterStorePort,
    private readonly config: PasswordResetConfig,
    private readonly logger?: PasswordResetLogger,
    private readonly clock: () => Date = () => new Date(),
    private readonly generateToken: () => string = () =>
      randomBytes(32).toString('base64url'),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  async requestReset(
    email: string,
    clientIp: string | undefined,
  ): Promise<void> {
    this.track(
      this.issueIfEligible(
        email.trim().toLowerCase(),
        clientIp ?? 'unknown',
      ).catch((error: unknown) =>
        this.report('warn', 'PASSWORD_RESET_REQUEST_FAILED', {
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      ),
    );
    if (this.config.minimumRequestMs > 0) {
      await this.sleep(this.config.minimumRequestMs);
    }
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashResetToken(dto.token);
    // Check before the (slow) bcrypt hash; `redeem` re-checks atomically.
    if (!(await this.resets.findValid(tokenHash, this.clock()))) {
      throw new PasswordResetTokenInvalidException();
    }
    const passwordHash = await this.passwordHasher.hash(dto.newPassword);
    const redeemed = await this.resets.redeem({
      tokenHash,
      passwordHash,
      now: this.clock(),
    });
    if (!redeemed) {
      throw new PasswordResetTokenInvalidException();
    }
    this.report('log', 'PASSWORD_RESET_COMPLETED', {
      tokenId: redeemed.tokenId,
      revokedSessions: redeemed.revokedSessions,
    });
  }

  /** Test seam: waits for the background issue and email work. */
  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(Array.from(this.pending));
    }
  }

  private track(work: Promise<void>): void {
    const tracked = work.finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }

  private async issueIfEligible(
    email: string,
    clientIp: string,
  ): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user || user.isLocked() || !user.hasPassword()) return;

    const now = this.clock();
    const { hits } = await this.counters.increment(
      `password-reset:${user.id}:${clientIp}`,
      HOUR_MS,
      now,
    );
    if (hits > PASSWORD_RESET_MAX_TOKENS_PER_HOUR) {
      this.report('warn', 'PASSWORD_RESET_THROTTLED', { scope: 'account-ip' });
      return;
    }
    const token = this.generateToken();
    const issued = await this.resets.issue({
      userId: user.id,
      tokenHash: hashResetToken(token),
      expiresAt: new Date(
        now.getTime() + PASSWORD_RESET_TOKEN_TTL_MINUTES * MINUTE_MS,
      ),
      now,
      windowStart: new Date(now.getTime() - HOUR_MS),
      maxPerWindow: PASSWORD_RESET_MAX_TOKENS_PER_ACCOUNT_HOUR,
    });
    if (!issued) {
      this.report('warn', 'PASSWORD_RESET_THROTTLED', { scope: 'account' });
      return;
    }
    await this.sendEmail(user.email, token, issued.tokenId);
  }

  private async sendEmail(
    to: string,
    token: string,
    tokenId: string,
  ): Promise<void> {
    try {
      if (!this.emailSender) {
        this.report('warn', 'PASSWORD_RESET_EMAIL', {
          tokenId,
          outcome: 'NO_SENDER',
        });
        return;
      }
      const resetUrl = `${this.config.appBaseUrl}${PASSWORD_RESET_PAGE_PATH}?token=${encodeURIComponent(token)}`;
      const email = renderPasswordResetEmail({
        resetUrl,
        ttlMinutes: PASSWORD_RESET_TOKEN_TTL_MINUTES,
      });
      const result = await this.emailSender.send({
        to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        idempotencyKey: `password-reset:${tokenId}`,
      });
      this.report(
        result.outcome === 'ACCEPTED' ? 'log' : 'warn',
        'PASSWORD_RESET_EMAIL',
        {
          tokenId,
          outcome: result.outcome,
          ...('code' in result ? { code: result.code } : {}),
        },
      );
    } catch (error) {
      this.report('warn', 'PASSWORD_RESET_EMAIL', {
        tokenId,
        outcome: 'ERROR',
        error: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  /** Ids and codes only: never the address, the token or the link. */
  private report(
    level: 'log' | 'warn',
    event: string,
    fields: Record<string, unknown>,
  ): void {
    try {
      this.logger?.[level](`${event} ${JSON.stringify(fields)}`);
    } catch {
      // Logging never changes the outcome.
    }
  }
}
