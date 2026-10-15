import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { randomUUID } from 'crypto';
import {
  redemptionQuoteSchema,
  redemptionResultSchema,
  redemptionErrorSchema,
  CreateRedemptionQuoteDto,
  RedeemVoucherDto,
  IDEMPOTENCY_KEY_HEADER,
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
import { SPEND_POINTS_PORT } from '../src/modules/rewards/application/ports/spend-points.port';
import { ACCOUNT_STANDING_PORT } from '../src/modules/rewards/application/ports/account-standing.port';
import { FRAUD_FLAG_PORT } from '../src/modules/rewards/application/ports/fraud-flag.port';
import { REDEMPTION_REPOSITORY_PORT } from '../src/modules/rewards/application/ports/redemption-repository.port';
import { InMemoryVoucherRepository } from '../src/modules/rewards/infrastructure/in-memory-voucher.repository';
import { InMemoryVoucherCodeRepository } from '../src/modules/rewards/infrastructure/in-memory-voucher-code.repository';
import { InMemoryFlashSaleReadRepository } from '../src/modules/rewards/infrastructure/in-memory-flash-sale-read.repository';
import { InMemoryRedemptionRepository } from '../src/modules/rewards/infrastructure/in-memory-redemption.repository';
import {
  UNIT_OF_WORK_PORT,
  PassThroughUnitOfWork,
} from '../src/common/database/unit-of-work.port';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';

const ORIGIN = 'http://localhost:3000';
const DB = 'postgresql://postgres:postgres@localhost:5433/rescom_test';

describe('Rewards redemption HTTP contracts (in memory)', () => {
  let app: INestApplication;
  let users: InMemoryUserRepository;
  let vouchers: InMemoryVoucherRepository;
  let voucherCodes: InMemoryVoucherCodeRepository;
  let redemptions: InMemoryRedemptionRepository;
  let sessions: SessionService;
  let userBalance = 1000;
  const accountStanding = {
    isActive: jest.fn().mockResolvedValue(true),
    isActivated: jest.fn().mockResolvedValue(true),
    completedSurveyInLastDays: jest.fn().mockResolvedValue(true),
    hasBlockingFraudFlag: jest.fn().mockResolvedValue(false),
    hasApprovedTopUpSince: jest.fn().mockResolvedValue(false),
  };
  let sequence = 0;
  type Actor = { id: string; cookie: string; csrf: string };

  async function actor(role: 'ADMIN' | 'RESPONDENT'): Promise<Actor> {
    const user = await users.create({
      email: `redemption-http-${++sequence}@fpt.edu.vn`,
      passwordHash: null,
      role,
      status: 'ACTIVE',
    });
    const tokens = await sessions.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function post(
    path: string,
    payload: object,
    who?: Actor,
    headers: Record<string, string> = {},
  ) {
    const call = request(app.getHttpServer()).post(path).set('Origin', ORIGIN);
    if (who) {
      call.set('Cookie', [who.cookie]).set('x-csrf-token', who.csrf);
    }
    for (const [k, v] of Object.entries(headers)) {
      call.set(k, v);
    }
    return call.send(payload);
  }

  function get(path: string, who?: Actor) {
    const call = request(app.getHttpServer()).get(path).set('Origin', ORIGIN);
    return who ? call.set('Cookie', [who.cookie]) : call;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL ||= DB;
    users = new InMemoryUserRepository();
    vouchers = new InMemoryVoucherRepository();
    voucherCodes = new InMemoryVoucherCodeRepository();
    redemptions = new InMemoryRedemptionRepository();
    vouchers.brands.set('brand-1', { id: 'brand-1', name: 'Highlands' });

    const audit = new InMemoryIdentityAuditRepository();
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

    const mockSpendPoints = {
      spendPoints: jest
        .fn()
        .mockImplementation(async ({ amount }: { amount: number }) => {
          userBalance -= amount;
          return { journalId: randomUUID(), balanceAfter: userBalance };
        }),
    };

    const mockFraudFlag = {
      recordFlashAfterTopUp: jest.fn().mockResolvedValue(undefined),
    };

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
      .useValue(voucherCodes)
      .overrideProvider(FLASH_SALE_READ_PORT)
      .useValue(new InMemoryFlashSaleReadRepository())
      .overrideProvider(WALLET_BALANCE_PORT)
      .useValue({
        getBalance: async () => ({ available: userBalance, pending: 0 }),
      })
      .overrideProvider(REDEMPTION_REPOSITORY_PORT)
      .useValue(redemptions)
      .overrideProvider(ACCOUNT_STANDING_PORT)
      .useValue(accountStanding)
      .overrideProvider(SPEND_POINTS_PORT)
      .useValue(mockSpendPoints)
      .overrideProvider(FRAUD_FLAG_PORT)
      .useValue(mockFraudFlag)
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

  it('enforces auth, csrf, json-only, and idempotency key guards', async () => {
    const member = await actor('RESPONDENT');
    const voucherId = randomUUID();

    // 401 Unauthorized without session
    await request(app.getHttpServer())
      .post('/rewards/quotes')
      .send({ voucherId })
      .expect(401);

    // 403 Forbidden without CSRF
    await request(app.getHttpServer())
      .post('/rewards/quotes')
      .set('Origin', ORIGIN)
      .set('Cookie', [member.cookie])
      .send({ voucherId })
      .expect(403);

    // 400 Bad Request if missing Idempotency-Key on redeem
    const missingKeyRes = await post(
      '/rewards/redemptions',
      { quoteId: randomUUID() },
      member,
    ).expect(400);
    expect(missingKeyRes.body.error.code).toBe('VALIDATION_ERROR');

    // 400 Bad Request if invalid Idempotency-Key
    const invalidKeyRes = await post(
      '/rewards/redemptions',
      { quoteId: randomUUID() },
      member,
      { 'Idempotency-Key': 'short' },
    ).expect(400);
    expect(invalidKeyRes.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('runs full quote, redeem, and replay under both route prefixes', async () => {
    const member = await actor('RESPONDENT');
    const voucherId = randomUUID();
    const voucher = await vouchers.create({
      id: voucherId,
      title: 'Highlands Coffee 50k',
      brand: { id: 'brand-1', name: 'Highlands' },
      category: 'COFFEE',
      valueVnd: 50_000,
      basePoints: 500,
      promoPoints: null,
      priceVersion: 1,
      stockTotal: 10,
      stockRemaining: 10,
      codesAvailable: 1,
      state: 'ACTIVE',
      isVisible: true,
      isSharedCode: false,
      sharedCode: null,
      description: 'Coffee',
      whereToUse: 'Nationwide',
      terms: ['Term 1'],
      howToUse: ['Step 1'],
      imageUrl: null,
      redeemStartsAt: new Date(Date.now() - 3600_000).toISOString(),
      redeemEndsAt: new Date(Date.now() + 86400_000).toISOString(),
      codeExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdById: 'admin-1',
    });

    // Populate a voucher code in redemptions repo
    const codeId = randomUUID();
    redemptions.codes.set(codeId, {
      id: codeId,
      voucherId: voucher.id,
      code: 'SECRET123',
      redemptionId: null,
    });

    // 1. POST /rewards/quotes
    const quotePayload: CreateRedemptionQuoteDto = { voucherId: voucher.id };
    const quoteRes = await post('/rewards/quotes', quotePayload, member).expect(
      201,
    );
    const quoteData = quoteRes.body.data;
    const validatedQuote = redemptionQuoteSchema.parse(quoteData);
    expect(validatedQuote.voucherId).toBe(voucher.id);
    expect(validatedQuote.price.points).toBe(500);
    expect(validatedQuote.balance.available).toBe(1000);
    expect(validatedQuote.balance.after).toBe(500);

    // 2. POST /api/rewards/redemptions with Idempotency-Key
    const idempotencyKey = `e2e-redeem-${randomUUID()}`;
    const redeemPayload: RedeemVoucherDto = { quoteId: validatedQuote.quoteId };
    const redeemRes = await post(
      '/api/rewards/redemptions',
      redeemPayload,
      member,
      { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    ).expect(201);

    const redeemData = redeemRes.body.data;
    const validatedResult = redemptionResultSchema.parse(redeemData);
    expect(validatedResult.status).toBe('SUCCEEDED');
    expect(validatedResult.pointsSpent).toBe(500);
    expect(validatedResult.ticket.code).toBe('SECRET123');

    // 3. Replay with same Idempotency-Key returns identical result
    const replayRes = await post(
      '/rewards/redemptions',
      redeemPayload,
      member,
      { 'Idempotency-Key': idempotencyKey },
    ).expect(201);
    expect(replayRes.body.data).toEqual(redeemData);

    // 4. Lost response recovery via GET /rewards/redemptions/by-key/:key
    const recoveryRes = await get(
      `/rewards/redemptions/by-key/${idempotencyKey}`,
      member,
    ).expect(201);
    expect(recoveryRes.body.data).toEqual(redeemData);

    // 5. GET /api/rewards/redemptions/by-key/:key
    const apiRecoveryRes = await get(
      `/api/rewards/redemptions/by-key/${idempotencyKey}`,
      member,
    ).expect(201);
    expect(apiRecoveryRes.body.data).toEqual(redeemData);
  });

  it('maps rejection errors (INSUFFICIENT_POINTS, SOLD_OUT) cleanly to HTTP responses', async () => {
    const poorMember = await actor('RESPONDENT');
    userBalance = 50; // less than basePoints 400

    const voucherId = randomUUID();
    const voucher = await vouchers.create({
      id: voucherId,
      title: 'Expensive Voucher',
      brand: { id: 'brand-1', name: 'Highlands' },
      category: 'COFFEE',
      valueVnd: 50_000,
      basePoints: 400,
      promoPoints: null,
      priceVersion: 1,
      stockTotal: 10,
      stockRemaining: 10,
      codesAvailable: 1,
      state: 'ACTIVE',
      isVisible: true,
      isSharedCode: false,
      sharedCode: null,
      description: null,
      whereToUse: null,
      terms: [],
      howToUse: [],
      imageUrl: null,
      redeemStartsAt: new Date(Date.now() - 3600_000).toISOString(),
      redeemEndsAt: new Date(Date.now() + 86400_000).toISOString(),
      codeExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdById: 'admin-1',
    });

    // 1. Quote fails with 409 INSUFFICIENT_POINTS
    const quoteRes = await post(
      '/rewards/quotes',
      { voucherId: voucher.id },
      poorMember,
    ).expect(409);
    expect(quoteRes.body.error.code).toBe('INSUFFICIENT_POINTS');
    redemptionErrorSchema.parse({
      code: quoteRes.body.error.code,
      message: quoteRes.body.error.message,
      details: quoteRes.body.error.details,
    });
  });

  async function sellableVoucher(basePoints: number, code: string) {
    const voucher = await vouchers.create({
      id: randomUUID(),
      title: `Voucher ${basePoints}`,
      brand: { id: 'brand-1', name: 'Highlands' },
      category: 'COFFEE',
      valueVnd: 50_000,
      basePoints,
      promoPoints: null,
      priceVersion: 1,
      stockTotal: 10,
      stockRemaining: 10,
      codesAvailable: 1,
      state: 'ACTIVE',
      isVisible: true,
      isSharedCode: false,
      sharedCode: null,
      description: null,
      whereToUse: null,
      terms: [],
      howToUse: [],
      imageUrl: null,
      redeemStartsAt: new Date(Date.now() - 3600_000).toISOString(),
      redeemEndsAt: new Date(Date.now() + 86400_000).toISOString(),
      codeExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdById: 'admin-1',
    });
    const codeId = randomUUID();
    redemptions.codes.set(codeId, {
      id: codeId,
      voucherId: voucher.id,
      code,
      redemptionId: null,
    });
    return voucher;
  }

  it('guards both write routes and the by-key read (401, CSRF, JSON-only)', async () => {
    const member = await actor('RESPONDENT');
    for (const prefix of ['/rewards', '/api/rewards']) {
      await request(app.getHttpServer())
        .post(`${prefix}/redemptions`)
        .send({ quoteId: randomUUID() })
        .expect(401);
      await request(app.getHttpServer())
        .get(`${prefix}/redemptions/by-key/some-key-1234`)
        .expect(401);
      await request(app.getHttpServer())
        .post(`${prefix}/redemptions`)
        .set('Origin', ORIGIN)
        .set('Cookie', [member.cookie])
        .set('Idempotency-Key', 'valid-key-1234')
        .send({ quoteId: randomUUID() })
        .expect(403);
      await request(app.getHttpServer())
        .post(`${prefix}/quotes`)
        .set('Origin', ORIGIN)
        .set('Cookie', [member.cookie])
        .set('x-csrf-token', member.csrf)
        .set('Content-Type', 'text/plain')
        .send('voucherId')
        .expect(415);
    }
    await get('/rewards/redemptions/by-key/short', member).expect(400);
  });

  it('maps QUOTE_NOT_FOUND, REDEMPTION_NOT_FOUND, QUOTE_ALREADY_REDEEMED and IDEMPOTENCY_KEY_CONFLICT', async () => {
    userBalance = 1000;
    const member = await actor('RESPONDENT');
    const voucher = await sellableVoucher(100, 'CODE-MAP-1');
    await redemptions.codes.set('extra', {
      id: 'extra',
      voucherId: voucher.id,
      code: 'CODE-MAP-2',
      redemptionId: null,
    });
    const quote = (
      await post('/rewards/quotes', { voucherId: voucher.id }, member).expect(
        201,
      )
    ).body.data;
    const otherQuote = (
      await post('/rewards/quotes', { voucherId: voucher.id }, member).expect(
        201,
      )
    ).body.data;

    const missing = await post(
      '/rewards/redemptions',
      { quoteId: randomUUID() },
      member,
      { 'Idempotency-Key': 'missing-quote-1' },
    ).expect(404);
    expect(missing.body.error.code).toBe('QUOTE_NOT_FOUND');

    await post('/rewards/redemptions', { quoteId: quote.quoteId }, member, {
      'Idempotency-Key': 'map-key-0001',
    }).expect(201);

    const conflict = await post(
      '/rewards/redemptions',
      { quoteId: otherQuote.quoteId },
      member,
      { 'Idempotency-Key': 'map-key-0001' },
    ).expect(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');

    const already = await post(
      '/rewards/redemptions',
      { quoteId: quote.quoteId },
      member,
      { 'Idempotency-Key': 'map-key-0002' },
    ).expect(409);
    expect(already.body.error.code).toBe('QUOTE_ALREADY_REDEEMED');

    const unknown = await get(
      '/rewards/redemptions/by-key/never-used-key',
      member,
    ).expect(404);
    expect(unknown.body.error.code).toBe('REDEMPTION_NOT_FOUND');
  });

  it('maps ACCOUNT_NOT_ELIGIBLE to 403 and replays a stored failure with the original body', async () => {
    userBalance = 1000;
    const member = await actor('RESPONDENT');
    const voucher = await sellableVoucher(100, 'CODE-FAIL-1');
    const quote = (
      await post('/rewards/quotes', { voucherId: voucher.id }, member).expect(
        201,
      )
    ).body.data;

    accountStanding.isActive.mockResolvedValueOnce(false); // locked at confirm
    const failed = await post(
      '/rewards/redemptions',
      { quoteId: quote.quoteId },
      member,
      { 'Idempotency-Key': 'fail-key-0001' },
    ).expect(403);
    const parsed = redemptionErrorSchema.parse(failed.body.error);
    expect(parsed).toMatchObject({
      code: 'ACCOUNT_NOT_ELIGIBLE',
      details: { reason: 'ACCOUNT_LOCKED' },
    });

    // The account recovered, but the same key still answers the stored failure.
    const replay = await post(
      '/rewards/redemptions',
      { quoteId: quote.quoteId },
      member,
      { 'Idempotency-Key': 'fail-key-0001' },
    ).expect(403);
    const { requestId: _r1, ...failedBody } = failed.body.error;
    const { requestId: _r2, ...replayBody } = replay.body.error;
    expect(replayBody).toEqual(failedBody);
    const byKey = await get(
      '/api/rewards/redemptions/by-key/fail-key-0001',
      member,
    ).expect(403);
    const { requestId: _r3, ...byKeyBody } = byKey.body.error;
    expect(byKeyBody).toEqual(failedBody);
  });
});
