import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import { createHelmetMiddleware } from '../src/common/security/helmet.config';
import { createCorsOptions } from '../src/common/security/cors.config';

describe('Security & API Foundation E2E Tests (Story 1.6)', () => {
  let app: INestApplication;
  let envService: EnvService;

  beforeAll(async () => {
    envService = new EnvService({
      NODE_ENV: 'test',
      PORT: 4000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5433/rescom_test',
      JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
      JWT_ACCESS_TTL_SECONDS: 900,
      BCRYPT_ROUNDS: 12,
      FRONTEND_ORIGINS: 'http://localhost:3000',
      RATE_LIMIT_TTL_SECONDS: 60,
      RATE_LIMIT_MAX_REQUESTS: 5, // Small limit for testing throttling
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
      .overrideProvider(EnvService)
      .useValue(envService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.use(createHelmetMiddleware(true));
    app.use(cookieParser());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.enableCors(createCorsOptions(envService));

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('AC2: Helmet Security Headers', () => {
    it('should include all required baseline security headers and strip X-Powered-By', async () => {
      const res = await request(app.getHttpServer()).get('/system/metrics');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toContain(
        'max-age=31536000',
      );
      expect(res.headers['strict-transport-security']).toContain(
        'includeSubDomains',
      );
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['x-dns-prefetch-control']).toBe('off');
      expect(res.headers['x-download-options']).toBe('noopen');
      expect(res.headers['x-permitted-cross-domain-policies']).toBe('none');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('AC3: CORS Hardening & Origin Validation', () => {
    it('should permit allowed origin with credentials and allowed headers on preflight OPTIONS', async () => {
      const res = await request(app.getHttpServer())
        .options('/system/metrics')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('GET');
    });

    it('should NOT allow unauthorized origin on preflight OPTIONS', async () => {
      const res = await request(app.getHttpServer())
        .options('/system/metrics')
        .set('Origin', 'http://malicious-origin.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('AC1: API-Level Rate Limiting & Throttling', () => {
    it('should return rate limit headers on normal requests', async () => {
      const res = await request(app.getHttpServer()).get('/system/metrics');
      expect(res.headers['x-ratelimit-limit']).toBe('5');
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    });

    it('should enforce rate limit and return 429 RATE_LIMIT_EXCEEDED with standard error envelope', async () => {
      const responses: request.Response[] = [];

      // Make 7 rapid requests when limit is 5
      for (let i = 0; i < 7; i++) {
        responses.push(
          await request(app.getHttpServer()).get('/system/metrics'),
        );
      }

      const throttledResponses = responses.filter((r) => r.status === 429);
      expect(throttledResponses.length).toBeGreaterThanOrEqual(1);

      const throttled = throttledResponses[0];
      expect(throttled.body).toEqual({
        data: null,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Please try again later.',
        },
        meta: {},
      });
      expect(throttled.headers['retry-after']).toBeDefined();
      expect(throttled.headers['x-ratelimit-limit']).toBe('5');
      expect(throttled.headers['x-ratelimit-remaining']).toBe('0');
      expect(throttled.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should not throttle health check endpoint (/system/health) due to @SkipThrottle()', async () => {
      // Send 10 rapid requests to /system/health when default limit is 5
      for (let i = 0; i < 10; i++) {
        const res = await request(app.getHttpServer()).get('/system/health');
        expect(res.status).not.toBe(429);
      }
    });

    it('should omit HSTS header in non-production environment', async () => {
      const devApp = (
        await Test.createTestingModule({
          imports: [AppModule],
        })
          .overrideProvider(PrismaService)
          .useValue({
            $connect: jest.fn().mockResolvedValue(undefined),
            $disconnect: jest.fn().mockResolvedValue(undefined),
          })
          .overrideProvider(EnvService)
          .useValue(envService)
          .compile()
      ).createNestApplication();

      devApp.use(createHelmetMiddleware(false));
      await devApp.init();

      const res = await request(devApp.getHttpServer()).get('/system/health');
      expect(res.headers['strict-transport-security']).toBeUndefined();
      await devApp.close();
    });
  });

  describe('AC1.3: Auth-Tier Stricter Throttling', () => {
    let authApp: INestApplication;

    beforeAll(async () => {
      const authEnv = new EnvService({
        NODE_ENV: 'test',
        PORT: 4001,
        DATABASE_URL:
          'postgresql://postgres:postgres@localhost:5433/rescom_test',
        JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
        JWT_ACCESS_TTL_SECONDS: 900,
        BCRYPT_ROUNDS: 12,
        FRONTEND_ORIGINS: 'http://localhost:3000',
        RATE_LIMIT_TTL_SECONDS: 60,
        RATE_LIMIT_MAX_REQUESTS: 100,
        AUTH_RATE_LIMIT_TTL_SECONDS: 60,
        AUTH_RATE_LIMIT_MAX_REQUESTS: 3,
      });

      const fixture = await Test.createTestingModule({
        imports: [AppModule],
      })
        .overrideProvider(PrismaService)
        .useValue({
          user: {
            findUnique: jest.fn().mockResolvedValue(null),
          },
          $connect: jest.fn().mockResolvedValue(undefined),
          $disconnect: jest.fn().mockResolvedValue(undefined),
        })
        .overrideProvider(EnvService)
        .useValue(authEnv)
        .compile();

      authApp = fixture.createNestApplication();
      authApp.use(cookieParser());
      authApp.useGlobalFilters(new HttpExceptionFilter());
      await authApp.init();
    });

    afterAll(async () => {
      await authApp.close();
    });

    it('should enforce stricter throttling tier on auth endpoints', async () => {
      const responses: request.Response[] = [];

      for (let i = 0; i < 5; i++) {
        responses.push(
          await request(authApp.getHttpServer())
            .post('/auth/login')
            .send({ email: 'test@example.com', password: 'password123' }),
        );
      }

      const throttled = responses.filter((r) => r.status === 429);
      expect(throttled.length).toBeGreaterThanOrEqual(1);
      expect(throttled[0].body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });
  });
});
