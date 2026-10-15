import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  adminFlashSaleCreatedSchema,
  adminFlashSaleListSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { SessionService } from '../src/modules/auth/application/session.service';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { VOUCHER_REPOSITORY_PORT } from '../src/modules/rewards/application/ports/voucher-repository.port';
import { VOUCHER_CODE_REPOSITORY_PORT } from '../src/modules/rewards/application/ports/voucher-code-repository.port';
import { FLASH_SALE_READ_PORT } from '../src/modules/rewards/application/ports/flash-sale-read.port';
import { FLASH_SALE_REPOSITORY_PORT } from '../src/modules/rewards/application/ports/flash-sale-repository.port';
import { WALLET_BALANCE_PORT } from '../src/modules/rewards/application/ports/wallet-balance.port';
import { InMemoryVoucherRepository } from '../src/modules/rewards/infrastructure/in-memory-voucher.repository';
import { InMemoryVoucherCodeRepository } from '../src/modules/rewards/infrastructure/in-memory-voucher-code.repository';
import { InMemoryFlashSaleRepository } from '../src/modules/rewards/infrastructure/in-memory-flash-sale.repository';
import {
  UNIT_OF_WORK_PORT,
  PassThroughUnitOfWork,
} from '../src/common/database/unit-of-work.port';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { ADMIN_USER_DIRECTORY_PORT } from '../src/modules/users/application/ports/admin-user-directory.port';

const ORIGIN = 'http://localhost:3000';
const DB = 'postgresql://postgres:postgres@localhost:5433/rescom_test';

describe('Admin Rewards Flash Sales HTTP contracts (in memory)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let vouchers: InMemoryVoucherRepository;
  let flashRepo: InMemoryFlashSaleRepository;
  let sessions: SessionService;
  let sequence = 0;
  type Actor = { cookie: string; csrf: string };

  async function actor(role: 'ADMIN' | 'RESPONDENT'): Promise<Actor> {
    const user = await users.create({
      email: `flash-admin-http-${++sequence}@fpt.edu.vn`,
      passwordHash: null,
      role,
      status: 'ACTIVE',
    });
    const tokens = await sessions.createSession(user.id);
    return {
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function get(path: string, who?: Actor) {
    const call = request(app.getHttpServer()).get(path).set('Origin', ORIGIN);
    return who ? call.set('Cookie', [who.cookie]) : call;
  }

  function write(
    method: 'post' | 'put',
    path: string,
    payload: object,
    who: Actor,
    csrf = true,
  ) {
    const call = request(app.getHttpServer())
      [method](path)
      .set('Origin', ORIGIN)
      .set('Cookie', [who.cookie]);
    if (csrf) call.set('x-csrf-token', who.csrf);
    return call.send(payload);
  }

  const voucherId = '00000000-0000-4000-8000-000000000010';

  beforeAll(async () => {
    process.env.DATABASE_URL ||= DB;
    users = new InMemoryUserRepository();
    vouchers = new InMemoryVoucherRepository();
    flashRepo = new InMemoryFlashSaleRepository();
    const audit = new InMemoryIdentityAuditRepository();

    vouchers.vouchers.set(voucherId, {
      id: voucherId,
      title: 'Highlands 50k',
      brand: { id: 'highlands', name: 'Highlands' },
      category: 'COFFEE',
      valueVnd: 50000,
      basePoints: 100,
      promoPoints: 90,
      priceVersion: 1,
      stockTotal: 50,
      stockRemaining: 50,
      codesAvailable: 50,
      state: 'ACTIVE',
      isVisible: true,
      isSharedCode: false,
      sharedCode: null,
      redeemStartsAt: '2026-10-01T00:00:00.000Z',
      redeemEndsAt: '2026-12-31T00:00:00.000Z',
      codeExpiresAt: '2027-01-01T00:00:00.000Z',
      description: null,
      whereToUse: null,
      terms: [],
      howToUse: [],
      imageUrl: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      createdById: '00000000-0000-4000-8000-000000000001',
    });

    const env = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: DB,
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ORIGIN,
      REWARDS_ENABLED: true,
    });

    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(users)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(new InMemorySessionRepository(audit))
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(audit)
      .overrideProvider(VOUCHER_REPOSITORY_PORT)
      .useValue(vouchers)
      .overrideProvider(VOUCHER_CODE_REPOSITORY_PORT)
      .useValue(new InMemoryVoucherCodeRepository())
      .overrideProvider(FLASH_SALE_REPOSITORY_PORT)
      .useValue(flashRepo)
      .overrideProvider(FLASH_SALE_READ_PORT)
      .useValue(flashRepo)
      .overrideProvider(WALLET_BALANCE_PORT)
      .useValue({ getBalance: async () => ({ available: 0, pending: 0 }) })
      .overrideProvider(UNIT_OF_WORK_PORT)
      .useValue(new PassThroughUnitOfWork())
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(
        new InMemoryAdminCapabilityRepository((id) => users.findById(id)),
      )
      .overrideProvider(ADMIN_USER_DIRECTORY_PORT)
      .useValue({
        findStatuses: async () => new Map(),
        findLabels: async (ids: readonly string[]) =>
          new Map(
            ids.map((id) => [
              id,
              { displayName: 'Admin User', email: 'admin@fpt.edu.vn' },
            ]),
          ),
        filterMatching: async () => [],
      })
      .overrideProvider(EnvService)
      .useValue(env)
      .compile();

    sessions = module.get(SessionService);
    app = module.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('enforces auth, admin role, and csrf on admin flash endpoints', async () => {
    const member = await actor('RESPONDENT');
    const admin = await actor('ADMIN');

    await get('/admin/rewards/flash-sales').expect(401);
    await get('/admin/rewards/flash-sales', member).expect(403);

    const csrfFail = await write(
      'post',
      '/admin/rewards/flash-sales',
      {},
      admin,
      false,
    ).expect(403);
    expect(csrfFail.body.error.code).toMatch(/CSRF/);
  });

  it('rejects a non-UUID :id with 400 VALIDATION_ERROR on detail, update and end', async () => {
    const admin = await actor('ADMIN');
    const bad = '/admin/rewards/flash-sales/not-a-uuid';
    const detail = await get(bad, admin).expect(400);
    expect(detail.body.error.code).toBe('VALIDATION_ERROR');
    expect(
      (await write('put', bad, {}, admin).expect(400)).body.error.code,
    ).toBe('VALIDATION_ERROR');
    expect(
      (
        await write(
          'post',
          `${bad}/end`,
          { reason: 'WRONG_PRICE' },
          admin,
        ).expect(400)
      ).body.error.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('exercises full CRUD and early-end lifecycle through API (contracts AC1)', async () => {
    const admin = await actor('ADMIN');

    // 1. Initial list is empty
    const listInitial = await get('/admin/rewards/flash-sales', admin).expect(
      200,
    );
    const parsed = adminFlashSaleListSchema.parse(listInitial.body.data);
    expect(parsed.items).toHaveLength(0);

    // 2. 404 on missing
    const missing = await get(
      '/admin/rewards/flash-sales/00000000-0000-4000-8000-000000000999',
      admin,
    ).expect(404);
    expect(missing.body.error.code).toBe('FLASH_SALE_NOT_FOUND');

    // 3. Validation error on invalid body (e.g. empty items)
    await write('post', '/admin/rewards/flash-sales', {}, admin).expect(400);

    // 4. Create new flash sale
    const startsAt = new Date(Date.now() + 3600_000).toISOString();
    const endsAt = new Date(Date.now() + 7200_000).toISOString();
    const payload = {
      title: 'Flash Siêu Sale',
      startsAt,
      endsAt,
      rules: {
        requireRecentSurvey: true,
        remindBefore10m: true,
        blockFlagged: true,
      },
      items: [
        {
          voucherId,
          flashPoints: 50,
          quota: 10,
          perUserCap: 1,
        },
      ],
    };

    const created = await write(
      'post',
      '/admin/rewards/flash-sales',
      payload,
      admin,
    ).expect(201);
    const createdData = adminFlashSaleCreatedSchema.parse(created.body.data);
    const flashId = createdData.flashSale.id;
    expect(createdData.flashSale.title).toBe('Flash Siêu Sale');
    expect(createdData.flashSale.code).toMatch(/^FS-\d{6}-[A-Z]$/);

    // 5. Get detail by ID
    const detail = await get(
      `/admin/rewards/flash-sales/${flashId}`,
      admin,
    ).expect(200);
    const detailData = adminFlashSaleCreatedSchema.parse(detail.body.data);
    expect(detailData.flashSale.id).toBe(flashId);
    expect(detailData.flashSale.items[0].voucherId).toBe(voucherId);

    // 6. Update draft flash sale
    const updated = await write(
      'put',
      `/admin/rewards/flash-sales/${flashId}`,
      {
        ...payload,
        title: 'Flash Siêu Sale Đã Cập Nhật',
        items: [{ voucherId, flashPoints: 45, quota: 15, perUserCap: 1 }],
      },
      admin,
    ).expect(200);
    const updatedData = adminFlashSaleCreatedSchema.parse(updated.body.data);
    expect(updatedData.flashSale.title).toBe('Flash Siêu Sale Đã Cập Nhật');
    expect(updatedData.flashSale.items[0].quota).toBe(15);

    // 7. End early fails when sale is not active (still upcoming)
    const earlyNotActive = await write(
      'post',
      `/admin/rewards/flash-sales/${flashId}/end`,
      { reason: 'WRONG_PRICE' },
      admin,
    ).expect(409);
    expect(earlyNotActive.body.error.code).toBe('FLASH_NOT_ACTIVE');

    // 8. End early validation failure (OTHER reason requires note)
    const invalidReason = await write(
      'post',
      `/admin/rewards/flash-sales/${flashId}/end`,
      { reason: 'OTHER' },
      admin,
    ).expect(400);
    expect(invalidReason.body.error.code).toBe('VALIDATION_ERROR');

    // 9. Transition sale to ACTIVE in memory repository, then end early succeeds
    const saleRecord = flashRepo.sales.find((s) => s.id === flashId)!;
    saleRecord.startsAt = new Date(Date.now() - 3600_000).toISOString();
    saleRecord.reservedAt = new Date(Date.now() - 3600_000).toISOString();

    const ended = await write(
      'post',
      `/admin/rewards/flash-sales/${flashId}/end`,
      { reason: 'WRONG_PRICE', note: 'Price error corrected' },
      admin,
    ).expect(200);
    const endedData = adminFlashSaleCreatedSchema.parse(ended.body.data);
    expect(endedData.flashSale.endReason).toBe('WRONG_PRICE');
    expect(endedData.flashSale.endedEarlyAt).not.toBeNull();

    // 10. Ending again returns 409 FLASH_ALREADY_ENDED
    const alreadyEnded = await write(
      'post',
      `/admin/rewards/flash-sales/${flashId}/end`,
      { reason: 'WRONG_PRICE' },
      admin,
    ).expect(409);
    expect(alreadyEnded.body.error.code).toBe('FLASH_ALREADY_ENDED');
  });
});
