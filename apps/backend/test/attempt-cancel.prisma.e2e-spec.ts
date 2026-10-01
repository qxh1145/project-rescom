import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  attemptNotInProgressDetailsSchema,
  cancelAttemptResponseSchema,
  surveyAttemptResponseSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EnvService } from '../src/common/config/env.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { USER_REPOSITORY_PORT } from '../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { DEMOGRAPHIC_PROFILE_REPOSITORY_PORT } from '../src/modules/users/application/ports/demographic-profile.repository.port';
import { InMemoryDemographicProfileRepository } from '../src/modules/users/infrastructure/in-memory-demographic-profile.repository';
import { SessionService } from '../src/modules/auth/application/session.service';
import { AUTH_COOKIE_NAME } from '../src/modules/auth/presentation/cookie-options.helper';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../src/modules/forms/application/ports/form-repository.port';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import { seedCompleteDemographicProfile } from './fixtures/demographic-profile.fixture';

/**
 * Story IR.2a (API-03, AC6) on PostgreSQL: `POST /attempts/:id/cancel` races
 * the Internal submit and the External completion-code verification with
 * the real Prisma repositories, Unit of Work, row locks (form `FOR SHARE`,
 * then attempt `FOR UPDATE`) and partial unique indexes. Exactly one side
 * wins every race; the loser gets its documented 409; the final rows are
 * consistent and a cancelled attempt never carries a reward journal. Also
 * proves (decision E8-D6) that a cancel releases the user's open-attempt
 * reservation on the real database.
 *
 * Applies pending migrations (`prisma migrate deploy`) to a dedicated
 * database whose name ends in `_test`. Every race uses a fresh Respondent.
 * Skipped when the database is unreachable; fails instead when
 * `PARTICIPATION_TEST_DATABASE_URL` is set explicitly.
 */
const explicitUrl = process.env.PARTICIPATION_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_participation_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'PARTICIPATION_TEST_DATABASE_URL must target a dedicated database ending in _test',
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

const RACES = 20;

describe('Cancel races on PostgreSQL (Story IR.2a)', () => {
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const COMPLETION_CODE = '482917';

  let app: INestApplication;
  let prisma: PrismaService;
  let userRepo: InMemoryUserRepository;
  let demoRepo: InMemoryDemographicProfileRepository;
  let sessionService: SessionService;
  let formRepository: FormRepositoryPort;
  let ledgerService: LedgerService;
  let completionCodes: CompletionCodeService;

  const publisherId = randomUUID();
  const internalFormId = randomUUID();
  const externalFormId = randomUUID();
  const externalVersionId = randomUUID();

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches PARTICIPATION_TEST_DATABASE_URL', () => {
        throw new Error(
          `PARTICIPATION_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live cancel race tests.`,
      );
    }
  }

  async function user(role: 'PUBLISHER' | 'RESPONDENT', id = randomUUID()) {
    const email = `ir2a-${role.toLowerCase()}-${id}@example.com`;
    await prisma.user.create({
      data: { id, email, passwordHash: 'hash', role },
    });
    await userRepo.create({
      id,
      email,
      passwordHash: '$2a$12$someHashedPassword',
      role,
      status: 'ACTIVE',
    });
    return id;
  }

  async function respondent(): Promise<Actor> {
    const id = await user('RESPONDENT');
    await seedCompleteDemographicProfile(demoRepo, id);
    const tokens = await sessionService.createSession(id);
    return {
      id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function post(path: string, who: Actor, body: object, key?: string) {
    const req = request(app.getHttpServer())
      .post(path)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json');
    return (key ? req.set('Idempotency-Key', key) : req).send(body);
  }

  /** Starts an attempt and moves its server start past the Time Barrier. */
  async function startPastBarrier(formId: string, who: Actor) {
    const res = await post(`/surveys/${formId}/attempts`, who, {});
    expect(res.status).toBe(201);
    const started = surveyAttemptResponseSchema.parse(res.body.data);
    await prisma.surveyAttempt.update({
      where: { id: started.attemptId },
      data: { startedAt: new Date(Date.now() - 10_000) },
    });
    return started;
  }

  function cancel(attemptId: string, who: Actor) {
    return post(
      `/attempts/${attemptId}/cancel`,
      who,
      {},
      `cancel-${randomUUID()}`,
    );
  }

  /**
   * The cancel does less work before its transaction than a submit or a
   * verification, so it is sent 0-40 ms late (by race number) to let both
   * sides win some races.
   */
  async function lateCancel(race: number, attemptId: string, who: Actor) {
    await new Promise((resolve) => setTimeout(resolve, (race % 5) * 10));
    return cancel(attemptId, who);
  }

  function form(id: string, type: 'INTERNAL' | 'EXTERNAL') {
    return new FormEntity(
      id,
      publisherId,
      type,
      'PUBLISHED',
      `IR.2a ${type} race survey`,
      null,
      10,
      500,
      new Date(),
      new Date(),
      undefined,
      0,
      5,
    );
  }

  function version(
    id: string,
    formId: string,
    type: 'INTERNAL' | 'EXTERNAL',
  ): FormVersionEntity {
    return new FormVersionEntity(
      id,
      formId,
      1,
      {
        schemaVersion: 1,
        title: 'IR.2a race survey',
        blocks:
          type === 'INTERNAL'
            ? [
                {
                  id: 'q1',
                  order: 0,
                  type: 'text',
                  title: 'Q1',
                  required: true,
                },
              ]
            : [],
        settings: {
          shuffleBlocks: false,
          progressBar: true,
          requireAuth: false,
          allowPublicAccess: true,
          submitButtonText: 'Submit',
        },
        metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 2 },
      } as any,
      null,
      true,
      type === 'EXTERNAL'
        ? 'https://docs.google.com/forms/d/e/ir2a-race/viewform'
        : null,
      type === 'EXTERNAL'
        ? completionCodes.computeVerifier(id, COMPLETION_CODE)
        : null,
      new Date(),
      new Date(),
    );
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

    const auditRepo = new InMemoryIdentityAuditRepository();
    userRepo = new InMemoryUserRepository();
    demoRepo = new InMemoryDemographicProfileRepository();
    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: databaseUrl,
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: ALLOWED_ORIGIN,
    });
    completionCodes = new CompletionCodeService(envService);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(USER_REPOSITORY_PORT)
      .useValue(userRepo)
      .overrideProvider(SESSION_REPOSITORY_PORT)
      .useValue(new InMemorySessionRepository(auditRepo))
      .overrideProvider(IDENTITY_AUDIT_PORT)
      .useValue(auditRepo)
      .overrideProvider(DEMOGRAPHIC_PROFILE_REPOSITORY_PORT)
      .useValue(demoRepo)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService, { strict: false });
    formRepository = moduleFixture.get<FormRepositoryPort>(
      FORM_REPOSITORY_PORT,
      { strict: false },
    );

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await user('PUBLISHER', publisherId);
    const issuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const escrow = await ledgerService.getOrCreateAccount(
      publisherId,
      'ESCROW',
    );
    await ledgerService.postJournal({
      idempotencyKey: `ir2a-race-escrow:${publisherId}`,
      entries: [
        { accountId: issuance.id, amount: -10_000 },
        { accountId: escrow.id, amount: 10_000 },
      ],
    });
    await formRepository.create(
      form(internalFormId, 'INTERNAL'),
      version(randomUUID(), internalFormId, 'INTERNAL'),
    );
    await formRepository.create(
      form(externalFormId, 'EXTERNAL'),
      version(externalVersionId, externalFormId, 'EXTERNAL'),
    );
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  liveIt(
    `cancel vs Internal submit: exactly one wins in ${RACES} races, rows stay consistent`,
    async () => {
      const winners = { cancel: 0, submit: 0 };
      for (let race = 0; race < RACES; race++) {
        const who = await respondent();
        const started = await startPastBarrier(internalFormId, who);

        const [cancelled, submitted] = await Promise.all([
          lateCancel(race, started.attemptId, who),
          post(`/responses/${started.responseId}/submit`, who, {
            attemptId: started.attemptId,
            answers: { q1: `race ${race}` },
          }),
        ]);

        expect(
          [cancelled.status, submitted.status].filter((s) => s === 200),
        ).toHaveLength(1);
        const attempt = await prisma.surveyAttempt.findUniqueOrThrow({
          where: { id: started.attemptId },
        });
        const response = await prisma.response.findUniqueOrThrow({
          where: { id: started.responseId! },
        });
        const reward = await prisma.ledgerJournal.findUnique({
          where: { idempotencyKey: `internal-reward:${started.responseId}` },
        });

        if (cancelled.status === 200) {
          winners.cancel++;
          cancelAttemptResponseSchema.parse(cancelled.body.data);
          expect(submitted.status).toBe(409);
          expect(submitted.body.error.code).toBe('ATTEMPT_EXPIRED');
          expect(attempt).toMatchObject({
            status: 'ABANDONED',
            closedReason: 'CANCELLED',
          });
          expect(response.status).toBe('IN_PROGRESS');
          expect(reward).toBeNull();
          // Decision E8-D6: the cancel released the open-attempt reservation.
          await expect(
            prisma.surveyAttempt.count({
              where: { respondentId: who.id, status: 'IN_PROGRESS' },
            }),
          ).resolves.toBe(0);
        } else {
          winners.submit++;
          expect(cancelled.status).toBe(409);
          expect(cancelled.body.error.code).toBe('ATTEMPT_NOT_IN_PROGRESS');
          expect(
            attemptNotInProgressDetailsSchema.parse(
              cancelled.body.error.details,
            ),
          ).toEqual({ status: 'COMPLETED', closedReason: null });
          expect(attempt).toMatchObject({
            status: 'COMPLETED',
            closedReason: null,
            closedAt: null,
          });
          expect(response.status).toBe('VALIDATED');
          expect(reward).not.toBeNull();
        }
      }
      expect(winners.cancel + winners.submit).toBe(RACES);
    },
    180_000,
  );

  liveIt(
    `cancel vs completion-code verification: exactly one wins in ${RACES} races, rows stay consistent`,
    async () => {
      const winners = { cancel: 0, verify: 0 };
      for (let race = 0; race < RACES; race++) {
        const who = await respondent();
        const started = await startPastBarrier(externalFormId, who);

        const [cancelled, verified] = await Promise.all([
          lateCancel(race, started.attemptId, who),
          post(`/attempts/${started.attemptId}/verify-code`, who, {
            completionCode: COMPLETION_CODE,
          }),
        ]);

        expect(
          [cancelled.status, verified.status].filter((s) => s === 200),
        ).toHaveLength(1);
        const attempt = await prisma.surveyAttempt.findUniqueOrThrow({
          where: { id: started.attemptId },
        });
        const credit = await prisma.ledgerJournal.findUnique({
          where: { idempotencyKey: `external-completion:${started.attemptId}` },
        });

        if (cancelled.status === 200) {
          winners.cancel++;
          expect(verified.status).toBe(409);
          expect(verified.body.error.code).toBe('ATTEMPT_EXPIRED');
          expect(attempt).toMatchObject({
            status: 'ABANDONED',
            closedReason: 'CANCELLED',
            failedCodeVerifications: 0,
          });
          expect(credit).toBeNull();
        } else {
          winners.verify++;
          expect(cancelled.status).toBe(409);
          expect(cancelled.body.error.code).toBe('ATTEMPT_NOT_IN_PROGRESS');
          expect(cancelled.body.error.details).toEqual({
            status: 'COMPLETED',
            closedReason: null,
          });
          expect(attempt).toMatchObject({
            status: 'COMPLETED',
            closedReason: null,
          });
          expect(credit).not.toBeNull();
        }
      }
      expect(winners.cancel + winners.verify).toBe(RACES);
    },
    180_000,
  );

  liveIt(
    'the lazy expiry inside a start writes closed reason EXPIRED',
    async () => {
      const who = await respondent();
      const stale = await startPastBarrier(externalFormId, who);
      await prisma.surveyAttempt.update({
        where: { id: stale.attemptId },
        data: { startedAt: new Date(Date.now() - 31 * 60 * 1000) },
      });

      const fresh = await post(`/surveys/${externalFormId}/attempts`, who, {});
      expect(fresh.status).toBe(201);

      const abandoned = await prisma.surveyAttempt.findUniqueOrThrow({
        where: { id: stale.attemptId },
      });
      expect(abandoned).toMatchObject({
        status: 'ABANDONED',
        closedReason: 'EXPIRED',
      });
      expect(abandoned.closedAt).toBeInstanceOf(Date);
    },
  );
});
