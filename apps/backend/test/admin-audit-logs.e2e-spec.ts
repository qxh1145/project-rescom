import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { AUDIT_LOG_REPOSITORY_PORT } from '../src/modules/admin/application/ports/audit-log-repository.port';
import { InMemoryAuditLogRepository } from '../src/modules/admin/infrastructure/in-memory-audit-log.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { User } from '../src/modules/users/domain/user.entity';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../src/modules/auth/presentation/cookie-options.helper';
import { USER_ADMIN_TRANSACTION_PORT } from '../src/modules/users/application/ports/user-admin-transaction.port';
import { InMemoryUserAdminTransactionAdapter } from '../src/modules/users/infrastructure/in-memory-user-admin-transaction.adapter';

describe('Admin Audit Logs E2E Tests (Story 1.5)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryAuditLogRepository;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';

  let adminUser: User;
  let respondentUser: User;
  let adminCookies: string[];
  let respondentCookies: string[];
  let adminCsrfToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryAuditLogRepository();
    const identityAudit = new InMemoryIdentityAuditRepository();
    const origIdentityAppend = identityAudit.append.bind(identityAudit);
    identityAudit.append = async (record) => {
      await origIdentityAppend(record);
      await auditRepo.append({
        action: record.action,
        userId: record.userId,
        targetUserId: record.targetUserId,
        outcome: record.outcome,
        errorCode: record.errorCode,
        metadata: record.metadata,
      });
    };
    sessionRepo = new InMemorySessionRepository(identityAudit);

    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
    });

    const mockPrisma = {
      $connect: jest.fn().mockResolvedValue(undefined),
      $disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(identityAudit)
      .overrideProvider(AUDIT_LOG_REPOSITORY_PORT)
      .useValue(auditRepo)
      .overrideProvider(USER_ADMIN_TRANSACTION_PORT)
      .useValue(
        new InMemoryUserAdminTransactionAdapter(
          userRepo,
          sessionRepo,
          identityAudit,
        ),
      )
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    sessionService = moduleFixture.get<SessionService>(SessionService);

    // Create users
    adminUser = await userRepo.create({
      email: 'admin-audit@example.com',
      passwordHash: 'hashed_pw',
      role: 'ADMIN',
    });

    respondentUser = await userRepo.create({
      email: 'respondent-audit@example.com',
      passwordHash: 'hashed_pw',
      role: 'RESPONDENT',
    });

    // Create sessions
    const adminSession = await sessionService.createSession(adminUser.id);
    adminCookies = [
      `${AUTH_COOKIE_NAME}=${adminSession.accessToken}`,
      `${REFRESH_COOKIE_NAME}=${adminSession.refreshToken}`,
    ];
    adminCsrfToken = adminSession.csrfToken;

    const respondentSession = await sessionService.createSession(
      respondentUser.id,
    );
    respondentCookies = [
      `${AUTH_COOKIE_NAME}=${respondentSession.accessToken}`,
      `${REFRESH_COOKIE_NAME}=${respondentSession.refreshToken}`,
    ];
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Route Protection & RBAC Guards', () => {
    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app.getHttpServer()).get('/admin/audit-logs');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    });

    it('should reject non-admin users with 403 FORBIDDEN_RESOURCE', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs')
        .set('Cookie', respondentCookies);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_RESOURCE');
    });

    it('should permit Admin users with 200 OK', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.error).toBeNull();
      expect(res.body.data.items).toBeDefined();
    });
  });

  describe('Validation', () => {
    it('should return 400 VALIDATION_ERROR on invalid page query parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs?page=0')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 VALIDATION_ERROR on malformed UUID parameter', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs/not-a-valid-uuid')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Invalid UUID parameter');
    });
  });

  describe('Listing & Filtering', () => {
    beforeEach(async () => {
      await auditRepo.append({
        action: 'USER_ROLE_CHANGED',
        userId: adminUser.id,
        targetUserId: respondentUser.id,
        outcome: 'SUCCESS',
        metadata: { role: 'ADMIN' },
      });

      await auditRepo.append({
        action: 'LOGIN_FAILURE',
        userId: null,
        targetUserId: null,
        outcome: 'FAILURE',
        errorCode: 'INVALID_CREDENTIALS',
      });
    });

    it('should list audit logs with pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs?page=1&limit=10')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.pagination).toBeDefined();
      expect(res.body.data.pagination.page).toBe(1);
      expect(res.body.data.pagination.limit).toBe(10);
    });

    it('should filter audit logs by action', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs?action=USER_ROLE_CHANGED')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(
        res.body.data.items.every((i: any) => i.action === 'USER_ROLE_CHANGED'),
      ).toBe(true);
    });

    it('should filter audit logs by outcome', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs?outcome=FAILURE')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(
        res.body.data.items.every((i: any) => i.outcome === 'FAILURE'),
      ).toBe(true);
    });

    it('should filter audit logs by userId and targetUserId', async () => {
      const res = await request(app.getHttpServer())
        .get(
          `/admin/audit-logs?userId=${adminUser.id}&targetUserId=${respondentUser.id}`,
        )
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data.items[0].userId).toBe(adminUser.id);
      expect(res.body.data.items[0].targetUserId).toBe(respondentUser.id);
    });

    it('should filter audit logs by startDate and endDate', async () => {
      const past = new Date(Date.now() - 3600000).toISOString();
      const future = new Date(Date.now() + 3600000).toISOString();

      const res = await request(app.getHttpServer())
        .get(`/admin/audit-logs?startDate=${past}&endDate=${future}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 400 VALIDATION_ERROR when startDate is after endDate', async () => {
      const start = new Date(Date.now() + 3600000).toISOString();
      const end = new Date(Date.now() - 3600000).toISOString();

      const res = await request(app.getHttpServer())
        .get(`/admin/audit-logs?startDate=${start}&endDate=${end}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('End-to-End Admin Action Audit Trail (AC7.3)', () => {
    it('should automatically record audit trail when admin modifies user status', async () => {
      const targetUser = await userRepo.create({
        email: 'target-to-lock@example.com',
        passwordHash: 'hashed_pw',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      // Admin updates user status to LOCKED
      const patchRes = await request(app.getHttpServer())
        .patch(`/admin/users/${targetUser.id}/status`)
        .set('Cookie', adminCookies)
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', adminCsrfToken)
        .send({ status: 'LOCKED' });

      expect(patchRes.status).toBe(200);

      // Query audit logs to verify immutable trail created
      const auditRes = await request(app.getHttpServer())
        .get(
          `/admin/audit-logs?action=USER_STATUS_CHANGED&targetUserId=${targetUser.id}`,
        )
        .set('Cookie', adminCookies);

      expect(auditRes.status).toBe(200);
      expect(auditRes.body.data.items.length).toBe(1);

      const log = auditRes.body.data.items[0];
      expect(log.action).toBe('USER_STATUS_CHANGED');
      expect(log.userId).toBe(adminUser.id);
      expect(log.targetUserId).toBe(targetUser.id);
      expect(log.outcome).toBe('SUCCESS');
      expect(log.metadata).toMatchObject({
        previousStatus: 'ACTIVE',
        newStatus: 'LOCKED',
      });
    });
  });

  describe('Single Record Retrieval', () => {
    it('should retrieve a single audit log by ID', async () => {
      const created = await auditRepo.append({
        action: 'TEST_SINGLE_FETCH',
        userId: adminUser.id,
        outcome: 'SUCCESS',
      });

      const res = await request(app.getHttpServer())
        .get(`/admin/audit-logs/${created.id}`)
        .set('Cookie', adminCookies);

      expect(res.status).toBe(200);
      expect(res.body.data.auditLog.id).toBe(created.id);
      expect(res.body.data.auditLog.action).toBe('TEST_SINGLE_FETCH');
    });

    it('should return 404 AUDIT_LOG_NOT_FOUND when ID does not exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/audit-logs/00000000-0000-0000-0000-000000000000')
        .set('Cookie', adminCookies);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('AUDIT_LOG_NOT_FOUND');
    });
  });

  describe('Repository Immutability Contract (AC1.1 & AC7.2)', () => {
    it('audit repository must not expose update or delete methods', () => {
      expect((auditRepo as any).update).toBeUndefined();
      expect((auditRepo as any).delete).toBeUndefined();
    });
  });
});
