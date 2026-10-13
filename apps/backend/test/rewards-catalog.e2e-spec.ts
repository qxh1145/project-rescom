import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  adminCodeImportResultSchema,
  adminVoucherBrandListSchema,
  adminVoucherCreatedSchema,
  adminVoucherDetailSchema,
  adminVoucherListSchema,
  flashSaleListSchema,
  voucherCatalogSchema,
  voucherDetailResponseSchema,
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
import { WALLET_BALANCE_PORT } from '../src/modules/rewards/application/ports/wallet-balance.port';
import { InMemoryVoucherRepository } from '../src/modules/rewards/infrastructure/in-memory-voucher.repository';
import { InMemoryVoucherCodeRepository } from '../src/modules/rewards/infrastructure/in-memory-voucher-code.repository';
import { InMemoryFlashSaleReadRepository } from '../src/modules/rewards/infrastructure/in-memory-flash-sale-read.repository';
import {
  UNIT_OF_WORK_PORT,
  PassThroughUnitOfWork,
} from '../src/common/database/unit-of-work.port';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';

const ORIGIN = 'http://localhost:3000';
const DB = 'postgresql://postgres:postgres@localhost:5433/rescom_test';

describe('Rewards catalog HTTP contracts (in memory)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let vouchers: InMemoryVoucherRepository;
  let sessions: SessionService;
  let sequence = 0;
  type Actor = { cookie: string; csrf: string };

  async function actor(role: 'ADMIN' | 'RESPONDENT'): Promise<Actor> {
    const user = await users.create({
      email: `rewards-http-${++sequence}@fpt.edu.vn`,
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
    method: 'post' | 'put' | 'patch',
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

  beforeAll(async () => {
    process.env.DATABASE_URL ||= DB;
    users = new InMemoryUserRepository();
    vouchers = new InMemoryVoucherRepository();
    vouchers.brands.set('highlands-coffee', {
      id: 'highlands-coffee',
      name: 'Highlands Coffee',
    });
    const audit = new InMemoryIdentityAuditRepository();
    const env = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: DB,
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ORIGIN,
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
      .overrideProvider(FLASH_SALE_READ_PORT)
      .useValue(new InMemoryFlashSaleReadRepository())
      .overrideProvider(WALLET_BALANCE_PORT)
      .useValue({ getBalance: async () => ({ available: 0, pending: 0 }) })
      .overrideProvider(UNIT_OF_WORK_PORT)
      .useValue(new PassThroughUnitOfWork())
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(
        new InMemoryAdminCapabilityRepository((id) => users.findById(id)),
      )
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

  it('requires session, Admin role, and CSRF on Admin writes', async () => {
    const member = await actor('RESPONDENT');
    const admin = await actor('ADMIN');
    await get('/admin/rewards/vouchers').expect(401);
    const forbidden = await get('/admin/rewards/vouchers', member).expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN_RESOURCE');
    await get('/rewards/vouchers').expect(401);
    const missingCsrf = await write(
      'post',
      '/admin/rewards/vouchers',
      {},
      admin,
      false,
    ).expect(403);
    expect(missingCsrf.body.error.code).toMatch(/CSRF/);
  });

  it('returns FE-compatible empty catalog, flash sale, Admin list, and brands', async () => {
    const member = await actor('RESPONDENT');
    const admin = await actor('ADMIN');
    expect(
      voucherCatalogSchema.parse(
        (await get('/rewards/vouchers', member).expect(200)).body.data,
      ).items,
    ).toEqual([]);
    expect(
      flashSaleListSchema.parse(
        (await get('/rewards/flash-sales', member).expect(200)).body.data,
      ).items,
    ).toEqual([]);
    expect(
      adminVoucherListSchema.parse(
        (await get('/admin/rewards/vouchers', admin).expect(200)).body.data,
      ).items,
    ).toEqual([]);
    expect(
      adminVoucherBrandListSchema.parse(
        (await get('/admin/rewards/brands', admin).expect(200)).body.data,
      ).items.length,
    ).toBeGreaterThan(0);
  });

  it('creates, prices, stocks, hides, and archives voucher through HTTP', async () => {
    const admin = await actor('ADMIN');
    const member = await actor('RESPONDENT');
    const brands = await get('/admin/rewards/brands', admin).expect(200);
    const brandId = adminVoucherBrandListSchema.parse(brands.body.data).items[0]
      .id;
    const input = {
      title: 'Coffee voucher',
      brandId,
      category: 'COFFEE',
      valueVnd: 50_000,
      basePoints: 500,
      promoPoints: null,
      isSharedCode: false,
      redeemStartsAt: '2020-01-01T00:00:00.000Z',
      redeemEndsAt: '2090-01-01T00:00:00.000Z',
      codeExpiresAt: '2090-01-09T00:00:00.000Z',
      terms: [],
      howToUse: [],
      imageUrl: null,
    };
    const server = app.getHttpServer();
    const adminHeaders = (req: request.Test) =>
      req
        .set('Origin', ORIGIN)
        .set('Cookie', [admin.cookie])
        .set('x-csrf-token', admin.csrf);

    // POST create
    const created = await adminHeaders(
      request(server).post('/admin/rewards/vouchers'),
    )
      .send(input)
      .expect(201);
    const voucher = adminVoucherCreatedSchema.parse(created.body.data).voucher;
    expect(voucher.stock.remaining).toBe(
      voucher.stock.total - voucher.stock.issued - voucher.stock.flashReserved,
    );

    // GET detail (dynamic :id)
    const detail = await request(server)
      .get(`/admin/rewards/vouchers/${voucher.id}`)
      .set('Origin', ORIGIN)
      .set('Cookie', [admin.cookie])
      .expect(200);
    expect(adminVoucherDetailSchema.parse(detail.body.data).voucher.id).toBe(
      voucher.id,
    );

    // PUT update (dynamic :id)
    const updated = await adminHeaders(
      request(server).put(`/admin/rewards/vouchers/${voucher.id}`),
    )
      .send({ ...input, title: 'Updated coffee voucher', basePoints: 700 })
      .expect(200);
    expect(
      adminVoucherCreatedSchema.parse(updated.body.data).voucher.title,
    ).toBe('Updated coffee voucher');

    // POST codes (dynamic :id/codes)
    const imported = await adminHeaders(
      request(server).post(`/admin/rewards/vouchers/${voucher.id}/codes`),
    )
      .send({ codes: ['COFFEE-001'], mode: 'COMMIT' })
      .expect(200);
    expect(
      adminCodeImportResultSchema.parse(imported.body.data).committed,
    ).toBe(true);

    // POST price (dynamic :id/price)
    const priced = await adminHeaders(
      request(server).post(`/admin/rewards/vouchers/${voucher.id}/price`),
    )
      .send({ basePoints: 500, promoPoints: 400 })
      .expect(200);
    expect(
      adminVoucherCreatedSchema.parse(priced.body.data).voucher.price.points,
    ).toBe(400);

    // User catalog sees voucher
    expect(
      voucherCatalogSchema
        .parse((await get('/rewards/vouchers', member).expect(200)).body.data)
        .items.some((item) => item.id === voucher.id),
    ).toBe(true);
    expect(
      voucherDetailResponseSchema.parse(
        (await get(`/rewards/vouchers/${voucher.id}`, member).expect(200)).body
          .data,
      ).voucher.id,
    ).toBe(voucher.id);

    // POST stock (dynamic :id/stock)
    await adminHeaders(
      request(server).post(`/admin/rewards/vouchers/${voucher.id}/stock`),
    )
      .send({ total: 1, reason: 'Review stock' })
      .expect(200);

    // PATCH state — hide (dynamic :id)
    await adminHeaders(
      request(server).patch(`/admin/rewards/vouchers/${voucher.id}`),
    )
      .send({ isVisible: false })
      .expect(200);
    expect(
      (await get(`/rewards/vouchers/${voucher.id}`, member).expect(404)).body
        .error.code,
    ).toBe('VOUCHER_NOT_FOUND');

    // PATCH state — archive (dynamic :id)
    await adminHeaders(
      request(server).patch(`/admin/rewards/vouchers/${voucher.id}`),
    )
      .send({ state: 'ARCHIVED' })
      .expect(200);

    // Archived voucher rejects stock write
    const archived = await adminHeaders(
      request(server).post(`/admin/rewards/vouchers/${voucher.id}/stock`),
    )
      .send({ total: 2, reason: 'Add stock' })
      .expect(409);
    expect(archived.body.error.code).toBe('VOUCHER_ARCHIVED');
  });

  it('serves both route prefixes and maps validation and domain errors', async () => {
    const admin = await actor('ADMIN');
    const member = await actor('RESPONDENT');
    const server = app.getHttpServer();
    const adminHeaders = (req: request.Test) =>
      req
        .set('Origin', ORIGIN)
        .set('Cookie', [admin.cookie])
        .set('x-csrf-token', admin.csrf);
    await get('/api/rewards/vouchers', member).expect(200);
    await get('/api/rewards/flash-sales', member)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    await get('/api/admin/rewards/vouchers', admin).expect(200);

    const invalid = await adminHeaders(
      request(server).post('/admin/rewards/vouchers'),
    )
      .send({ title: '' })
      .expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const input = {
      title: 'Shared voucher',
      brandId: 'highlands-coffee',
      category: 'COFFEE',
      valueVnd: 50_000,
      basePoints: 250,
      promoPoints: null,
      isSharedCode: true,
      sharedCode: 'SHARED-1',
      redeemStartsAt: '2020-01-01T00:00:00.000Z',
      redeemEndsAt: '2090-01-01T00:00:00.000Z',
      codeExpiresAt: '2090-01-09T00:00:00.000Z',
      terms: [],
      howToUse: [],
      imageUrl: null,
    };
    const unknownBrand = await adminHeaders(
      request(server).post('/admin/rewards/vouchers'),
    )
      .send({ ...input, brandId: 'no-such-brand' })
      .expect(400);
    expect(unknownBrand.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ path: 'brandId', code: 'BRAND_NOT_FOUND' }],
    });

    // A non-UUID correlation id must not fail the mutation.
    const created = await adminHeaders(
      request(server).post('/api/admin/rewards/vouchers'),
    )
      .set('x-correlation-id', 'not-a-uuid')
      .send(input)
      .expect(201);
    const id = adminVoucherCreatedSchema.parse(created.body.data).voucher.id;

    const importShared = await adminHeaders(
      request(server).post(`/admin/rewards/vouchers/${id}/codes`),
    )
      .send({ codes: ['CODE-0001'], mode: 'COMMIT' })
      .expect(409);
    expect(importShared.body.error.code).toBe('SHARED_CODE_VOUCHER');

    await adminHeaders(
      request(server).post(`/admin/rewards/vouchers/${id}/stock`),
    )
      .send({ total: 3, reason: 'Open shared stock' })
      .expect(200);
    const locked = await adminHeaders(
      request(server).put(`/admin/rewards/vouchers/${id}`),
    )
      .send({ ...input, isSharedCode: false, sharedCode: undefined })
      .expect(409);
    expect(locked.body.error.code).toBe('SHARED_FLAG_LOCKED');
  });
});
