import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { USER_ADMIN_TRANSACTION_PORT } from '../src/modules/users/application/ports/user-admin-transaction.port';
import { InMemoryUserAdminTransactionAdapter } from '../src/modules/users/infrastructure/in-memory-user-admin-transaction.adapter';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { User } from '../src/modules/users/domain/user.entity';
import { UserAdminService } from '../src/modules/users/application/user-admin.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../src/modules/auth/presentation/cookie-options.helper';

describe('Admin Users & RBAC E2E Tests (Story 1.4)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let transactionAdapter: InMemoryUserAdminTransactionAdapter;
  let sessionService: SessionService;
  let envService: EnvService;

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    transactionAdapter = new InMemoryUserAdminTransactionAdapter(
      userRepo,
      sessionRepo,
      auditRepo,
    );

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
      .useValue(auditRepo)
      .overrideProvider(USER_ADMIN_TRANSACTION_PORT)
      .useValue(transactionAdapter)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || envService.frontendOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    });

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    userRepo.clear();
    sessionRepo.clear();
    auditRepo.clear();
  });

  async function createTestUserWithSession(
    email: string,
    role: 'ADMIN' | 'PUBLISHER' | 'RESPONDENT',
    status: 'ACTIVE' | 'LOCKED' = 'ACTIVE',
  ) {
    const user = await userRepo.create({
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role,
      status,
    });
    const tokens = await sessionService.createSession(user.id);
    return { user, tokens };
  }

  describe('AC1: Route-Level RBAC Guard & Authorization Protection', () => {
    it('should reject unauthenticated request with 401 AUTH_UNAUTHORIZED', async () => {
      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_UNAUTHORIZED');
    });

    it('should reject non-admin users (RESPONDENT) with 403 FORBIDDEN_RESOURCE without clearing cookies', async () => {
      const { tokens } = await createTestUserWithSession(
        'respondent@example.com',
        'RESPONDENT',
      );

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN_RESOURCE');
      expect(res.body.error.message).toBe(
        'Access denied: insufficient permissions.',
      );
      // RolesGuard must NOT clear auth cookies on 403
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('should reject non-admin users (PUBLISHER) with 403 FORBIDDEN_RESOURCE', async () => {
      const { tokens } = await createTestUserWithSession(
        'publisher@example.com',
        'PUBLISHER',
      );

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN_RESOURCE');
    });

    it('should grant access to ADMIN users with 200 OK', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin@example.com',
        'ADMIN',
      );

      const res = await request(app.getHttpServer())
        .get('/admin/users')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);

      expect(res.body.error).toBeNull();
      expect(res.body.data.items).toBeDefined();
    });

    it('protects detailed system metrics from unauthenticated and non-admin users', async () => {
      await request(app.getHttpServer()).get('/system/metrics').expect(401);

      const { tokens } = await createTestUserWithSession(
        'metrics-respondent@example.com',
        'RESPONDENT',
      );
      const response = await request(app.getHttpServer())
        .get('/system/metrics')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(403);

      expect(response.body.error.code).toBe('FORBIDDEN_RESOURCE');
    });
  });

  describe('AC2: Consistent Locked-Account Session Rejection', () => {
    it('should reject access token from locked user with 403 AUTH_USER_LOCKED even when session is revoked', async () => {
      const { user, tokens } = await createTestUserWithSession(
        'locked@example.com',
        'RESPONDENT',
        'ACTIVE',
      );

      // Lock user account and revoke session
      userRepo.save(
        new User({
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          role: user.role,
          status: 'LOCKED',
        }),
      );
      await sessionRepo.revokeAllByUserId(user.id);

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(403);

      expect(res.body.error.code).toBe('AUTH_USER_LOCKED');
      expect(res.headers['set-cookie']).toBeDefined(); // Clears cookies on locked error
    });

    it('should reject refresh token from locked user with 403 AUTH_USER_LOCKED', async () => {
      const { user, tokens } = await createTestUserWithSession(
        'locked-refresh@example.com',
        'RESPONDENT',
        'ACTIVE',
      );

      userRepo.save(
        new User({
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          role: user.role,
          status: 'LOCKED',
        }),
      );
      await sessionRepo.revokeAllByUserId(user.id);

      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', 'http://localhost:3000')
        .set('Cookie', [`${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .expect(403);

      expect(res.body.error.code).toBe('AUTH_USER_LOCKED');

      const csrfRes = await request(app.getHttpServer())
        .get('/auth/csrf')
        .set('Cookie', [`${REFRESH_COOKIE_NAME}=${tokens.refreshToken}`])
        .expect(403);

      expect(csrfRes.body.error.code).toBe('AUTH_USER_LOCKED');
      expect(csrfRes.headers['set-cookie']).toBeDefined();
    });

    it('should reject non-locked user with revoked session with 401 AUTH_SESSION_REVOKED', async () => {
      const { user, tokens } = await createTestUserWithSession(
        'active-revoked@example.com',
        'RESPONDENT',
        'ACTIVE',
      );

      await sessionRepo.revokeAllByUserId(user.id);

      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_SESSION_REVOKED');
    });
  });

  describe('AC4: Paginated User Listing, Search & Filtering', () => {
    it('should return paginated users without sensitive fields', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-list@example.com',
        'ADMIN',
      );
      await userRepo.create({
        email: 'user1@example.com',
        passwordHash: '$2a$12$secretHash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });
      await userRepo.create({
        email: 'user2@example.com',
        passwordHash: '$2a$12$secretHash',
        role: 'PUBLISHER',
        status: 'LOCKED',
      });

      const res = await request(app.getHttpServer())
        .get('/admin/users?page=1&limit=2')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);

      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });

      // Assert sensitive fields are NEVER leaked
      for (const item of res.body.data.items) {
        expect(item.passwordHash).toBeUndefined();
        expect(item.id).toBeDefined();
        expect(item.email).toBeDefined();
        expect(item.role).toBeDefined();
        expect(item.status).toBeDefined();
        expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });

    it('should filter users by search, role, and status', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-filter@example.com',
        'ADMIN',
      );
      await userRepo.create({
        email: 'alpha-publisher@domain.com',
        passwordHash: 'hash',
        role: 'PUBLISHER',
        status: 'ACTIVE',
      });
      await userRepo.create({
        email: 'beta-respondent@domain.com',
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const res = await request(app.getHttpServer())
        .get('/admin/users?search=alpha&role=PUBLISHER&status=ACTIVE')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].email).toBe('alpha-publisher@domain.com');
      expect(res.body.data.pagination.total).toBe(1);
    });

    it('should reject invalid query parameters with 400 VALIDATION_ERROR', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-query-err@example.com',
        'ADMIN',
      );

      const res = await request(app.getHttpServer())
        .get('/admin/users?page=-1')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('AC5: Single User Detail Retrieval & UUID Validation', () => {
    it('should reject non-UUID parameter with 400 VALIDATION_ERROR', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-uuid@example.com',
        'ADMIN',
      );

      const res = await request(app.getHttpServer())
        .get('/admin/users/not-a-valid-uuid')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Invalid UUID parameter');
    });

    it('should return 404 USER_NOT_FOUND when user does not exist', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-notfound@example.com',
        'ADMIN',
      );

      const res = await request(app.getHttpServer())
        .get('/admin/users/123e4567-e89b-12d3-a456-426614174000')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(404);

      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('should return 200 OK with sanitized user detail', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-detail@example.com',
        'ADMIN',
      );
      const target = await userRepo.create({
        email: 'target-user@example.com',
        passwordHash: 'secretPasswordHash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const res = await request(app.getHttpServer())
        .get(`/admin/users/${target.id}`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .expect(200);

      expect(res.body.error).toBeNull();
      expect(res.body.data.user.id).toBe(target.id);
      expect(res.body.data.user.email).toBe('target-user@example.com');
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });
  });

  describe('AC6: Account Locking/Unlocking & Atomic UoW', () => {
    it('rejects unsafe admin mutations without an allowed origin and valid CSRF token', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-csrf@example.com',
        'ADMIN',
      );
      const target = await userRepo.create({
        email: 'csrf-target@example.com',
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const missingOrigin = await request(app.getHttpServer())
        .patch(`/admin/users/${target.id}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('x-csrf-token', tokens.csrfToken)
        .send({ status: 'LOCKED' })
        .expect(403);
      expect(missingOrigin.body.error.code).toBe('AUTH_FORBIDDEN_ORIGIN');

      const missingToken = await request(app.getHttpServer())
        .patch(`/admin/users/${target.id}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('Origin', 'http://localhost:3000')
        .send({ status: 'LOCKED' })
        .expect(403);
      expect(missingToken.body.error.code).toBe('AUTH_INVALID_CSRF_TOKEN');
    });

    it('should reject admin self-locking with 400 CANNOT_LOCK_SELF', async () => {
      const { user: admin, tokens } = await createTestUserWithSession(
        'admin-selflock@example.com',
        'ADMIN',
      );

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${admin.id}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', tokens.csrfToken)
        .send({ status: 'LOCKED' })
        .expect(400);

      expect(res.body.error.code).toBe('CANNOT_LOCK_SELF');
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_LOCK_SELF',
        }),
      );
    });

    it('should treat identical status update as a no-op with 200 OK', async () => {
      const { tokens } = await createTestUserWithSession(
        'admin-noop@example.com',
        'ADMIN',
      );
      const target = await userRepo.create({
        email: 'noop-target@example.com',
        passwordHash: 'hash',
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${target.id}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', tokens.csrfToken)
        .send({ status: 'ACTIVE' })
        .expect(200);

      expect(res.body.data.user.status).toBe('ACTIVE');
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({ changed: false }),
        }),
      );
    });

    it('should lock normal user successfully, revoking active sessions', async () => {
      const { tokens: adminTokens } = await createTestUserWithSession(
        'admin-locknormal@example.com',
        'ADMIN',
      );
      const { user: target, tokens: targetTokens } =
        await createTestUserWithSession(
          'target-lock@example.com',
          'RESPONDENT',
          'ACTIVE',
        );

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${target.id}/status`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`])
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', adminTokens.csrfToken)
        .send({ status: 'LOCKED' })
        .expect(200);

      expect(res.body.data.user.status).toBe('LOCKED');
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({ changed: true }),
        }),
      );

      // Target user should now be rejected as locked (403)
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${targetTokens.accessToken}`])
        .expect(403);
    });

    it('should reject locking the last remaining active admin with 400 CANNOT_LOCK_LAST_ADMIN', async () => {
      const { user: soleAdmin } = await createTestUserWithSession(
        'sole-admin@example.com',
        'ADMIN',
      );

      // Create a hypothetical second caller attempting to lock soleAdmin
      const fakeAdminId = '00000000-0000-0000-0000-000000000099';

      await expect(
        transactionAdapter.run(async (ctx) => {
          const count = await ctx.lockActiveAdmins();
          expect(count).toBe(1);
        }),
      ).resolves.toBeUndefined();

      // Attempting to lock soleAdmin from our admin actor: but soleAdmin self-lock is rejected outside tx.
      // So let's test via UserAdminService directly for another actor:
      const adminService = app.get(UserAdminService);
      await expect(
        adminService.updateUserStatus(fakeAdminId, soleAdmin.id, 'LOCKED'),
      ).rejects.toThrow('Cannot lock the sole remaining active admin account.');
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_LOCK_LAST_ADMIN',
        }),
      );
    });
  });

  describe('AC7: Role Management & Atomic UoW', () => {
    it('should reject admin self-demotion with 400 CANNOT_DEMOTE_SELF', async () => {
      const { user: admin, tokens } = await createTestUserWithSession(
        'admin-selfdemote@example.com',
        'ADMIN',
      );

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${admin.id}/role`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${tokens.accessToken}`])
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', tokens.csrfToken)
        .send({ role: 'RESPONDENT' })
        .expect(400);

      expect(res.body.error.code).toBe('CANNOT_DEMOTE_SELF');
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_DEMOTE_SELF',
        }),
      );
    });

    it('should promote normal user to PUBLISHER and revoke sessions for fresh claims', async () => {
      const { tokens: adminTokens } = await createTestUserWithSession(
        'admin-promote@example.com',
        'ADMIN',
      );
      const { user: target, tokens: targetTokens } =
        await createTestUserWithSession(
          'target-promote@example.com',
          'RESPONDENT',
          'ACTIVE',
        );

      const res = await request(app.getHttpServer())
        .patch(`/admin/users/${target.id}/role`)
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${adminTokens.accessToken}`])
        .set('Origin', 'http://localhost:3000')
        .set('x-csrf-token', adminTokens.csrfToken)
        .send({ role: 'PUBLISHER' })
        .expect(200);

      expect(res.body.data.user.role).toBe('PUBLISHER');
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({ changed: true }),
        }),
      );

      // Previous session should be revoked, requiring re-login for updated role claims
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', [`${AUTH_COOKIE_NAME}=${targetTokens.accessToken}`])
        .expect(401);
    });

    it('should reject demoting the last remaining active admin with 400 CANNOT_DEMOTE_LAST_ADMIN', async () => {
      const { user: soleAdmin } = await createTestUserWithSession(
        'sole-admin-demote@example.com',
        'ADMIN',
      );

      const fakeAdminId = '00000000-0000-0000-0000-000000000099';
      const adminService = app.get(UserAdminService);

      await expect(
        adminService.updateUserRole(fakeAdminId, soleAdmin.id, 'RESPONDENT'),
      ).rejects.toThrow('Cannot demote the sole remaining admin account.');
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_DEMOTE_LAST_ADMIN',
        }),
      );
    });
  });
});
