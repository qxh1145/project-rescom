import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaUnitOfWork } from '../src/common/database/prisma-unit-of-work';
import { PrismaVoucherRepository } from '../src/modules/rewards/infrastructure/prisma-voucher.repository';
import { PrismaVoucherCodeRepository } from '../src/modules/rewards/infrastructure/prisma-voucher-code.repository';
import { PrismaRedemptionRepository } from '../src/modules/rewards/infrastructure/prisma-redemption.repository';
import { PrismaFlashSaleReadRepository } from '../src/modules/rewards/infrastructure/prisma-flash-sale-read.repository';
import { RewardsAdminCatalogService } from '../src/modules/rewards/application/rewards-admin-catalog.service';
import {
  backendDir,
  databaseUrl,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';

const available = probeDatabase();
const liveIt = available ? it : it.skip;

describe('Rewards catalog on PostgreSQL', () => {
  let db: PrismaClient;
  const admin = randomUUID();
  const user = randomUUID();

  if (!available && requireDb) {
    it('reaches FINANCIAL_TEST_DATABASE_URL', () => {
      throw new Error(`Postgres DB at ${databaseUrl} is unreachable`);
    });
  }

  beforeAll(async () => {
    if (!available) return;
    const cli = require.resolve('prisma/build/index.js', {
      paths: [backendDir],
    });
    execFileSync(
      process.execPath,
      [cli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: backendDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await db.$connect();
  }, 180_000);

  afterAll(async () => {
    if (db) await db.$disconnect();
  });

  async function voucher(stockRemaining = 2) {
    return db.voucher.create({
      data: {
        title: `PG reward ${randomUUID()}`,
        brandId: 'highlands',
        category: 'COFFEE',
        valueVnd: 100_000,
        basePoints: 100,
        stockTotal: 2,
        stockRemaining,
        redeemStartsAt: new Date('2025-01-01T00:00:00Z'),
        redeemEndsAt: new Date('2030-01-01T00:00:00Z'),
        codeExpiresAt: new Date('2030-01-09T00:00:00Z'),
        createdById: admin,
      },
    });
  }

  async function redemption(voucherId: string) {
    return db.redemption.create({
      data: {
        userId: user,
        voucherId,
        idempotencyKey: randomUUID(),
        // FAILED: any row proves the FK / append-only rules, and a SUCCEEDED row
        // now needs a journal, a balance snapshot and a code (12.8 invariants).
        status: 'FAILED',
        failureCode: 'SOLD_OUT',
        pricePoints: 100,
        priceVersion: 1,
        priceSource: 'BASE',
        reference: `RDM-${randomUUID()}`,
      },
    });
  }

  liveIt(
    'rejects negative remaining stock and voucher deletion with redemption',
    async () => {
      const row = await voucher();
      await expect(
        db.voucher.update({
          where: { id: row.id },
          data: { stockRemaining: -1 },
        }),
      ).rejects.toThrow();
      const redeemed = await redemption(row.id);
      await expect(
        db.voucher.delete({ where: { id: row.id } }),
      ).rejects.toThrow();
      expect(
        await db.redemption.findUnique({ where: { id: redeemed.id } }),
      ).not.toBeNull();
    },
  );

  liveIt(
    'enforces code uniqueness per voucher and unique redemption assignment',
    async () => {
      const row = await voucher();
      const redeemed = await redemption(row.id);
      await db.voucherCode.create({
        data: { voucherId: row.id, code: 'PG-ONE', redemptionId: redeemed.id },
      });
      await expect(
        db.voucherCode.create({ data: { voucherId: row.id, code: 'PG-ONE' } }),
      ).rejects.toThrow();
      await expect(
        db.voucherCode.create({
          data: {
            voucherId: row.id,
            code: 'PG-TWO',
            redemptionId: redeemed.id,
          },
        }),
      ).rejects.toThrow();
    },
  );

  liveIt(
    'rejects UPDATE and DELETE on both append-only histories',
    async () => {
      const row = await voucher();
      const price = await db.voucherPriceVersion.create({
        data: {
          voucherId: row.id,
          version: 1,
          basePoints: 100,
          effectiveFrom: new Date(),
          changedById: admin,
        },
      });
      const redeemed = await redemption(row.id);
      await expect(
        db.voucherPriceVersion.update({
          where: { id: price.id },
          data: { basePoints: 90 },
        }),
      ).rejects.toThrow();
      await expect(
        db.voucherPriceVersion.delete({ where: { id: price.id } }),
      ).rejects.toThrow();
      await expect(
        db.redemption.update({
          where: { id: redeemed.id },
          data: { pricePoints: 90 },
        }),
      ).rejects.toThrow();
      await expect(
        db.redemption.delete({ where: { id: redeemed.id } }),
      ).rejects.toThrow();
    },
  );

  liveIt('rejects TRUNCATE on the append-only histories', async () => {
    await expect(
      db.$executeRawUnsafe('TRUNCATE TABLE voucher_price_versions'),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.$executeRawUnsafe('TRUNCATE TABLE redemptions'),
    ).rejects.toThrow();
  });

  liveIt(
    'PrismaVoucherRepository.adjustStock lets exactly one concurrent decrement win',
    async () => {
      const row = await voucher(1);
      const prisma = new PrismaService({
        datasources: { db: { url: databaseUrl } },
      });
      try {
        const repo = new PrismaVoucherRepository(prisma);
        const results = await Promise.all(
          [0, 1].map(() =>
            repo.adjustStock(row.id, 1, 1, new Date().toISOString()),
          ),
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        expect(
          await db.voucher.findUniqueOrThrow({ where: { id: row.id } }),
        ).toMatchObject({ stockTotal: 1, stockRemaining: 0 });
      } finally {
        await prisma.$disconnect();
      }
    },
  );

  liveIt(
    'RewardsAdminCatalogService.importCodes commits one whole batch for concurrent identical imports',
    async () => {
      const row = await voucher(0);
      await db.voucher.update({
        where: { id: row.id },
        data: { stockTotal: 0 },
      });
      const prisma = new PrismaService({
        datasources: { db: { url: databaseUrl } },
      });
      try {
        const service = new RewardsAdminCatalogService({
          vouchers: new PrismaVoucherRepository(prisma),
          codes: new PrismaVoucherCodeRepository(prisma),
          flashSales: new PrismaFlashSaleReadRepository(prisma),
          redemptions: new PrismaRedemptionRepository(prisma),
          adminCapability: {
            listActiveAdminIds: async () => [],
            findCurrentCapability: async (id: string) => ({
              userId: id,
              role: 'ADMIN',
              status: 'ACTIVE',
            }),
          },
          unitOfWork: new PrismaUnitOfWork(prisma),
          now: () => new Date(),
        });
        const code = `PG-${randomUUID().slice(0, 8)}`;
        const input = {
          codes: [code, `${code}-SECOND`],
          mode: 'COMMIT' as const,
        };
        const results = await Promise.all([
          service.importCodes(row.id, admin, input),
          service.importCodes(row.id, admin, input),
        ]);
        expect(results.filter((r) => r.committed)).toHaveLength(1);
        expect(results.filter((r) => !r.committed)).toHaveLength(1);
        expect(
          await db.voucherCode.count({ where: { voucherId: row.id } }),
        ).toBe(2);
        expect(
          await db.voucher.findUniqueOrThrow({ where: { id: row.id } }),
        ).toMatchObject({ stockTotal: 2, stockRemaining: 2 });
      } finally {
        await prisma.$disconnect();
      }
    },
  );
});
