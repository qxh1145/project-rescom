import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/common/database/prisma.service';
import { EnvService } from '../../src/common/config/env.service';
import { HttpExceptionFilter } from '../../src/common/http/http-exception.filter';
import { USER_REPOSITORY_PORT } from '../../src/modules/users/application/ports/user.repository.port';
import { InMemoryUserRepository } from '../../src/modules/users/infrastructure/in-memory-user.repository';
import { SESSION_REPOSITORY_PORT } from '../../src/modules/auth/application/ports/session-repository.port';
import { InMemorySessionRepository } from '../../src/modules/auth/infrastructure/in-memory-session.repository';
import { IDENTITY_AUDIT_PORT } from '../../src/modules/auth/application/ports/identity-audit.port';
import { InMemoryIdentityAuditRepository } from '../../src/modules/auth/infrastructure/in-memory-identity-audit.repository';
import { DEMOGRAPHIC_PROFILE_REPOSITORY_PORT } from '../../src/modules/users/application/ports/demographic-profile.repository.port';
import { InMemoryDemographicProfileRepository } from '../../src/modules/users/infrastructure/in-memory-demographic-profile.repository';
import { SessionService } from '../../src/modules/auth/application/session.service';
import { AUTH_COOKIE_NAME } from '../../src/modules/auth/presentation/cookie-options.helper';
import { LedgerService } from '../../src/modules/economy/application/ledger.service';

/**
 * Story IR.4 shared PostgreSQL harness for the Publisher / Financial /
 * Moderation e2e suites: real Prisma repositories for forms, ledger, top-ups,
 * moderation, notifications and the Outbox; only Identity (users, sessions)
 * stays in memory, mirroring attempt-cancel.prisma.e2e-spec.ts.
 */
export const ALLOWED_ORIGIN = 'http://localhost:3000';
export const backendDir = path.resolve(__dirname, '../..');
export const explicitUrl = process.env.FINANCIAL_TEST_DATABASE_URL;
export const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_financial_test?schema=public';

/** An unreachable DB is a hard failure when the URL is explicit or in CI. */
export const requireDb = Boolean(explicitUrl || process.env.CI);

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'FINANCIAL_TEST_DATABASE_URL must target a dedicated database ending in _test',
  );
}

/** Synchronous reachability probe, so `it.skip` can be chosen up front. */
export function probeDatabase(): boolean {
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

export interface Actor {
  id: string;
  cookie: string;
  csrf: string;
}

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  ledger: LedgerService;
  user(role: 'PUBLISHER' | 'RESPONDENT' | 'ADMIN'): Promise<Actor>;
  /** Credits `amount` Points to the user's Available account. */
  fund(userId: string, amount: number): Promise<void>;
  send(
    method: 'post' | 'patch',
    path: string,
    who: Actor,
    body?: object,
  ): request.Test;
  get(path: string, who: Actor): request.Test;
  close(): Promise<void>;
}

export async function bootHarness(): Promise<Harness> {
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
  const prisma = new PrismaService({
    datasources: { db: { url: databaseUrl } },
  });
  await prisma.$connect();

  const auditRepo = new InMemoryIdentityAuditRepository();
  const userRepo = new InMemoryUserRepository();
  const envService = new EnvService({
    NODE_ENV: 'test',
    PORT: 4000,
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
    JWT_ACCESS_TTL_SECONDS: 900,
    BCRYPT_ROUNDS: 12,
    FRONTEND_ORIGINS: ALLOWED_ORIGIN,
  });
  const moduleFixture = await Test.createTestingModule({
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
    .useValue(new InMemoryDemographicProfileRepository())
    .overrideProvider(EnvService)
    .useValue(envService)
    .compile();

  const sessionService = moduleFixture.get(SessionService);
  const ledger = moduleFixture.get(LedgerService, { strict: false });
  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  const issuance = await ledger.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');

  return {
    app,
    prisma,
    ledger,
    async user(role) {
      const id = randomUUID();
      const email = `ir4-${role.toLowerCase()}-${id}@example.com`;
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
      const tokens = await sessionService.createSession(id);
      return {
        id,
        cookie: `${AUTH_COOKIE_NAME}=${tokens.accessToken}`,
        csrf: tokens.csrfToken,
      };
    },
    async fund(userId, amount) {
      const available = await ledger.getOrCreateAccount(
        userId,
        'USER_AVAILABLE',
      );
      await ledger.postJournal({
        idempotencyKey: `ir4-fund:${userId}:${randomUUID()}`,
        entries: [
          { accountId: issuance.id, amount: -amount },
          { accountId: available.id, amount },
        ],
      });
    },
    send(method, path, who, body = {}) {
      return request(app.getHttpServer())
        [method](path)
        .set('Cookie', who.cookie)
        .set('x-csrf-token', who.csrf)
        .set('Origin', ALLOWED_ORIGIN)
        .set('Content-Type', 'application/json')
        .send(body);
    },
    get(path, who) {
      return request(app.getHttpServer()).get(path).set('Cookie', who.cookie);
    },
    async close() {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** A valid Internal draft (reward 10 -> 8 effective x 50 = 400 Escrow). */
export function internalDraftBody(title: string) {
  return {
    title,
    type: 'INTERNAL',
    rewardPerResponse: 10,
    estimatedDurationMinutes: 8,
    expectedCompletions: 50,
    schema: {
      schemaVersion: 1,
      title,
      blocks: [
        { id: 'q-1', type: 'text', order: 0, title: 'Q1', required: true },
      ],
    },
  };
}
