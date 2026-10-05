import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { EnvService } from '../config/env.service';
import { PrismaModule } from '../database/prisma.module';
import { PrismaService } from '../database/prisma.service';
import { PrismaUnitOfWork } from '../database/prisma-unit-of-work';
import { CLOCK, Clock, SystemClock } from '../time/clock';
import { JOB_LEASE_REPOSITORY } from './job-lease.repository';
import {
  OUTBOX_CLAIM_REPOSITORY,
  OutboxClaimRepository,
} from './outbox/outbox-claim.repository';
import { OutboxDispatchJob } from './outbox/outbox-dispatch.job';
import { OutboxHandlerRegistry } from './outbox/outbox-handler';
import { PrismaOutboxClaimRepository } from './outbox/prisma-outbox-claim.repository';
import { PrismaJobLeaseRepository } from './prisma-job-lease.repository';
import { ScheduledJobRegistry } from './scheduled-job';
import { SchedulerHealthService } from './scheduler-health.service';
import { SchedulerRunnerService } from './scheduler-runner.service';
import {
  OUTBOX_TX_MAX_WAIT_MS,
  OUTBOX_TX_TIMEOUT_MS,
} from './scheduler.constants';

/**
 * Story IR.2b Task 3.7: the in-process scheduler (AD-5 amendment). Global so
 * feature modules can register their jobs and Outbox handlers in
 * `onModuleInit` without `common/` importing them. A future `src/worker.ts`
 * only needs to import this module with `SCHEDULER_ENABLED=true`.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: ScheduledJobRegistry,
      useFactory: () => new ScheduledJobRegistry(),
    },
    {
      provide: OutboxHandlerRegistry,
      useFactory: () => new OutboxHandlerRegistry(),
    },
    { provide: JOB_LEASE_REPOSITORY, useClass: PrismaJobLeaseRepository },
    { provide: OUTBOX_CLAIM_REPOSITORY, useClass: PrismaOutboxClaimRepository },
    SchedulerRunnerService,
    SchedulerHealthService,
  ],
  exports: [
    CLOCK,
    ScheduledJobRegistry,
    OutboxHandlerRegistry,
    OUTBOX_CLAIM_REPOSITORY,
    SchedulerRunnerService,
    SchedulerHealthService,
  ],
})
export class SchedulerModule implements OnModuleInit {
  constructor(
    private readonly jobs: ScheduledJobRegistry,
    private readonly handlers: OutboxHandlerRegistry,
    @Inject(OUTBOX_CLAIM_REPOSITORY)
    private readonly claims: OutboxClaimRepository,
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly env: EnvService,
  ) {}

  onModuleInit(): void {
    // Story IR.2b Task 4.6: the dispatcher is itself a job, run every tick.
    this.jobs.register(
      new OutboxDispatchJob(
        this.handlers,
        this.claims,
        // Review MEDIUM-2: explicit limits for the per-event transactions.
        new PrismaUnitOfWork(this.prisma, {
          maxWait: OUTBOX_TX_MAX_WAIT_MS,
          timeout: OUTBOX_TX_TIMEOUT_MS,
        }),
        this.clock,
        {
          intervalMs: this.env.schedulerTickSeconds * 1000,
          maxAttempts: this.env.outboxMaxAttempts,
        },
      ),
    );
  }
}
