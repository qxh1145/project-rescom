import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  adminTopUpRequestListSchema,
  moderationQueueListSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { FORM_REPOSITORY_PORT } from '../src/modules/forms/application/ports/form-repository.port';
import { InMemoryFormRepository } from '../src/modules/forms/infrastructure/in-memory-form.repository';
import { LEDGER_REPOSITORY_PORT } from '../src/modules/economy/application/ports/ledger-repository.port';
import { InMemoryLedgerRepository } from '../src/modules/economy/infrastructure/in-memory-ledger.repository';
import { TOP_UP_REPOSITORY_PORT } from '../src/modules/economy/application/ports/top-up-repository.port';
import { InMemoryTopUpRepository } from '../src/modules/economy/infrastructure/in-memory-top-up.repository';
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import { InMemoryAdminCapabilityRepository } from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { SURVEY_MODERATION_REPOSITORY_PORT } from '../src/modules/moderation/application/ports/survey-moderation-repository.port';
import { InMemorySurveyModerationRepository } from '../src/modules/moderation/infrastructure/in-memory-survey-moderation.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { UserRole } from '../src/modules/users/domain/user.entity';

/**
 * Story IR.4 empty-state evidence (in-memory): a brand-new Publisher sees an
 * empty forms list, and an Admin with nothing to review sees empty top-up
 * and moderation queues, and a user without events has no notifications.
 * Empty results are 200 with an explicit empty list, never an error.
 */
describe('IR.4 empty states (e2e)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let sessionService: SessionService;
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  async function actor(email: string, role: UserRole) {
    const user = await userRepo.create({
      email,
      passwordHash: null,
      role,
      status: 'ACTIVE',
    });
    const tokens = await sessionService.createSession(user.id);
    return { cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}` };
  }

  const get = (path: string, who: { cookie: string }) =>
    request(app.getHttpServer()).get(path).set('Cookie', who.cookie);

  beforeAll(async () => {
    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
    });
    const mockPrisma: any = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(new InMemorySessionRepository(auditRepo))
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(new InMemoryFormRepository())
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(TOP_UP_REPOSITORY_PORT)
      .useValue(new InMemoryTopUpRepository())
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(
        new InMemoryAdminCapabilityRepository((id) => userRepo.findById(id)),
      )
      .overrideProvider(SURVEY_MODERATION_REPOSITORY_PORT)
      .useValue(new InMemorySurveyModerationRepository())
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(new InMemoryNotificationRepository())
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();
    sessionService = moduleFixture.get(SessionService);
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('a Publisher with no surveys gets an empty forms list', async () => {
    const publisher = await actor('empty-publisher@fpt.edu.vn', 'PUBLISHER');
    const res = await get('/forms', publisher).expect(200);
    expect(res.body.data.forms).toEqual([]);
    expect(res.body.data.total).toBe(0);
    expect(res.body.data.totalPages).toBe(1);
  });

  it('an Admin with no pending top-ups gets an empty queue', async () => {
    const admin = await actor('empty-admin@rescom.test', 'ADMIN');
    const res = await get('/admin/top-ups', admin).expect(200);
    const queue = adminTopUpRequestListSchema.parse(res.body.data);
    expect(queue.items).toEqual([]);
    expect(queue.total).toBe(0);
  });

  it('an Admin with no queued surveys gets an empty moderation queue', async () => {
    const admin = await actor('empty-admin2@rescom.test', 'ADMIN');
    const res = await get('/admin/moderation/surveys', admin).expect(200);
    expect(moderationQueueListSchema.parse(res.body.data).items).toEqual([]);
  });

  it('a user without events gets an empty notification list', async () => {
    const user = await actor('empty-notify@fpt.edu.vn', 'RESPONDENT');
    const res = await get('/notifications', user).expect(200);
    expect(res.body.data.items).toEqual([]);
  });
});
