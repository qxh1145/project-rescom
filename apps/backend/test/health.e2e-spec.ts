import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { MALWARE_SCANNER_PORT } from '../src/modules/storage/application/ports/malware-scanner.port';

describe('Health probes E2E (Story 11.1 Task 3)', () => {
  let app: INestApplication;
  const queryRaw = jest.fn();

  beforeAll(async () => {
    const envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
      RATE_LIMIT_TTL_SECONDS: 60,
      RATE_LIMIT_MAX_REQUESTS: 5, // Small limit: probes must still not hit it
    });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $connect: jest.fn().mockResolvedValue(undefined),
        $disconnect: jest.fn().mockResolvedValue(undefined),
        $queryRaw: queryRaw,
      })
      .overrideProvider(EnvService)
      .useValue(envService)
      .overrideProvider(MALWARE_SCANNER_PORT)
      .useValue({ ping: jest.fn().mockResolvedValue(false) })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('never throttles /health/live', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app.getHttpServer()).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ status: 'ok' });
    }
  });

  it('/health/ready answers 503 with checks and no sensitive text', async () => {
    queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED db.internal:5432 password=secret'),
    );
    const res = await request(app.getHttpServer()).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.error.details).toEqual({
      database: 'down',
      scanner: 'down',
      scheduler: expect.any(String),
    });
    expect(JSON.stringify(res.body)).not.toMatch(
      /ECONNREFUSED|db\.internal|secret|stack/i,
    );
  });
});
