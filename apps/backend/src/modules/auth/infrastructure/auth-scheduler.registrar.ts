import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import {
  PASSWORD_RESET_REPOSITORY_PORT,
  PasswordResetRepositoryPort,
} from '../application/ports/password-reset.repository.port';
import { PasswordResetCleanupJob } from './jobs/password-reset-cleanup.job';

/** Registers the Auth jobs (review L9). Optional registry, like the others. */
@Injectable()
export class AuthSchedulerRegistrar implements OnModuleInit {
  constructor(
    @Inject(PASSWORD_RESET_REPOSITORY_PORT)
    private readonly resets: PasswordResetRepositoryPort,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs?.register(new PasswordResetCleanupJob(this.resets));
  }
}
