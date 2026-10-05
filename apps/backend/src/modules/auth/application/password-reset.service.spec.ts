import { InMemoryUserRepository } from '../../users/infrastructure/in-memory-user.repository';
import { User } from '../../users/domain/user.entity';
import { CaptureEmailSender } from '../../notifications/infrastructure/capture-email-sender';
import { InMemoryRateLimitCounterStore } from '../../../common/security/in-memory-rate-limit-counter.store';
import { InMemorySessionRepository } from '../infrastructure/in-memory-session.repository';
import { InMemoryIdentityAuditRepository } from '../infrastructure/in-memory-identity-audit.repository';
import { InMemoryPasswordResetRepository } from '../infrastructure/in-memory-password-reset.repository';
import { PasswordResetTokenInvalidException } from './exceptions/auth.exceptions';
import { PasswordResetService, hashResetToken } from './password-reset.service';

describe('Plan 5.4: PasswordResetService', () => {
  const NEW_PASSWORD = 'mật khẩu mới đủ dài';
  let users: InMemoryUserRepository;
  let sessions: InMemorySessionRepository;
  let audit: InMemoryIdentityAuditRepository;
  let resets: InMemoryPasswordResetRepository;
  let sender: CaptureEmailSender;
  let lines: string[];
  let now: Date;
  let tokens: string[];
  let sleeps: number[];
  let service: PasswordResetService;
  let counters: InMemoryRateLimitCounterStore;
  const IP = '203.0.113.1';

  /** One forgot request, then its background work (lookup, token, email). */
  async function ask(email: string, ip = IP) {
    await service.requestReset(email, ip);
    await service.flush();
  }

  function addUser(
    id: string,
    email: string,
    options: {
      passwordHash?: string | null;
      status?: 'ACTIVE' | 'LOCKED';
    } = {},
  ) {
    users.save(
      new User({
        id,
        email,
        passwordHash:
          options.passwordHash === undefined
            ? 'old-hash'
            : options.passwordHash,
        role: 'RESPONDENT',
        status: options.status ?? 'ACTIVE',
      }),
    );
  }

  function createService(minimumRequestMs = 0) {
    let sequence = 0;
    return new PasswordResetService(
      users,
      resets,
      { hash: async (password) => `hashed:${password}` },
      sender,
      counters,
      { appBaseUrl: 'https://app.rescom.test', minimumRequestMs },
      { log: (line) => lines.push(line), warn: (line) => lines.push(line) },
      () => now,
      () => {
        const token = `token-${++sequence}-${'x'.repeat(30)}`;
        tokens.push(token);
        return token;
      },
      async (ms) => {
        sleeps.push(ms);
      },
    );
  }

  beforeEach(() => {
    users = new InMemoryUserRepository();
    audit = new InMemoryIdentityAuditRepository();
    sessions = new InMemorySessionRepository(audit);
    resets = new InMemoryPasswordResetRepository(users, sessions, audit);
    counters = new InMemoryRateLimitCounterStore();
    sender = new CaptureEmailSender();
    lines = [];
    tokens = [];
    sleeps = [];
    now = new Date('2026-10-01T09:00:00.000Z');
    addUser('u-1', 'user@example.com');
    service = createService();
  });

  it('emails a single-use link and stores only the SHA-256 of the token', async () => {
    await ask('  USER@example.com ');

    const [token] = tokens;
    const [stored] = resets.all();
    expect(stored.tokenHash).toBe(hashResetToken(token));
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(resets.all())).not.toContain(token);
    expect(stored.expiresAt.getTime() - now.getTime()).toBe(30 * 60_000);

    const [mail] = sender.sent();
    expect(mail.to).toBe('user@example.com');
    expect(mail.text).toContain(
      `https://app.rescom.test/reset-password?token=${encodeURIComponent(token)}`,
    );
    expect(audit.records).toContainEqual(
      expect.objectContaining({
        action: 'PASSWORD_RESET_REQUESTED',
        userId: 'u-1',
      }),
    );
  });

  it.each([
    ['an unknown address', 'nobody@example.com'],
    ['a Google-only account', 'google@example.com'],
    ['a locked account', 'locked@example.com'],
  ])(
    'sends nothing and stores nothing for %s, and answers the same way',
    async (_label, email) => {
      addUser('u-google', 'google@example.com', { passwordHash: null });
      addUser('u-locked', 'locked@example.com', { status: 'LOCKED' });
      await expect(service.requestReset(email, IP)).resolves.toBeUndefined();
      await service.flush();
      expect(resets.all()).toEqual([]);
      expect(sender.sent()).toEqual([]);
    },
  );

  it('pads every answer to the minimum time', async () => {
    const padded = createService(400);
    await padded.requestReset('nobody@example.com', IP);
    await padded.requestReset('user@example.com', IP);
    await padded.flush();
    expect(sleeps).toHaveLength(2);
    for (const ms of sleeps) expect(ms).toBeGreaterThan(300);
  });

  it('allows 3 links per hour per (account, IP); older links stay valid', async () => {
    for (let i = 0; i < 4; i++) await ask('user@example.com');
    expect(resets.all()).toHaveLength(3);
    expect(sender.sent()).toHaveLength(3);
    expect(resets.all().every((token) => token.usedAt === null)).toBe(true);
    expect(lines).toContainEqual(
      expect.stringContaining(
        'PASSWORD_RESET_THROTTLED {"scope":"account-ip"}',
      ),
    );

    // A third party on another IP cannot use up the owner's links (review M1).
    await ask('user@example.com', '198.51.100.7');
    expect(resets.all()).toHaveLength(4);

    // The oldest link still works; redeeming it cancels the others.
    await service.resetPassword({
      token: tokens[0],
      newPassword: NEW_PASSWORD,
    });
    expect(resets.all().every((token) => token.usedAt !== null)).toBe(true);

    now = new Date(now.getTime() + 61 * 60_000);
    await ask('user@example.com');
    expect(resets.all()).toHaveLength(5);
  });

  it('caps an account at 10 links per hour across all IPs', async () => {
    for (let i = 0; i < 12; i++) await ask('user@example.com', `10.0.0.${i}`);
    expect(resets.all()).toHaveLength(10);
    expect(lines).toContainEqual(
      expect.stringContaining('PASSWORD_RESET_THROTTLED {"scope":"account"}'),
    );
  });

  it('answers before the background work finishes (no timing or lock leak)', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    const slowUsers = {
      findByEmail: async (email: string) => {
        await blocked;
        return users.findByEmail(email);
      },
    };
    const slow = new PasswordResetService(
      slowUsers,
      resets,
      { hash: async (password) => `hashed:${password}` },
      sender,
      counters,
      { appBaseUrl: 'https://app.rescom.test', minimumRequestMs: 0 },
      undefined,
      () => now,
    );
    await expect(
      slow.requestReset('user@example.com', IP),
    ).resolves.toBeUndefined();
    expect(resets.all()).toHaveLength(0);
    release();
    await slow.flush();
    expect(resets.all()).toHaveLength(1);
  });

  it('resets the password, revokes every session and consumes the token', async () => {
    await sessions.replaceUserSession('u-1', {
      session: {
        id: 's-1',
        userId: 'u-1',
        csrfDigest: 'd',
        revoked: false,
        expiresAt: new Date(now.getTime() + 3_600_000),
        createdAt: now,
        updatedAt: now,
      },
      credential: {
        id: 'c-1',
        sessionId: 's-1',
        secretDigest: 'x',
        isUsed: false,
        usedAt: null,
        expiresAt: new Date(now.getTime() + 3_600_000),
        createdAt: now,
      },
      audit: { action: 'SESSION_REPLACED', userId: 'u-1', outcome: 'SUCCESS' },
    });
    await ask('user@example.com');

    await service.resetPassword({
      token: tokens[0],
      newPassword: NEW_PASSWORD,
    });

    expect((await users.findById('u-1'))?.passwordHash).toBe(
      `hashed:${NEW_PASSWORD}`,
    );
    expect((await sessions.findById('s-1'))?.revokedReason).toBe(
      'PASSWORD_RESET',
    );
    expect(audit.records).toContainEqual(
      expect.objectContaining({
        action: 'PASSWORD_RESET_COMPLETED',
        userId: 'u-1',
        metadata: expect.objectContaining({ revokedSessions: 1 }),
      }),
    );
    await expect(
      service.resetPassword({ token: tokens[0], newPassword: NEW_PASSWORD }),
    ).rejects.toThrow(PasswordResetTokenInvalidException);
  });

  it('rejects unknown, expired and locked-account tokens with the same error', async () => {
    await expect(
      service.resetPassword({
        token: 'never-issued',
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toThrow(PasswordResetTokenInvalidException);

    await ask('user@example.com');
    now = new Date(now.getTime() + 31 * 60_000);
    await expect(
      service.resetPassword({ token: tokens[0], newPassword: NEW_PASSWORD }),
    ).rejects.toThrow(PasswordResetTokenInvalidException);

    now = new Date(now.getTime() + 61 * 60_000);
    await ask('user@example.com');
    addUser('u-1', 'user@example.com', { status: 'LOCKED' });
    await expect(
      service.resetPassword({ token: tokens[1], newPassword: NEW_PASSWORD }),
    ).rejects.toThrow(PasswordResetTokenInvalidException);
  });

  it('lets exactly one of two concurrent redemptions win', async () => {
    await ask('user@example.com');
    const results = await Promise.allSettled([
      service.resetPassword({ token: tokens[0], newPassword: NEW_PASSWORD }),
      service.resetPassword({
        token: tokens[0],
        newPassword: 'another long password',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('never logs the token, the link or the address, and survives a failed send', async () => {
    sender.failNext({ outcome: 'RETRYABLE', code: 'CONNECTION_FAILED' });
    await ask('user@example.com');
    await ask('user@example.com');
    await service.resetPassword({
      token: tokens[1],
      newPassword: NEW_PASSWORD,
    });

    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines) {
      for (const token of tokens) expect(line).not.toContain(token);
      expect(line).not.toContain('user@example.com');
      expect(line).not.toContain('reset-password');
    }
    expect(lines).toContainEqual(
      expect.stringContaining('"outcome":"RETRYABLE"'),
    );
  });
});
