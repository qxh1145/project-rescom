import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import {
  attemptOutcomeSchema,
  conflictingActiveAttemptDetailsSchema,
  surveyAttemptResponseSchema,
} from '@rescom/schemas';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/database/prisma.service';
import { EnvService } from '../src/common/config/env.service';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import {
  DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
  DemographicProfileRepositoryPort,
} from '../src/modules/users/application/ports/demographic-profile.repository.port';
import { SessionService } from '../src/modules/auth/application/session.service';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from '../src/modules/auth/presentation/cookie-options.helper';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../src/modules/forms/application/ports/form-repository.port';
import { FormEntity } from '../src/modules/forms/domain/form.entity';
import { FormVersionEntity } from '../src/modules/forms/domain/form-version.entity';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import { LedgerService } from '../src/modules/economy/application/ledger.service';
import {
  COMPLETE_DEMOGRAPHIC_PROFILE,
  seedCompleteDemographicProfile,
} from './fixtures/demographic-profile.fixture';
import {
  BALANCED_LEDGER,
  ledgerInvariants,
} from './fixtures/ledger-invariants';

/**
 * Story IR.3 on PostgreSQL with NO domain mocks: the real Prisma user,
 * session, demographic, form, participation, ledger, notification and outbox
 * repositories, the Unit of Work and the row locks. Covers the happy chain
 * (register/login -> demographics -> feed -> summary -> start -> pinned read
 * -> submit -> outcome/wallet), start concurrency, resume on the pinned
 * version, duplicate submits, expiry and the External replay.
 *
 * Applies pending migrations (`prisma migrate deploy`) to a dedicated
 * database whose name ends in `_test`. Skipped when the database is
 * unreachable; fails instead when `JOURNEY_TEST_DATABASE_URL` is set
 * explicitly.
 */
const explicitUrl = process.env.JOURNEY_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_journey_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'JOURNEY_TEST_DATABASE_URL must target a dedicated database ending in _test',
  );
}

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

describe('Respondent journey on PostgreSQL, no mocks (Story IR.3)', () => {
  const ALLOWED_ORIGIN = 'http://localhost:3000';
  const COMPLETION_CODE = '482917';
  const PASSWORD = 'Password12345!';
  const REWARD = 10;

  let app: INestApplication;
  let prisma: PrismaService;
  let demoRepo: DemographicProfileRepositoryPort;
  let sessionService: SessionService;
  let formRepository: FormRepositoryPort;
  let ledgerService: LedgerService;
  let completionCodes: CompletionCodeService;
  const publisherId = randomUUID();

  interface Actor {
    id: string;
    cookie: string;
    csrf: string;
  }

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches JOURNEY_TEST_DATABASE_URL', () => {
        throw new Error(
          `JOURNEY_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping the respondent journey suite.`,
      );
    }
  }

  async function userRow(role: 'PUBLISHER' | 'RESPONDENT', id = randomUUID()) {
    await prisma.user.create({
      data: {
        id,
        email: `ir3-${role.toLowerCase()}-${id}@example.com`,
        passwordHash: 'hash',
        role,
      },
    });
    return id;
  }

  /** A Respondent with a complete profile and a real (Prisma) session. */
  async function respondent(profile = true): Promise<Actor> {
    const id = await userRow('RESPONDENT');
    if (profile) await seedCompleteDemographicProfile(demoRepo, id);
    const tokens = await sessionService.createSession(id);
    return {
      id,
      cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
      csrf: tokens.csrfToken,
    };
  }

  function post(urlPath: string, who: Actor, body: object, key?: string) {
    const req = request(app.getHttpServer())
      .post(urlPath)
      .set('Cookie', who.cookie)
      .set('x-csrf-token', who.csrf)
      .set('Origin', ALLOWED_ORIGIN)
      .set('Content-Type', 'application/json');
    return (key ? req.set('Idempotency-Key', key) : req).send(body);
  }

  function get(urlPath: string, who: Actor) {
    return request(app.getHttpServer())
      .get(urlPath)
      .set('Cookie', who.cookie)
      .set('Origin', ALLOWED_ORIGIN);
  }

  async function startPastBarrier(formId: string, who: Actor) {
    const res = await post(`/surveys/${formId}/attempts`, who, {});
    expect(res.status).toBe(201);
    const started = surveyAttemptResponseSchema.parse(res.body.data);
    await backdate(started.attemptId, 10_000);
    return started;
  }

  function backdate(attemptId: string, ms: number) {
    return prisma.surveyAttempt.update({
      where: { id: attemptId },
      data: { startedAt: new Date(Date.now() - ms) },
    });
  }

  function submit(
    responseId: string,
    attemptId: string,
    who: Actor,
    key?: string,
  ) {
    return post(
      `/responses/${responseId}/submit`,
      who,
      { attemptId, answers: { q1: 'my answer' } },
      key,
    );
  }

  /** Wallet cache == sum of ledger entries, per account of the user. */
  async function expectWalletExplainedByLedger(userId: string) {
    const accounts = await prisma.ledgerAccount.findMany({ where: { userId } });
    for (const account of accounts) {
      const sum = await prisma.ledgerEntry.aggregate({
        where: { accountId: account.id },
        _sum: { amount: true },
      });
      expect(account.balance).toBe(sum._sum.amount ?? 0);
    }
    expect(await ledgerInvariants(prisma)).toEqual(BALANCED_LEDGER);
  }

  function schemaOf(type: 'INTERNAL' | 'EXTERNAL', title: string) {
    return {
      schemaVersion: 1,
      title,
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
    };
  }

  /** A PUBLISHED survey with Escrow reserved for every expected completion. */
  async function survey(
    type: 'INTERNAL' | 'EXTERNAL',
    expectedCompletions: number,
  ) {
    const formId = randomUUID();
    const versionId = randomUUID();
    const title = `IR.3 ${type} survey ${formId.slice(0, 8)}`;
    const now = new Date();
    await formRepository.create(
      new FormEntity(
        formId,
        publisherId,
        type,
        'PUBLISHED',
        title,
        null,
        REWARD,
        expectedCompletions,
        now,
        now,
        undefined,
        0,
        5,
      ),
      new FormVersionEntity(
        versionId,
        formId,
        1,
        schemaOf(type, title) as never,
        null,
        true,
        type === 'EXTERNAL'
          ? 'https://docs.google.com/forms/d/e/ir3/viewform'
          : null,
        type === 'EXTERNAL'
          ? completionCodes.computeVerifier(versionId, COMPLETION_CODE)
          : null,
        now,
        now,
      ),
    );
    await ledgerService.reserveEscrow({
      userId: publisherId,
      formVersionId: versionId,
      amount: REWARD * expectedCompletions,
      formTitle: title,
    });
    return { formId, versionId, title };
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

    // Only Prisma and the env are provided: every repository is the real one.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    sessionService = moduleFixture.get(SessionService);
    ledgerService = moduleFixture.get(LedgerService, { strict: false });
    demoRepo = moduleFixture.get<DemographicProfileRepositoryPort>(
      DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
      { strict: false },
    );
    formRepository = moduleFixture.get<FormRepositoryPort>(
      FORM_REPOSITORY_PORT,
      { strict: false },
    );

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    await userRow('PUBLISHER', publisherId);
    const issuance = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const available = await ledgerService.getOrCreateAccount(
      publisherId,
      'USER_AVAILABLE',
    );
    await ledgerService.postJournal({
      idempotencyKey: `ir3-funding:${publisherId}`,
      entries: [
        { accountId: issuance.id, amount: -1_000_000 },
        { accountId: available.id, amount: 1_000_000 },
      ],
    });
  }, 180_000);

  afterAll(async () => {
    if (app) await app.close();
    if (prisma) await prisma.$disconnect();
  });

  liveIt(
    '(a) happy chain: register/login -> demographics -> feed -> summary -> start -> pinned read -> submit -> outcome and wallet',
    async () => {
      const { formId, versionId, title } = await survey('INTERNAL', 5);
      const email = `ir3-journey-${randomUUID()}@example.com`;

      // Real registration, then a fresh login on the same account.
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: PASSWORD });
      expect(registered.status).toBe(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      const userId = login.body.data.user.id as string;
      const setCookies = ([] as string[]).concat(
        login.headers['set-cookie'] ?? [],
      );
      expect(
        setCookies.some((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`)),
      ).toBe(true);
      const access = setCookies
        .find((c) => c.startsWith(`${AUTH_COOKIE_NAME}=`))!
        .split(';')[0];
      const csrfRes = await request(app.getHttpServer())
        .get('/auth/csrf')
        .set('Cookie', access)
        .set('Origin', ALLOWED_ORIGIN);
      expect(csrfRes.status).toBe(200);
      const who: Actor = {
        id: userId,
        cookie: access,
        csrf: csrfRes.body.data.csrfToken,
      };

      // Without a demographic profile the earning endpoints are gated.
      const gated = await get('/marketplace/feed', who);
      expect(gated.status).toBe(403);
      expect(gated.body.error.code).toBe('DEMOGRAPHIC_PROFILE_REQUIRED');

      const demo = await post('/demographics/survey', who, {
        ...COMPLETE_DEMOGRAPHIC_PROFILE,
      });
      expect(demo.status).toBe(200);

      const feed = await get('/marketplace/feed', who);
      expect(feed.status).toBe(200);
      const card = (feed.body.data.surveys as Array<{ id: string }>).find(
        (s) => s.id === formId,
      );
      expect(card).toBeDefined();

      const summary = await request(app.getHttpServer()).get(
        `/surveys/${formId}`,
      );
      expect(summary.status).toBe(200);
      expect(JSON.stringify(summary.body.data)).toContain(title);

      const started = await startPastBarrier(formId, who);
      expect(started.formVersionId).toBe(versionId);

      const detail = await get(`/attempts/${started.attemptId}`, who);
      expect(detail.status).toBe(200);
      expect(detail.body.data).toMatchObject({
        attemptId: started.attemptId,
        responseId: started.responseId,
        formVersionId: versionId,
        status: 'IN_PROGRESS',
      });
      expect(JSON.stringify(detail.body.data)).toContain('q1');

      const submitted = await submit(
        started.responseId!,
        started.attemptId,
        who,
      );
      expect(submitted.status).toBe(200);
      expect(submitted.body.data).toMatchObject({
        status: 'VALIDATED',
        reward: { status: 'SETTLED', amount: REWARD },
      });

      const outcome = await get(`/attempts/${started.attemptId}/outcome`, who);
      expect(outcome.status).toBe(200);
      const parsed = attemptOutcomeSchema.parse(outcome.body.data);
      expect(parsed.attemptStatus).toBe('COMPLETED');

      const wallet = await get('/economy/wallet', who);
      expect(wallet.status).toBe(200);
      const rewardEntry = await prisma.ledgerEntry.findFirst({
        where: {
          journal: { idempotencyKey: `internal-reward:${started.responseId}` },
          amount: { gt: 0 },
          account: { userId },
        },
      });
      expect(rewardEntry?.amount).toBe(REWARD);
      const journal = await prisma.ledgerJournal.findUnique({
        where: {
          idempotencyKey: `internal-reward:${started.responseId}`,
        },
        include: { entries: true },
      });
      expect(journal?.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
      await expectWalletExplainedByLedger(userId);
    },
    120_000,
  );

  liveIt(
    '(b1) the same user starting in parallel gets exactly one attempt; the others 409 with resume details',
    async () => {
      const { formId } = await survey('INTERNAL', 5);
      const who = await respondent();

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          post(`/surveys/${formId}/attempts`, who, {}),
        ),
      );

      const created = results.filter((r) => r.status === 201);
      const conflicts = results.filter((r) => r.status === 409);
      expect(created).toHaveLength(1);
      expect(conflicts).toHaveLength(4);
      const winner = surveyAttemptResponseSchema.parse(created[0].body.data);
      for (const c of conflicts) {
        expect(c.body.error.code).toBe('CONFLICTING_ACTIVE_ATTEMPT');
        expect(
          conflictingActiveAttemptDetailsSchema.parse(c.body.error.details),
        ).toMatchObject({
          attemptId: winner.attemptId,
          responseId: winner.responseId,
        });
      }
      expect(
        await prisma.surveyAttempt.count({
          where: { respondentId: who.id, surveyId: formId },
        }),
      ).toBe(1);
      expect(
        await prisma.response.count({
          where: { respondentId: who.id, formId },
        }),
      ).toBe(1);
    },
    60_000,
  );

  liveIt(
    '(b2) N+k users racing for a quota-N survey get exactly N attempts',
    async () => {
      const quota = 3;
      const { formId } = await survey('INTERNAL', quota);
      const actors = await Promise.all(
        Array.from({ length: quota + 4 }, () => respondent()),
      );

      const results = await Promise.all(
        actors.map((a) => post(`/surveys/${formId}/attempts`, a, {})),
      );

      expect(results.filter((r) => r.status === 201)).toHaveLength(quota);
      const rejected = results.filter((r) => r.status !== 201);
      expect(rejected).toHaveLength(4);
      for (const r of rejected) {
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('SURVEY_QUOTA_FULL');
      }
      expect(
        await prisma.surveyAttempt.count({
          where: { surveyId: formId, status: 'IN_PROGRESS' },
        }),
      ).toBe(quota);
    },
    120_000,
  );

  liveIt(
    '(c) resume after a newer version is published still serves the pinned version',
    async () => {
      const { formId, versionId } = await survey('INTERNAL', 5);
      const who = await respondent();
      const started = await startPastBarrier(formId, who);

      const v2Id = randomUUID();
      const v2 = await formRepository.createVersion(formId, v2Id, new Date(), {
        expectedStatus: 'PUBLISHED',
        isPublished: true,
        publishedAt: new Date(),
      });
      expect(v2).not.toBeNull();
      await prisma.formVersion.update({
        where: { id: v2Id },
        data: {
          schemaJson: {
            ...schemaOf('INTERNAL', 'Version two'),
            blocks: [
              {
                id: 'q2-new',
                order: 0,
                type: 'text',
                title: 'Only in v2',
                required: true,
              },
            ],
          },
        },
      });

      // Resume: the second start 409s with the original attempt/version...
      const again = await post(`/surveys/${formId}/attempts`, who, {});
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('CONFLICTING_ACTIVE_ATTEMPT');
      expect(again.body.error.details).toMatchObject({
        attemptId: started.attemptId,
        formVersionId: versionId,
      });

      // ...and the attempt read serves the pinned v1 definition, not v2.
      const detail = await get(`/attempts/${started.attemptId}`, who);
      expect(detail.status).toBe(200);
      expect(detail.body.data.formVersionId).toBe(versionId);
      expect(detail.body.data.versionNumber).toBe(1);
      const body = JSON.stringify(detail.body.data);
      expect(body).toContain('q1');
      expect(body).not.toContain('q2-new');

      // The pinned answers still submit and settle against v1.
      const submitted = await submit(
        started.responseId!,
        started.attemptId,
        who,
      );
      expect(submitted.status).toBe(200);
      expect(submitted.body.data.status).toBe('VALIDATED');
    },
    60_000,
  );

  liveIt(
    '(d) 5 parallel submits (one key, then different keys) -> 1 response, 1 reward journal, 1 notice/outbox pair, ledger explains the balance',
    async () => {
      const { formId } = await survey('INTERNAL', 10);
      const cases: Array<{ label: string; keyOf: (i: number) => string }> = [
        { label: 'same key', keyOf: () => 'dup-key-1' },
        { label: 'different keys', keyOf: () => `key-${randomUUID()}` },
      ];

      for (const c of cases) {
        const who = await respondent();
        const started = await startPastBarrier(formId, who);

        const results = await Promise.all(
          Array.from({ length: 5 }, (_, i) =>
            submit(started.responseId!, started.attemptId, who, c.keyOf(i)),
          ),
        );

        for (const r of results) {
          expect(r.status).toBe(200);
          expect(r.body.data.status).toBe('VALIDATED');
          expect(r.body.data.reward.journalId).toBe(
            results[0].body.data.reward.journalId,
          );
        }
        const key = `internal-reward:${started.responseId}`;
        expect(
          await prisma.response.count({
            where: { id: started.responseId!, status: 'VALIDATED' },
          }),
        ).toBe(1);
        expect(
          await prisma.ledgerJournal.count({ where: { idempotencyKey: key } }),
        ).toBe(1);
        expect(
          await prisma.outboxEvent.count({ where: { idempotencyKey: key } }),
        ).toBe(1);
        expect(
          await prisma.notification.count({
            where: { userId: who.id, dedupeKey: key },
          }),
        ).toBe(1);
        // The reward journal credits the respondent exactly once (the first
        // completion may also add the starter-points unlock in its own journal).
        const credited = await prisma.ledgerEntry.aggregate({
          where: {
            journal: { idempotencyKey: key },
            account: { userId: who.id },
          },
          _sum: { amount: true },
        });
        expect(credited._sum.amount).toBe(REWARD);
        await expectWalletExplainedByLedger(who.id);
      }
    },
    120_000,
  );

  liveIt(
    '(e) an expired reservation cannot submit: ATTEMPT_EXPIRED and no ledger entry',
    async () => {
      const { formId } = await survey('INTERNAL', 5);
      const who = await respondent();
      const started = await startPastBarrier(formId, who);
      await backdate(started.attemptId, 31 * 60 * 1000);

      const res = await submit(started.responseId!, started.attemptId, who);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ATTEMPT_EXPIRED');
      expect(
        await prisma.ledgerJournal.count({
          where: { idempotencyKey: `internal-reward:${started.responseId}` },
        }),
      ).toBe(0);
      expect(
        await prisma.ledgerEntry.count({
          where: { account: { userId: who.id } },
        }),
      ).toBe(0);
    },
    60_000,
  );

  liveIt(
    '(f) External: the correct completion code replayed credits exactly one pending reward',
    async () => {
      const { formId } = await survey('EXTERNAL', 5);
      const who = await respondent();
      const started = await startPastBarrier(formId, who);
      expect(started.type).toBe('EXTERNAL');

      const results = [] as request.Response[];
      for (let i = 0; i < 3; i++) {
        results.push(
          await post(`/attempts/${started.attemptId}/verify-code`, who, {
            completionCode: COMPLETION_CODE,
          }),
        );
      }
      // Plus a parallel burst of replays.
      results.push(
        ...(await Promise.all(
          Array.from({ length: 3 }, () =>
            post(`/attempts/${started.attemptId}/verify-code`, who, {
              completionCode: COMPLETION_CODE,
            }),
          ),
        )),
      );

      for (const r of results) {
        expect(r.status).toBe(200);
      }
      const key = `external-completion:${started.attemptId}`;
      expect(
        await prisma.ledgerJournal.count({ where: { idempotencyKey: key } }),
      ).toBe(1);
      const pending = await prisma.ledgerAccount.findFirstOrThrow({
        where: { userId: who.id, accountClass: 'PENDING' },
      });
      expect(pending.balance).toBe(REWARD);
      expect(
        await prisma.surveyAttempt.count({
          where: { id: started.attemptId, status: 'COMPLETED' },
        }),
      ).toBe(1);
      await expectWalletExplainedByLedger(who.id);
    },
    60_000,
  );
});
