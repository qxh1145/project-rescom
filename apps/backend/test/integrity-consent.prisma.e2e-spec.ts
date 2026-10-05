import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { INTEGRITY_CONSENT_PURPOSE } from '@rescom/schemas';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaIntegrityConsentRepository } from '../src/modules/participation/infrastructure/prisma-integrity-consent.repository';
import { IntegrityConsentService } from '../src/modules/participation/application/integrity-consent.service';

/**
 * Integrity consent on PostgreSQL: concurrent acceptances of the same notice
 * converge on one row (unique user + purpose + version, `INSERT … ON CONFLICT
 * DO NOTHING`) and keep the first acceptance time.
 *
 * Applies pending migrations (`prisma migrate deploy`) to a dedicated
 * database whose name ends in `_test`. Skipped when the database is
 * unreachable; fails instead when `PARTICIPATION_TEST_DATABASE_URL` is set.
 */
const explicitUrl = process.env.PARTICIPATION_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_participation_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'PARTICIPATION_TEST_DATABASE_URL must target a dedicated database ending in _test',
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

describe('Integrity consent on PostgreSQL', () => {
  let prisma: PrismaService;

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches PARTICIPATION_TEST_DATABASE_URL', () => {
        throw new Error(
          `PARTICIPATION_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live integrity consent tests.`,
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
  }, 180_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  liveIt(
    'concurrent acceptances of one notice keep one row and the first time',
    async () => {
      const userId = randomUUID();
      await prisma.user.create({
        data: {
          id: userId,
          email: `consent-${userId}@example.com`,
          passwordHash: 'hash',
          role: 'RESPONDENT',
        },
      });
      const repository = new PrismaIntegrityConsentRepository(prisma);
      let tick = Date.parse('2026-10-01T08:00:00.000Z');
      const service = new IntegrityConsentService({
        repository,
        now: () => new Date((tick += 1000)),
      });

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          service.acceptConsent(userId, { noticeVersion: 1 }),
        ),
      );

      const rows = await prisma.integrityConsent.findMany({
        where: { userId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        purpose: INTEGRITY_CONSENT_PURPOSE,
        noticeVersion: 1,
        revokedAt: null,
      });
      for (const result of results) {
        expect(result).toEqual({
          currentVersion: 1,
          acceptedVersion: 1,
          acceptedAt: rows[0].grantedAt.toISOString(),
        });
      }
      await expect(service.getConsent(userId)).resolves.toEqual(results[0]);
    },
  );
});
