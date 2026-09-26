import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  moderationQueueListSchema,
  moderationSurveyPreviewSchema,
  surveyModerationResultSchema,
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
import { ADMIN_CAPABILITY_PORT } from '../src/modules/economy/application/ports/admin-capability.port';
import {
  CapabilitySourceUser,
  InMemoryAdminCapabilityRepository,
} from '../src/modules/economy/infrastructure/in-memory-admin-capability.repository';
import { SURVEY_MODERATION_REPOSITORY_PORT } from '../src/modules/moderation/application/ports/survey-moderation-repository.port';
import { InMemorySurveyModerationRepository } from '../src/modules/moderation/infrastructure/in-memory-survey-moderation.repository';
import { NOTIFICATION_REPOSITORY_PORT } from '../src/modules/notifications/application/ports/notification-repository.port';
import { InMemoryNotificationRepository } from '../src/modules/notifications/infrastructure/in-memory-notification.repository';
import { DEMOGRAPHIC_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/demographic-profile.repository.port';
import { InMemoryDemographicProfileRepository } from '../src/modules/users/infrastructure/in-memory-demographic-profile.repository';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';
import { SURVEY_RESPONSE_REPOSITORY_PORT } from '../src/modules/marketplace/application/ports/survey-response.repository.port';
import { InMemorySurveyResponseRepository } from '../src/modules/marketplace/infrastructure/in-memory-survey-response.repository';
import { PARTICIPATION_REPOSITORY_PORT } from '../src/modules/participation/application/ports/participation-repository.port';
import { InMemoryParticipationRepository } from '../src/modules/participation/infrastructure/in-memory-participation.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import { UserRole } from '../src/modules/users/domain/user.entity';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';

interface Actor {
  id: string;
  cookie: string;
  csrf: string;
}

describe('Story 8.1: Survey Moderation Queue (e2e)', () => {
  let app: INestApplication;
  let userRepo: InMemoryUserRepository;
  let formRepo: InMemoryFormRepository;
  let decisionRepo: InMemorySurveyModerationRepository;
  let notificationRepo: InMemoryNotificationRepository;
  let sessionService: SessionService;
  let ledgerService: LedgerService;
  /** Simulates an Identity change committed after the session was validated. */
  const capabilityOverrides = new Map<string, CapabilitySourceUser>();

  const TEST_JWT_SECRET = 'at_least_32_characters_super_secure_jwt_secret_key!';
  const ALLOWED_ORIGIN = 'http://localhost:3000';

  let publisher: Actor;
  let admin: Actor;
  let otherAdmin: Actor;
  let respondent: Actor;
  let seed = 0;
  const demographicRepo = new InMemoryDemographicProfileRepository();

  async function createActor(
    email: string,
    role: UserRole,
    points = 0,
  ): Promise<Actor> {
    const user = await userRepo.create({
      email,
      passwordHash: null,
      role,
      status: 'ACTIVE',
    });
    if (points > 0) {
      const system = await ledgerService.getOrCreateAccount(
        null,
        'SYSTEM_ISSUANCE',
      );
      const available = await ledgerService.getOrCreateAccount(
        user.id,
        'USER_AVAILABLE',
      );
      await ledgerService.transfer({
        fromAccountId: system.id,
        toAccountId: available.id,
        amount: points,
        idempotencyKey: `seed-moderation-${user.id}`,
      });
    }
    const tokens = await sessionService.createSession(user.id);
    return {
      id: user.id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function mutate(actor: Actor, method: 'post' | 'patch', path: string) {
    return request(app.getHttpServer())
      [method](path)
      .set('Cookie', actor.cookie)
      .set('x-csrf-token', actor.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json');
  }

  function get(actor: Actor, path: string) {
    return request(app.getHttpServer()).get(path).set('Cookie', actor.cookie);
  }

  async function publishSurvey(
    owner: Actor = publisher,
    title = `Khảo sát ${++seed}`,
  ): Promise<{ formId: string; formVersionId: string }> {
    const draft = await mutate(owner, 'post', '/forms')
      .send({
        title,
        type: 'INTERNAL',
        rewardPerResponse: 10, // 8 effective
        estimatedDurationMinutes: 8, // FR-14 band 10–20 (E6-D2)
        expectedCompletions: 50, // 400 escrow
        schema: {
          schemaVersion: 1,
          title,
          blocks: [
            {
              id: 'q-1',
              type: 'text',
              order: 0,
              title: 'Bạn học ngành gì?',
              required: true,
            },
          ],
        },
      })
      .expect(201);
    const published = await mutate(
      owner,
      'post',
      `/forms/${draft.body.data.id}/publish`,
    )
      .send({})
      .expect(200);
    expect(published.body.data.status).toBe('MODERATION_QUEUE');
    return {
      formId: draft.body.data.id,
      formVersionId: published.body.data.currentVersion.id,
    };
  }

  const approve = (actor: Actor, formId: string, body: object) =>
    mutate(actor, 'post', `/admin/moderation/surveys/${formId}/approve`).send(
      body,
    );
  const reject = (actor: Actor, formId: string, body: object) =>
    mutate(actor, 'post', `/admin/moderation/surveys/${formId}/reject`).send(
      body,
    );

  async function walletOf(userId: string) {
    return (await ledgerService.getWallet(userId)).balance;
  }

  async function notificationsOf(userId: string) {
    return notificationRepo.listForUser(userId, {
      limit: 50,
      offset: 0,
      unreadOnly: false,
    });
  }

  async function startAttempt(formId: string) {
    return mutate(respondent, 'post', `/forms/${formId}/attempts`).send({
      clientContext: { device: 'desktop' },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ||
      'postgresql://postgres:postgres@localhost:5433/rescom_test';

    userRepo = new InMemoryUserRepository();
    const auditRepo = new InMemoryIdentityAuditRepository();
    const sessionRepo = new InMemorySessionRepository(auditRepo);
    formRepo = new InMemoryFormRepository();
    decisionRepo = new InMemorySurveyModerationRepository();
    notificationRepo = new InMemoryNotificationRepository();
    const capabilityRepo = new InMemoryAdminCapabilityRepository(
      async (userId) =>
        capabilityOverrides.get(userId) ?? (await userRepo.findById(userId)),
    );

    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: TEST_JWT_SECRET,
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
      .useValue(sessionRepo)
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(FORM_REPOSITORY_PORT)
      .useValue(formRepo)
      .overrideProvider(LEDGER_REPOSITORY_PORT)
      .useValue(new InMemoryLedgerRepository())
      .overrideProvider(ADMIN_CAPABILITY_PORT)
      .useValue(capabilityRepo)
      .overrideProvider(SURVEY_MODERATION_REPOSITORY_PORT)
      .useValue(decisionRepo)
      .overrideProvider(NOTIFICATION_REPOSITORY_PORT)
      .useValue(notificationRepo)
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(demographicRepo)
      .overrideProvider(SURVEY_RESPONSE_REPOSITORY_PORT)
      .useValue(new InMemorySurveyResponseRepository({ forms: formRepo }))
      .overrideProvider(PARTICIPATION_REPOSITORY_PORT)
      .useValue(new InMemoryParticipationRepository())
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService);

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors({
      origin: (origin, callback) => {
        callback(null, !origin || envService.frontendOrigins.includes(origin));
      },
      credentials: true,
    });
    await app.init();

    publisher = await createActor(
      'publisher@fpt.edu.vn',
      'RESPONDENT',
      100_000,
    );
    admin = await createActor('admin@rescom.test', 'ADMIN', 100_000);
    otherAdmin = await createActor('admin2@rescom.test', 'ADMIN');
    respondent = await createActor('respondent@fpt.edu.vn', 'RESPONDENT');
    // Story 7.1: the respondent completed the mandatory demographic survey.
    await seedCompleteDemographicProfile(demographicRepo, respondent.id);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    capabilityOverrides.clear();
  });

  describe('AC: a published survey appears in the Admin Moderation Dashboard (FR-20)', () => {
    it('queues the survey, hides it from the Marketplace and blocks participation', async () => {
      const { formId, formVersionId } = await publishSurvey(
        publisher,
        'Khảo sát chờ duyệt',
      );

      const queue = await get(admin, '/admin/moderation/surveys').expect(200);
      const parsedQueue = moderationQueueListSchema.parse(queue.body.data);
      const item = parsedQueue.items.find((i) => i.formId === formId);
      expect(item).toMatchObject({
        formVersionId,
        title: 'Khảo sát chờ duyệt',
        status: 'MODERATION_QUEUE',
        publisherId: publisher.id,
        publisherEmail: 'publisher@fpt.edu.vn',
        escrowAmount: 400,
        effectiveRewardPerResponse: 8,
        blocksCount: 1,
        isResubmission: false,
      });

      // `api/` prefix is registered too.
      await get(admin, '/api/admin/moderation/surveys?limit=1').expect(200);

      const preview = await get(
        admin,
        `/admin/moderation/surveys/${formId}`,
      ).expect(200);
      const parsedPreview = moderationSurveyPreviewSchema.parse(
        preview.body.data,
      );
      expect(parsedPreview.decision).toBeNull();
      expect(
        (parsedPreview.schemaJson as { blocks: unknown[] }).blocks,
      ).toHaveLength(1);

      const feed = await get(respondent, '/marketplace/feed').expect(200);
      expect(
        feed.body.data.surveys.map((s: { id: string }) => s.id),
      ).not.toContain(formId);

      const attempt = await startAttempt(formId);
      expect(attempt.status).toBe(404);
      expect(attempt.body.error.code).toBe('SURVEY_NOT_AVAILABLE');

      const publicForm = await request(app.getHttpServer()).get(
        `/public/forms/${formId}`,
      );
      expect(publicForm.status).toBe(404);
      expect(publicForm.body.error.code).toBe('FORM_NOT_FOUND');
    });

    it('queues auto-published external surveys with their escrow reserved', async () => {
      const before = await walletOf(publisher.id);
      const created = await mutate(publisher, 'post', '/forms/external')
        .send({
          title: 'Google Form tự động gửi duyệt',
          externalUrl: 'https://forms.gle/moderation',
          rewardPerResponse: 10,
          estimatedDurationMinutes: 8,
          expectedCompletions: 10,
          autoPublish: true,
        })
        .expect(201);

      expect(created.body.data.status).toBe('MODERATION_QUEUE');
      expect(created.body.data.currentVersion.isPublished).toBe(false);
      const after = await walletOf(publisher.id);
      expect(after.escrow - before.escrow).toBe(100);

      const preview = await get(
        admin,
        `/admin/moderation/surveys/${created.body.data.id}`,
      ).expect(200);
      expect(preview.body.data).toMatchObject({
        type: 'EXTERNAL',
        externalUrl: 'https://forms.gle/moderation',
        escrowAmount: 100,
      });
    });
  });

  describe('AC: Approve moves the survey to PUBLISHED', () => {
    it('publishes, records the audit event, notifies the publisher and is idempotent', async () => {
      const { formId, formVersionId } = await publishSurvey();
      const correlationId = 'c0ffee00-0000-4000-8000-000000000001';

      const res = await approve(admin, formId, { formVersionId })
        .set('X-Correlation-Id', correlationId)
        .expect(200);
      const result = surveyModerationResultSchema.parse(res.body.data);
      expect(result).toMatchObject({
        replayed: false,
        form: {
          id: formId,
          status: 'PUBLISHED',
          currentVersionId: formVersionId,
          isPublished: true,
        },
        decision: {
          outcome: 'APPROVED',
          adminId: admin.id,
          refundAmount: 0,
          correlationId,
        },
      });
      expect(result.form.publishedAt).not.toBeNull();

      // Live on the Marketplace and startable.
      const feed = await get(respondent, '/marketplace/feed').expect(200);
      expect(feed.body.data.surveys.map((s: { id: string }) => s.id)).toContain(
        formId,
      );
      const attempt = await startAttempt(formId);
      expect(attempt.status).toBe(201);

      // Left the queue.
      const queue = await get(admin, '/admin/moderation/surveys').expect(200);
      expect(
        queue.body.data.items.map((i: { formId: string }) => i.formId),
      ).not.toContain(formId);

      // Audit event + notification.
      expect(
        decisionRepo.outboxEvents.find(
          (e) => e.idempotencyKey === `admin-audit:moderation:${formVersionId}`,
        ),
      ).toMatchObject({
        eventType: 'AdminSurveyApproved',
        aggregateId: formId,
        correlationId,
      });
      const approvedNotifications = (await notificationsOf(publisher.id))
        .filter((n) => n.type === 'SURVEY_APPROVED')
        .filter((n) => n.dedupeKey === `moderation:${formVersionId}`);
      expect(approvedNotifications).toHaveLength(1);

      // Replay: same result, no duplicate side effects.
      const replay = await approve(otherAdmin, formId, {
        formVersionId,
      }).expect(200);
      expect(replay.body.data.replayed).toBe(true);
      expect(replay.body.data.decision.id).toBe(result.decision.id);
      expect(
        (await notificationsOf(publisher.id)).filter(
          (n) => n.dedupeKey === `moderation:${formVersionId}`,
        ),
      ).toHaveLength(1);

      // The opposite decision is refused.
      const conflicting = await reject(admin, formId, {
        formVersionId,
        reason: 'Đổi ý sau khi duyệt',
      }).expect(409);
      expect(conflicting.body.error.code).toBe('MODERATION_ALREADY_DECIDED');

      // Preview shows the decision.
      const preview = await get(
        admin,
        `/admin/moderation/surveys/${formId}`,
      ).expect(200);
      expect(preview.body.data.decision.outcome).toBe('APPROVED');
    });
  });

  describe('AC: Reject moves the survey to CLOSED and refunds the points', () => {
    it('closes the survey, refunds the escrow atomically and notifies with the reason', async () => {
      const before = await walletOf(publisher.id);
      const { formId, formVersionId } = await publishSurvey();
      const queued = await walletOf(publisher.id);
      expect(queued.escrow - before.escrow).toBe(400);

      const res = await reject(admin, formId, {
        formVersionId,
        reason: 'Khảo sát chứa liên kết quảng cáo',
      }).expect(200);
      const result = surveyModerationResultSchema.parse(res.body.data);
      expect(result.form).toMatchObject({
        status: 'CLOSED',
        isPublished: false,
      });
      expect(result.decision).toMatchObject({
        outcome: 'REJECTED',
        reason: 'Khảo sát chứa liên kết quảng cáo',
        refundAmount: 400,
      });
      expect(result.decision.refundJournalId).not.toBeNull();

      const after = await walletOf(publisher.id);
      expect(after.escrow).toBe(before.escrow);
      expect(after.available).toBe(before.available);
      const journal = await ledgerService.findJournalByIdempotencyKey(
        `close-refund:${formId}:c1`,
      );
      expect(journal?.id).toBe(result.decision.refundJournalId);

      const rejected = (await notificationsOf(publisher.id)).find(
        (n) => n.dedupeKey === `moderation:${formVersionId}`,
      );
      expect(rejected?.type).toBe('SURVEY_REJECTED');
      expect(rejected?.message).toContain('Khảo sát chứa liên kết quảng cáo');
      expect(rejected?.message).toContain('400');

      expect(
        decisionRepo.outboxEvents.find(
          (e) => e.idempotencyKey === `admin-audit:moderation:${formVersionId}`,
        )?.payload,
      ).toMatchObject({
        action: 'SURVEY_REJECTED',
        refundAmount: 400,
        ledgerIdempotencyKey: `close-refund:${formId}:c1`,
      });

      // Replay refunds nothing more; approval afterwards is refused.
      const replay = await reject(admin, formId, {
        formVersionId,
        reason: 'Khảo sát chứa liên kết quảng cáo',
      }).expect(200);
      expect(replay.body.data.replayed).toBe(true);
      expect((await walletOf(publisher.id)).available).toBe(after.available);
      const approveAfter = await approve(admin, formId, {
        formVersionId,
      }).expect(409);
      expect(approveAfter.body.error.code).toBe('MODERATION_ALREADY_DECIDED');

      // A rejected survey can never be put live by reopening it.
      const reopen = await mutate(publisher, 'post', `/forms/${formId}/reopen`)
        .send({ additionalCompletions: 5 })
        .expect(409);
      expect(reopen.body.error.code).toBe('FORM_NOT_REOPENABLE');
      // Decision E8-D1: a moderation rejection is final.
      expect(reopen.body.error.details).toEqual({
        reason: 'CLOSED_BY_ADMIN_OR_MODERATION',
        closeKind: 'MODERATION',
      });
      const feed = await get(respondent, '/marketplace/feed').expect(200);
      expect(
        feed.body.data.surveys.map((s: { id: string }) => s.id),
      ).not.toContain(formId);
    });
  });

  describe('Decision E8-D1: Admin takedowns are final', () => {
    async function liveSurvey() {
      const { formId, formVersionId } = await publishSurvey();
      await approve(admin, formId, { formVersionId }).expect(200);
      return formId;
    }

    it("refuses the owner's reopen after an Admin took the survey down", async () => {
      const formId = await liveSurvey();

      const takedown = await mutate(admin, 'post', `/forms/${formId}/close`)
        .send({})
        .expect(200);
      expect(takedown.body.data).toMatchObject({
        status: 'CLOSED',
        closeKind: 'ADMIN',
      });
      const before = await walletOf(publisher.id);

      const reopen = await mutate(publisher, 'post', `/forms/${formId}/reopen`)
        .send({ additionalCompletions: 5 })
        .expect(409);
      expect(reopen.body.error.code).toBe('FORM_NOT_REOPENABLE');
      expect(reopen.body.error.details).toEqual({
        reason: 'CLOSED_BY_ADMIN_OR_MODERATION',
        closeKind: 'ADMIN',
      });
      expect(await walletOf(publisher.id)).toEqual(before);
      const feed = await get(respondent, '/marketplace/feed').expect(200);
      expect(
        feed.body.data.surveys.map((s: { id: string }) => s.id),
      ).not.toContain(formId);
    });

    it("still lets the owner reopen after the owner's own close", async () => {
      const formId = await liveSurvey();

      const closed = await mutate(publisher, 'post', `/forms/${formId}/close`)
        .send({})
        .expect(200);
      expect(closed.body.data.closeKind).toBe('OWNER');

      const reopened = await mutate(
        publisher,
        'post',
        `/forms/${formId}/reopen`,
      )
        .send({ additionalCompletions: 5 })
        .expect(200);
      expect(reopened.body.data.status).toBe('PUBLISHED');
    });
  });

  describe('Decision E8-D2: rejecting a re-submission of a live survey', () => {
    it('closes the survey for good and warns the Publisher in SURVEY_REJECTED', async () => {
      const { formId, formVersionId } = await publishSurvey();
      await approve(admin, formId, { formVersionId }).expect(200);
      await mutate(publisher, 'post', `/forms/${formId}/versions`)
        .send({})
        .expect(201);
      const v2 = await mutate(publisher, 'post', `/forms/${formId}/publish`)
        .send({})
        .expect(200);
      const v2Id = v2.body.data.currentVersion.id as string;

      const preview = await get(
        admin,
        `/admin/moderation/surveys/${formId}`,
      ).expect(200);
      expect(preview.body.data).toMatchObject({
        formVersionId: v2Id,
        versionNumber: 2,
        isResubmission: true,
      });

      await reject(admin, formId, {
        formVersionId: v2Id,
        reason: 'Phiên bản mới vi phạm quy định',
      }).expect(200);

      const notice = (await notificationsOf(publisher.id)).find(
        (n) => n.dedupeKey === `moderation:${v2Id}`,
      );
      expect(notice?.type).toBe('SURVEY_REJECTED');
      expect(notice?.message).toContain('(version 2)');
      expect(notice?.message).toContain(
        'the whole survey is now closed for good, including the previously approved version',
      );
      expect(notice?.message).toContain('Phiên bản mới vi phạm quy định');

      const reopen = await mutate(publisher, 'post', `/forms/${formId}/reopen`)
        .send({ additionalCompletions: 5 })
        .expect(409);
      expect(reopen.body.error.details.closeKind).toBe('MODERATION');
    });
  });

  describe('Guards, validation and conflicts', () => {
    it('requires an authenticated Admin session', async () => {
      await request(app.getHttpServer())
        .get('/admin/moderation/surveys')
        .expect(401);
      const forbidden = await get(publisher, '/admin/moderation/surveys');
      expect(forbidden.status).toBe(403);

      const { formId, formVersionId } = await publishSurvey();
      const notAdmin = await approve(publisher, formId, { formVersionId });
      expect(notAdmin.status).toBe(403);
      expect((await formRepo.findById(formId))?.form.status).toBe(
        'MODERATION_QUEUE',
      );
    });

    it('requires the CSRF token on decisions', async () => {
      const { formId, formVersionId } = await publishSurvey();
      const res = await request(app.getHttpServer())
        .post(`/admin/moderation/surveys/${formId}/approve`)
        .set('Cookie', admin.cookie)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send({ formVersionId });
      expect(res.status).toBe(403);
      expect((await formRepo.findById(formId))?.form.status).toBe(
        'MODERATION_QUEUE',
      );
    });

    it('validates bodies and ids', async () => {
      const { formId, formVersionId } = await publishSurvey();
      expect((await approve(admin, formId, {})).status).toBe(400);
      const shortReason = await reject(admin, formId, {
        formVersionId,
        reason: 'no',
      });
      expect(shortReason.status).toBe(400);
      expect(
        (await approve(admin, 'not-a-uuid', { formVersionId })).status,
      ).toBe(400);
      const unknown = await get(
        admin,
        '/admin/moderation/surveys/00000000-0000-4000-8000-000000000000',
      );
      expect(unknown.status).toBe(404);
      expect(unknown.body.error.code).toBe('FORM_NOT_FOUND');
    });

    it('refuses a decision on a version other than the one previewed', async () => {
      const { formId } = await publishSurvey();
      const res = await approve(admin, formId, {
        formVersionId: '00000000-0000-4000-8000-000000000001',
      }).expect(409);
      expect(res.body.error.code).toBe('MODERATION_VERSION_MISMATCH');
    });

    it('refuses a completion-code rotation while queued (409 FORM_IN_MODERATION), so the pending decision still applies (Bug 3.4)', async () => {
      const created = await mutate(publisher, 'post', '/forms/external')
        .send({
          title: 'Google Form chờ duyệt',
          externalUrl: 'https://forms.gle/queued-rotation',
          rewardPerResponse: 10,
          estimatedDurationMinutes: 8,
          expectedCompletions: 10,
          autoPublish: true,
        })
        .expect(201);
      const formId = created.body.data.id as string;
      const formVersionId = created.body.data.currentVersion.id as string;

      const rotation = await mutate(
        publisher,
        'post',
        `/forms/${formId}/rotate-code`,
      )
        .send({})
        .expect(409);
      expect(rotation.body.error.code).toBe('FORM_IN_MODERATION');

      const approved = await approve(admin, formId, { formVersionId }).expect(
        200,
      );
      expect(approved.body.data.form.status).toBe('PUBLISHED');

      // Once live, the code can be rotated again.
      const liveRotation = await mutate(
        publisher,
        'post',
        `/forms/${formId}/rotate-code`,
      )
        .send({})
        .expect(200);
      expect(liveRotation.body.data.status).toBe('PUBLISHED');
    });

    it('forbids moderating your own survey', async () => {
      const { formId, formVersionId } = await publishSurvey(admin);
      const res = await approve(admin, formId, { formVersionId }).expect(403);
      expect(res.body.error.code).toBe('MODERATION_SELF_REVIEW_FORBIDDEN');
    });

    it('re-verifies the live Admin capability (demoted after login)', async () => {
      const { formId, formVersionId } = await publishSurvey();
      capabilityOverrides.set(admin.id, {
        id: admin.id,
        role: 'RESPONDENT',
        status: 'ACTIVE',
      });

      const res = await reject(admin, formId, {
        formVersionId,
        reason: 'Không còn quyền quản trị',
      }).expect(403);

      expect(res.body.error.code).toBe('MODERATION_ADMIN_CAPABILITY_REQUIRED');
      expect((await formRepo.findById(formId))?.form.status).toBe(
        'MODERATION_QUEUE',
      );
    });

    it('keeps a queued survey out of the generic Admin close: moderation reject only (review P1)', async () => {
      const { formId, formVersionId } = await publishSurvey();
      const escrowBefore = (await walletOf(publisher.id)).escrow;

      const close = await mutate(admin, 'post', `/forms/${formId}/close`)
        .send({})
        .expect(409);
      expect(close.body.error.code).toBe('FORM_MODERATION_REQUIRED');
      const stored = await formRepo.findById(formId);
      expect(stored?.form.status).toBe('MODERATION_QUEUE');
      expect(stored?.form.closeCount).toBe(0);
      expect((await walletOf(publisher.id)).escrow).toBe(escrowBefore);
      expect(
        await ledgerService.findJournalByIdempotencyKey(
          `close-refund:${formId}:c1`,
        ),
      ).toBeNull();

      // The moderation reject endpoint records the decision and the audit event.
      const rejected = await reject(admin, formId, {
        formVersionId,
        reason: 'Gỡ khỏi hàng chờ qua kiểm duyệt',
      }).expect(200);
      expect(rejected.body.data.decision.outcome).toBe('REJECTED');
      expect(
        decisionRepo.outboxEvents.some(
          (e) => e.idempotencyKey === `admin-audit:moderation:${formVersionId}`,
        ),
      ).toBe(true);
    });

    it('refuses to queue or approve an unfunded legacy survey (review P2)', async () => {
      const now = new Date();
      const seedRow = async (
        formId: string,
        versionId: string,
        status: 'ESCROW_LOCKED' | 'MODERATION_QUEUE',
      ) => {
        const form = new FormEntity(
          formId,
          publisher.id,
          'INTERNAL',
          status,
          `Legacy ${status}`,
          null,
          10,
          50, // needs 400
          now,
          now,
        );
        await formRepo.create(
          form,
          new FormVersionEntity(
            versionId,
            formId,
            1,
            {
              schemaVersion: 1,
              title: form.title,
              blocks: [
                {
                  id: 'q-1',
                  type: 'text',
                  order: 0,
                  title: 'Câu hỏi',
                  required: true,
                },
              ],
            } as never,
            null,
            false,
            null,
            null,
            null,
            now,
          ),
        );
      };
      const legacyId = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
      await seedRow(
        legacyId,
        '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b',
        'ESCROW_LOCKED',
      );
      const status = await mutate(admin, 'post', `/forms/${legacyId}/status`)
        .send({ targetStatus: 'MODERATION_QUEUE' })
        .expect(409);
      expect(status.body.error).toMatchObject({
        code: 'MODERATION_ESCROW_NOT_FUNDED',
        details: { shortfall: 400 },
      });
      expect((await formRepo.findById(legacyId))?.form.status).toBe(
        'ESCROW_LOCKED',
      );

      const queuedId = '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c';
      const queuedVersionId = '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d';
      await seedRow(queuedId, queuedVersionId, 'MODERATION_QUEUE');
      const preview = await get(
        admin,
        `/admin/moderation/surveys/${queuedId}`,
      ).expect(200);
      expect(
        moderationSurveyPreviewSchema.parse(preview.body.data),
      ).toMatchObject({
        escrowAmount: 400,
        escrowHeld: 0,
        fundingShortfall: 400,
      });
      const refused = await approve(admin, queuedId, {
        formVersionId: queuedVersionId,
      }).expect(409);
      expect(refused.body.error.code).toBe('MODERATION_ESCROW_NOT_FUNDED');
      expect((await formRepo.findById(queuedId))?.form.status).toBe(
        'MODERATION_QUEUE',
      );
      expect(
        await decisionRepo.findByFormVersionId(queuedVersionId),
      ).toBeNull();

      // Rejecting it takes it out of the queue and refunds what it holds (0).
      const rejected = await reject(admin, queuedId, {
        formVersionId: queuedVersionId,
        reason: 'Khảo sát chưa được ký quỹ',
      }).expect(200);
      expect(rejected.body.data.decision.refundAmount).toBe(0);
    });

    it('answers an out-of-range queue offset with 400, never 500 (review P7)', async () => {
      const res = await get(admin, '/admin/moderation/surveys?offset=1e20');
      expect(res.status).toBe(400);
      const bounded = await get(
        admin,
        '/admin/moderation/surveys?offset=10000',
      ).expect(200);
      expect(bounded.body.data.items).toEqual([]);
    });

    it('lets exactly one of concurrent approve / reject requests win', async () => {
      const { formId, formVersionId } = await publishSurvey();

      const [approveRes, rejectRes] = await Promise.all([
        approve(admin, formId, { formVersionId }),
        reject(otherAdmin, formId, {
          formVersionId,
          reason: 'Từ chối đồng thời',
        }),
      ]);

      const statuses = [approveRes.status, rejectRes.status].sort();
      expect(statuses).toEqual([200, 409]);
      const stored = await formRepo.findById(formId);
      expect(['PUBLISHED', 'CLOSED']).toContain(stored?.form.status);
    });
  });
});
