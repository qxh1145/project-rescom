import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaPasswordResetRepository } from '../src/modules/auth/infrastructure/prisma-password-reset.repository';
import { PrismaSessionRepository } from '../src/modules/auth/infrastructure/prisma-session.repository';
import { ReplaceUserSessionInput } from '../src/modules/auth/application/ports/session-repository.port';

/**
 * Plan 5.4 / 5.6 on PostgreSQL: the hourly reset-link limit holds under
 * concurrent requests, one of two concurrent redemptions wins, and a reset
 * revokes every session with reason PASSWORD_RESET; a newer login marks the
 * replaced session REPLACED.
 *
 * Applies pending migrations to a dedicated database whose name ends in
 * `_test` (default `rescom_phase5_test`). Skipped when the database is
 * unreachable; fails instead when `AUTH_RESET_TEST_DATABASE_URL` is set.
 */
const explicitUrl = process.env.AUTH_RESET_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_phase5_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'AUTH_RESET_TEST_DATABASE_URL must target a dedicated database ending in _test',
  );
}

function probeDatabase(): boolean {
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        "const { PrismaClient } = require('@prisma/client');" +
          'const p = new PrismaClient({ datasources: { db: { url: process.env.PROBE_URL } } });' +
          "p.$queryRawUnsafe('SELECT 1').then(() => process.exit(0), () => process.exit(1));",
      ],
      {
        cwd: backendDir,
        env: { ...process.env, PROBE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 30_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;
jest.setTimeout(60_000);

describe('Password reset and revoke reasons on PostgreSQL (plan 5.4 / 5.6)', () => {
  let prisma: PrismaService;
  let resets: PrismaPasswordResetRepository;
  let sessions: PrismaSessionRepository;

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches AUTH_RESET_TEST_DATABASE_URL', () => {
        throw new Error(
          `AUTH_RESET_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live password reset tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    const prismaCli = require.resolve('prisma/build/index.js', {
      paths: [backendDir],
    });
    execFileSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: backendDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
    resets = new PrismaPasswordResetRepository(prisma);
    sessions = new PrismaSessionRepository(prisma);
  }, 180_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  async function createUser(): Promise<string> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `reset-${userId}@example.com`,
        passwordHash: 'old-hash',
        role: 'RESPONDENT',
      },
    });
    return userId;
  }

  function sessionInput(userId: string): ReplaceUserSessionInput {
    const now = new Date();
    const sessionId = randomUUID();
    const expiresAt = new Date(now.getTime() + 3_600_000);
    return {
      session: {
        id: sessionId,
        userId,
        csrfDigest: 'digest',
        revoked: false,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      },
      credential: {
        id: randomUUID(),
        sessionId,
        secretDigest: 'secret',
        isUsed: false,
        usedAt: null,
        expiresAt,
        createdAt: now,
      },
      audit: { action: 'SESSION_REPLACED', userId, outcome: 'SUCCESS' },
    };
  }

  function issue(userId: string, tokenHash: string, now = new Date()) {
    return resets.issue({
      userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
      now,
      windowStart: new Date(now.getTime() - 3_600_000),
      maxPerWindow: 3,
    });
  }

  liveIt('keeps the hourly limit under 6 concurrent requests', async () => {
    const userId = await createUser();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => issue(userId, `${userId}-hash-${i}`)),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    const rows = await prisma.passwordResetToken.findMany({
      where: { userId },
    });
    expect(rows).toHaveLength(3);
    // Older links stay valid (review M1): all three are usable.
    expect(rows.filter((row) => row.usedAt === null)).toHaveLength(3);
    await expect(
      prisma.identityAuditLog.count({
        where: { userId, action: 'PASSWORD_RESET_REQUESTED' },
      }),
    ).resolves.toBe(3);
  });

  liveIt(
    'one of two concurrent redemptions wins; the reset revokes every session as PASSWORD_RESET',
    async () => {
      const userId = await createUser();
      const first = await sessions.replaceUserSession(
        userId,
        sessionInput(userId),
      );
      const second = await sessions.replaceUserSession(
        userId,
        sessionInput(userId),
      );
      await expect(
        prisma.session.findUniqueOrThrow({ where: { id: first.id } }),
      ).resolves.toMatchObject({ revoked: true, revokedReason: 'REPLACED' });

      const tokenHash = `${userId}-redeem`;
      await issue(userId, tokenHash);
      const now = new Date();
      const results = await Promise.all([
        resets.redeem({ tokenHash, passwordHash: 'new-hash-a', now }),
        resets.redeem({ tokenHash, passwordHash: 'new-hash-b', now }),
      ]);
      const winners = results.filter(Boolean);
      expect(winners).toHaveLength(1);
      expect(winners[0]).toMatchObject({ userId, revokedSessions: 1 });

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(['new-hash-a', 'new-hash-b']).toContain(user.passwordHash);
      await expect(
        prisma.session.findUniqueOrThrow({ where: { id: second.id } }),
      ).resolves.toMatchObject({
        revoked: true,
        revokedReason: 'PASSWORD_RESET',
      });
      await expect(resets.findValid(tokenHash, new Date())).resolves.toBeNull();
      await expect(
        prisma.identityAuditLog.count({
          where: { userId, action: 'PASSWORD_RESET_COMPLETED' },
        }),
      ).resolves.toBe(1);
    },
  );

  liveIt(
    'purges tokens used or expired before the cutoff, in bounded batches (L9)',
    async () => {
      const userId = await createUser();
      const old = new Date(Date.now() - 8 * 24 * 3_600_000);
      await issue(userId, `${userId}-old-1`, old);
      await issue(userId, `${userId}-old-2`, old);
      await issue(userId, `${userId}-fresh`);
      const cutoff = new Date(Date.now() - 7 * 24 * 3_600_000);

      await expect(resets.purgeBefore(cutoff, 1)).resolves.toBe(1);
      await resets.purgeBefore(cutoff, 500);
      const left = await prisma.passwordResetToken.findMany({
        where: { userId },
      });
      expect(left.map((row) => row.tokenHash)).toEqual([`${userId}-fresh`]);
    },
  );

  liveIt('refuses an expired token and a locked account', async () => {
    const expiredUser = await createUser();
    const past = new Date(Date.now() - 31 * 60_000);
    await issue(expiredUser, `${expiredUser}-expired`, past);
    await expect(
      resets.redeem({
        tokenHash: `${expiredUser}-expired`,
        passwordHash: 'x',
        now: new Date(),
      }),
    ).resolves.toBeNull();

    const lockedUser = await createUser();
    await issue(lockedUser, `${lockedUser}-locked`);
    await prisma.user.update({
      where: { id: lockedUser },
      data: { status: 'LOCKED' },
    });
    await expect(
      resets.findValid(`${lockedUser}-locked`, new Date()),
    ).resolves.toBeNull();
    await expect(
      resets.redeem({
        tokenHash: `${lockedUser}-locked`,
        passwordHash: 'x',
        now: new Date(),
      }),
    ).resolves.toBeNull();
  });
});
