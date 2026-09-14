import { randomUUID } from 'crypto';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaIdentityAuditRepository } from '../src/modules/auth/infrastructure/prisma-identity-audit.repository';
import { UserAdminService } from '../src/modules/users/application/user-admin.service';
import { PrismaUserAdminTransactionAdapter } from '../src/modules/users/infrastructure/prisma-user-admin-transaction.adapter';
import { PrismaUserRepository } from '../src/modules/users/infrastructure/prisma-user.repository';

describe('Admin user PostgreSQL concurrency integration', () => {
  const databaseUrl =
    process.env.RBAC_TEST_DATABASE_URL ??
    'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_rbac_test?schema=public';
  let prisma: PrismaService;
  let service: UserAdminService;
  let repository: PrismaUserRepository;

  beforeAll(async () => {
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!databaseName.endsWith('_test')) {
      throw new Error(
        'RBAC_TEST_DATABASE_URL must target a dedicated database ending in _test',
      );
    }

    prisma = new PrismaService({
      datasources: { db: { url: databaseUrl } },
    });
    await prisma.$connect();
    repository = new PrismaUserRepository(prisma);
    service = new UserAdminService(
      repository,
      new PrismaUserAdminTransactionAdapter(prisma),
      new PrismaIdentityAuditRepository(prisma),
    );
  });

  afterAll(async () => {
    if (prisma) {
      await clearDatabase();
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    await clearDatabase();
  });

  async function clearDatabase(): Promise<void> {
    await prisma.user.deleteMany();
  }

  async function seedTwoAdmins() {
    const [adminA, adminB] = await Promise.all([
      prisma.user.create({
        data: {
          email: `admin-a-${randomUUID()}@example.com`,
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      }),
      prisma.user.create({
        data: {
          email: `admin-b-${randomUUID()}@example.com`,
          passwordHash: 'hash',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
      }),
    ]);
    return { adminA, adminB };
  }

  async function expectSerializedInvariant(
    operations: () => Promise<unknown>[],
    expectedCodes: readonly string[],
  ): Promise<void> {
    const initialAuditCount = await prisma.identityAuditLog.count();
    const initialFailureCount = await prisma.identityAuditLog.count({
      where: { outcome: 'FAILURE' },
    });

    const results = await Promise.allSettled(operations());
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === 'rejected') {
      expect(expectedCodes).toContain(rejected[0].reason.code);
    }
    await expect(
      repository.countByRoleAndStatus('ADMIN', 'ACTIVE'),
    ).resolves.toBe(1);
    await expect(prisma.identityAuditLog.count()).resolves.toBe(
      initialAuditCount + 2,
    );
    await expect(
      prisma.identityAuditLog.count({ where: { outcome: 'FAILURE' } }),
    ).resolves.toBe(initialFailureCount + 1);
  }

  it('serializes concurrent lock-versus-lock mutations', async () => {
    const { adminA, adminB } = await seedTwoAdmins();

    await expectSerializedInvariant(
      () => [
        service.updateUserStatus(adminA.id, adminB.id, 'LOCKED'),
        service.updateUserStatus(adminB.id, adminA.id, 'LOCKED'),
      ],
      ['CANNOT_LOCK_LAST_ADMIN'],
    );
  });

  it('serializes concurrent demote-versus-demote mutations', async () => {
    const { adminA, adminB } = await seedTwoAdmins();

    await expectSerializedInvariant(
      () => [
        service.updateUserRole(adminA.id, adminB.id, 'RESPONDENT'),
        service.updateUserRole(adminB.id, adminA.id, 'RESPONDENT'),
      ],
      ['CANNOT_DEMOTE_LAST_ADMIN'],
    );
  });

  it('serializes overlapping status and role mutations', async () => {
    const { adminA, adminB } = await seedTwoAdmins();

    await expectSerializedInvariant(
      () => [
        service.updateUserStatus(adminA.id, adminB.id, 'LOCKED'),
        service.updateUserRole(adminB.id, adminA.id, 'RESPONDENT'),
      ],
      ['CANNOT_LOCK_LAST_ADMIN', 'CANNOT_DEMOTE_LAST_ADMIN'],
    );
  });
});
