import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { PrismaService } from '../src/common/database/prisma.service';
import { UserProfileService } from '../src/modules/users/application/user-profile.service';
import { PrismaUserProfileRepository } from '../src/modules/users/infrastructure/prisma-user-profile.repository';

/**
 * Story IR.4b part A against PostgreSQL: the `user_profiles` upsert, partial
 * semantics, concurrent first writes, the cascade, and AC A5/A6 (a profile
 * write never touches the user's role, status, sessions or demographics).
 *
 * Applies pending migrations (`prisma migrate deploy`) to a dedicated
 * database whose name ends in `_test`, and removes only the users it created
 * (other suites' users may own append-only ledger rows). Skipped when the
 * database is unreachable; fails instead when
 * `USER_PROFILE_TEST_DATABASE_URL` is set explicitly.
 */
const explicitUrl = process.env.USER_PROFILE_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_user_profile_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'USER_PROFILE_TEST_DATABASE_URL must target a dedicated database ending in _test',
  );
}

/** Synchronous reachability probe, so `it.skip` can be chosen up front. */
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

describe('User profile PostgreSQL integration', () => {
  let prisma: PrismaService;
  let repository: PrismaUserProfileRepository;
  let service: UserProfileService;
  const createdUserIds: string[] = [];

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches USER_PROFILE_TEST_DATABASE_URL', () => {
        throw new Error(
          `USER_PROFILE_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live DB tests.`,
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
    repository = new PrismaUserProfileRepository(prisma);
    service = new UserProfileService(repository);
  }, 180_000);

  afterAll(async () => {
    if (!prisma) return;
    // Only this suite's users; cascades to their sessions and profiles.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.$disconnect();
  });

  async function createUser(role: 'PUBLISHER' | 'RESPONDENT' = 'RESPONDENT') {
    const user = await prisma.user.create({
      data: {
        email: `profile-${randomUUID()}@example.com`,
        passwordHash: 'hash',
        role,
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  liveIt(
    'reads a user without a row as all-null and creates the row on the first write',
    async () => {
      const user = await createUser();

      await expect(service.getOwnProfile(user.id)).resolves.toEqual({
        displayName: null,
        birthYear: null,
        school: null,
        schoolYear: null,
        goal: null,
      });
      await expect(repository.findByUserId(user.id)).resolves.toBeNull();

      await service.updateOwnProfile(user.id, {
        displayName: ' Linh Nguyễn ',
        birthYear: 2005,
        school: 'Trường Đại học FPT – Đà Nẵng',
        schoolYear: 'Năm 3',
        goal: 'BOTH',
      });

      await expect(
        prisma.userProfile.findUnique({ where: { userId: user.id } }),
      ).resolves.toMatchObject({
        displayName: 'Linh Nguyễn',
        birthYear: 2005,
        school: 'Trường Đại học FPT – Đà Nẵng',
        schoolYear: 'Năm 3',
        goal: 'BOTH',
      });
    },
  );

  liveIt(
    'updates only the keys present: absent keeps, null clears',
    async () => {
      const user = await createUser();
      await service.updateOwnProfile(user.id, {
        displayName: 'Linh',
        birthYear: 2005,
        school: 'ĐH FPT',
        schoolYear: 'Năm 3',
        goal: 'EARN',
      });

      const updated = await service.updateOwnProfile(user.id, {
        goal: 'COLLECT',
        school: null,
      });

      expect(updated).toEqual({
        displayName: 'Linh',
        birthYear: 2005,
        school: null,
        schoolYear: 'Năm 3',
        goal: 'COLLECT',
      });
      await expect(
        prisma.userProfile.count({ where: { userId: user.id } }),
      ).resolves.toBe(1);
    },
  );

  liveIt(
    'lets concurrent first writes of different fields both land',
    async () => {
      const user = await createUser();

      await Promise.all([
        repository.upsertPartial(user.id, { displayName: 'Linh' }),
        repository.upsertPartial(user.id, { goal: 'BOTH' }),
        repository.upsertPartial(user.id, { schoolYear: 'Năm 2' }),
      ]);

      await expect(repository.findByUserId(user.id)).resolves.toMatchObject({
        displayName: 'Linh',
        goal: 'BOTH',
        schoolYear: 'Năm 2',
      });
    },
  );

  liveIt(
    'never changes the role, status, sessions or demographic profile (AC A5/A6)',
    async () => {
      const respondent = await createUser('RESPONDENT');
      const publisher = await createUser('PUBLISHER');
      const session = await prisma.session.create({
        data: {
          userId: respondent.id,
          csrfDigest: 'digest',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });
      await prisma.demographicProfile.create({
        data: { userId: respondent.id, age: 21, location: 'Hà Nội' },
      });

      await service.updateOwnProfile(respondent.id, {
        goal: 'COLLECT',
        birthYear: 1990,
      });
      await service.updateOwnProfile(publisher.id, { goal: 'EARN' });

      await expect(
        prisma.user.findUnique({ where: { id: respondent.id } }),
      ).resolves.toMatchObject({ role: 'RESPONDENT', status: 'ACTIVE' });
      await expect(
        prisma.user.findUnique({ where: { id: publisher.id } }),
      ).resolves.toMatchObject({ role: 'PUBLISHER', status: 'ACTIVE' });
      await expect(
        prisma.session.findUnique({ where: { id: session.id } }),
      ).resolves.toMatchObject({ revoked: false, sessionVersion: 1 });
      await expect(
        prisma.demographicProfile.findUnique({
          where: { userId: respondent.id },
        }),
      ).resolves.toMatchObject({ age: 21, location: 'Hà Nội' });
    },
  );

  liveIt(
    'labels users by display name and removes the row with its user',
    async () => {
      const named = await createUser();
      const unnamed = await createUser();
      await service.updateOwnProfile(named.id, { displayName: 'Linh' });
      await service.updateOwnProfile(unnamed.id, { goal: 'EARN' });
      const noRow = await createUser();

      const labels = await repository.findDisplayLabels([
        named.id,
        unnamed.id,
        noRow.id,
      ]);
      expect(labels.get(named.id)).toBe('Linh');
      expect(labels.get(unnamed.id)).toBeNull();
      expect(labels.get(noRow.id)).toBeNull();

      await prisma.user.delete({ where: { id: named.id } });
      await expect(
        prisma.userProfile.findUnique({ where: { userId: named.id } }),
      ).resolves.toBeNull();
    },
  );
});
