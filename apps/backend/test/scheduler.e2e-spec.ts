import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { EnvService } from '../src/common/config/env.service';
import { PrismaService } from '../src/common/database/prisma.service';
import {
  InMemoryJobLeaseRepository,
  JOB_LEASE_REPOSITORY,
} from '../src/common/scheduler/job-lease.repository';
import { ScheduledJobRegistry } from '../src/common/scheduler/scheduled-job';
import { SchedulerRunnerService } from '../src/common/scheduler/scheduler-runner.service';

/**
 * Story IR.2b Task 11.3: the scheduler inside the real `AppModule` (in-memory
 * lease, no Postgres). The AC7 fallback endpoints keep their own e2e suites.
 */
describe('Story IR.2b: scheduler boot and runJobOnce (in-memory)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot(schedulerEnabled: 'true' | 'false') {
    const leases = new InMemoryJobLeaseRepository();
    const mockPrisma: any = {
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(JOB_LEASE_REPOSITORY)
      .useValue(leases)
      .overrideProvider(EnvService)
      .useValue(
        new EnvService({
          NODE_ENV: 'test',
          PORT: 4000,
          DATABASE_URL:
            'postgresql://postgres:postgres@localhost:5433/rescom_test',
          JWT_SECRET: 'at_least_32_characters_super_secure_jwt_secret_key!',
          JWT_ACCESS_TTL_SECONDS: 900,
          BCRYPT_ROUNDS: 12,
          FRONTEND_ORIGINS: 'http://localhost:3000',
          SCHEDULER_ENABLED: schedulerEnabled,
        }),
      )
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    return {
      leases,
      runner: moduleRef.get(SchedulerRunnerService),
      registry: moduleRef.get(ScheduledJobRegistry),
    };
  }

  it.each(['false', 'true'] as const)(
    'SCHEDULER_ENABLED=%s under NODE_ENV=test starts no timer and runs nothing',
    async (flag) => {
      const { leases, runner } = await boot(flag);

      expect((runner as any).timer).toBeNull();
      expect(leases.rows.size).toBe(0);
    },
  );

  it('runJobOnce runs a registered job through its lease and records the outcome', async () => {
    const { leases, runner, registry } = await boot('false');
    const run = jest.fn().mockResolvedValue({
      status: 'SUCCEEDED',
      counts: { done: 2 },
      hasMore: false,
    });
    registry.register({
      name: 'e2e-job',
      intervalMs: 60_000,
      leaseTtlMs: 30_000,
      run,
    });

    const outcome = await runner.runJobOnce('e2e-job');

    expect(outcome).toMatchObject({
      job: 'e2e-job',
      outcome: 'SUCCEEDED',
      counts: { done: 2 },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(leases.rows.get('e2e-job')).toMatchObject({
      lastStatus: 'SUCCEEDED',
      leaseOwner: null,
    });
    await expect(runner.runJobOnce('missing-job')).rejects.toThrow(
      'Unknown scheduled job',
    );
  });
});
