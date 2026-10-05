import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaAudienceProfileSource } from '../src/modules/forms/infrastructure/prisma-audience-profile.source';
import { AudienceCandidate } from '../src/modules/forms/application/ports/audience-profile-source.port';

/**
 * Plan 5.5 read side on PostgreSQL: only ACTIVE, non-admin users other than
 * the caller, profiles mapped from the `specific_interests` JSON like the
 * participation gate, keyset paging by user id and the age pre-filter.
 *
 * Applies pending migrations (`prisma migrate deploy`) to a dedicated
 * database whose name ends in `_test`. Skipped when the database is
 * unreachable; fails instead when `AUDIENCE_TEST_DATABASE_URL` is set.
 * Other suites may share the database, so assertions only look at the rows
 * this suite created.
 */
const explicitUrl = process.env.AUDIENCE_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_audience_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'AUDIENCE_TEST_DATABASE_URL must target a dedicated database ending in _test',
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

describe('Audience estimate profile source on PostgreSQL', () => {
  let prisma: PrismaService;

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches AUDIENCE_TEST_DATABASE_URL', () => {
        throw new Error(
          `AUDIENCE_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live audience estimate tests.`,
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

  async function user(
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT',
    status: 'ACTIVE' | 'LOCKED',
    age: number | null,
    householdIncome: string | null = 'Dưới 5 triệu',
  ): Promise<string> {
    const id = randomUUID();
    await prisma.user.create({
      data: {
        id,
        email: `audience-${id}@example.com`,
        passwordHash: 'hash',
        role,
        status,
      },
    });
    await prisma.demographicProfile.create({
      data: {
        userId: id,
        age,
        location: 'Hà Nội',
        householdIncome,
        specificInterests: {
          gender: 'FEMALE',
          occupation: 'Sinh viên',
          fieldOfStudy: 'Kinh tế',
          customInterests: ['Công nghệ'],
        },
      },
    });
    return id;
  }

  async function everyCandidate(
    source: PrismaAudienceProfileSource,
    ageRange?: { min: number; max: number },
  ): Promise<{ pages: number; candidates: AudienceCandidate[] }> {
    const candidates: AudienceCandidate[] = [];
    let afterUserId: string | null = null;
    let pages = 0;
    for (;;) {
      const page = await source.listCandidates({
        afterUserId,
        limit: 2,
        ageRange,
      });
      pages += 1;
      candidates.push(...page);
      if (page.length < 2) break;
      afterUserId = page[page.length - 1].userId;
    }
    return { pages, candidates };
  }

  liveIt(
    'pages active non-admin profiles by user id, pushing NOT NULL and age into SQL',
    async () => {
      const respondent = await user('RESPONDENT', 'ACTIVE', 20);
      const publisher = await user('PUBLISHER', 'ACTIVE', 21);
      const admin = await user('ADMIN', 'ACTIVE', 20);
      const locked = await user('RESPONDENT', 'LOCKED', 20);
      const older = await user('RESPONDENT', 'ACTIVE', 40);
      const noAge = await user('RESPONDENT', 'ACTIVE', null);
      const noIncome = await user('RESPONDENT', 'ACTIVE', 20, null);
      const source = new PrismaAudienceProfileSource(prisma);

      const { candidates, pages } = await everyCandidate(source);
      expect(pages).toBeGreaterThan(1);
      const ids = candidates.map((candidate) => candidate.userId);
      expect(ids).toEqual([...ids].sort());
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(
        expect.arrayContaining([respondent, publisher, older]),
      );
      for (const excluded of [admin, locked, noAge, noIncome]) {
        expect(ids).not.toContain(excluded);
      }

      // Mapped like the participation gate: JSON fields lifted onto the DTO.
      expect(
        candidates.find((candidate) => candidate.userId === respondent)
          ?.profile,
      ).toMatchObject({
        userId: respondent,
        age: 20,
        gender: 'FEMALE',
        location: 'Hà Nội',
        occupation: 'Sinh viên',
        fieldOfStudy: 'Kinh tế',
        householdIncome: 'Dưới 5 triệu',
        specificInterests: ['Công nghệ'],
      });

      const young = await everyCandidate(source, { min: 18, max: 22 });
      const youngIds = young.candidates.map((candidate) => candidate.userId);
      expect(youngIds).toEqual(expect.arrayContaining([respondent, publisher]));
      expect(youngIds).not.toContain(older);

      // The caller's own row (subtracted from the counts), never an admin's.
      await expect(source.findCandidate(publisher)).resolves.toMatchObject({
        userId: publisher,
      });
      await expect(source.findCandidate(admin)).resolves.toBeNull();
    },
  );
});
