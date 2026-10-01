import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ScheduledJobRegistry } from '../../../common/scheduler/scheduled-job';
import { FormsService } from '../application/forms.service';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../application/ports/form-repository.port';
import { DeadlineCloseJob } from './jobs/deadline-close.job';

/** Story IR.2b: registers the `deadline-close` job (registry optional in tests). */
@Injectable()
export class FormsSchedulerRegistrar implements OnModuleInit {
  constructor(
    private readonly forms: FormsService,
    @Inject(FORM_REPOSITORY_PORT)
    private readonly formRepository: FormRepositoryPort,
    @Optional() private readonly jobs?: ScheduledJobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs?.register(new DeadlineCloseJob(this.forms, this.formRepository));
  }
}
