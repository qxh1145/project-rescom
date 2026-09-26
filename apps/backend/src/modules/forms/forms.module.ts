import { Logger, Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { EconomyModule } from '../economy/economy.module';
import { FormsController } from './presentation/forms.controller';
import { PublicFormsController } from './presentation/public-forms.controller';
import { FormsService } from './application/forms.service';
import { FormsEscrowCoordinator } from './application/forms-escrow.coordinator';
import { FormModerationCommands } from './application/form-moderation.commands';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../common/database/unit-of-work.port';
import { PublicFormsService } from './application/public-forms.service';
import { CaptchaValidatorService } from './infrastructure/captcha-validator.service';
import { GuestSubmissionRateLimiter } from './infrastructure/guest-submission-rate-limiter';
import { LedgerService } from '../economy/application/ledger.service';
import { EnvService } from '../../common/config/env.service';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from './application/ports/form-repository.port';
import { PrismaFormRepository } from './infrastructure/prisma-form.repository';
import {
  COMPLETION_CODE_PORT,
  CompletionCodePort,
} from './application/ports/completion-code.port';
import { CompletionCodeService } from './infrastructure/completion-code.service';
import {
  SURVEY_RESPONSE_REPOSITORY_PORT,
  SurveyResponseRepositoryPort,
} from '../marketplace/application/ports/survey-response.repository.port';
import { PrismaSurveyResponseRepository } from '../marketplace/infrastructure/prisma-survey-response.repository';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, EconomyModule],
  controllers: [FormsController, PublicFormsController],
  providers: [
    {
      provide: FORM_REPOSITORY_PORT,
      useClass: PrismaFormRepository,
    },
    {
      provide: COMPLETION_CODE_PORT,
      useClass: CompletionCodeService,
    },
    {
      provide: SURVEY_RESPONSE_REPOSITORY_PORT,
      useClass: PrismaSurveyResponseRepository,
    },
    {
      // Bug 3.3: fails closed in production (no CAPTCHA provider integrated).
      provide: CaptchaValidatorService,
      useFactory: (env: EnvService) =>
        new CaptchaValidatorService({ isProduction: env.isProduction }),
      inject: [EnvService],
    },
    GuestSubmissionRateLimiter,
    {
      provide: FormsEscrowCoordinator,
      useFactory: (
        formRepo: FormRepositoryPort,
        ledgerService: LedgerService,
      ) =>
        new FormsEscrowCoordinator(
          formRepo,
          ledgerService,
          new Logger(FormsEscrowCoordinator.name),
        ),
      inject: [FORM_REPOSITORY_PORT, LedgerService],
    },
    {
      provide: FormsService,
      useFactory: (
        formRepository: FormRepositoryPort,
        completionCodePort: CompletionCodePort,
        escrowCoordinator: FormsEscrowCoordinator,
        unitOfWork: UnitOfWorkPort,
      ) =>
        new FormsService(
          formRepository,
          completionCodePort,
          escrowCoordinator,
          unitOfWork,
        ),
      inject: [
        FORM_REPOSITORY_PORT,
        COMPLETION_CODE_PORT,
        FormsEscrowCoordinator,
        UNIT_OF_WORK_PORT,
      ],
    },
    {
      provide: FormModerationCommands,
      useFactory: (
        formRepository: FormRepositoryPort,
        escrowCoordinator: FormsEscrowCoordinator,
      ) => new FormModerationCommands(formRepository, escrowCoordinator),
      inject: [FORM_REPOSITORY_PORT, FormsEscrowCoordinator],
    },
    {
      provide: PublicFormsService,
      useFactory: (
        formRepository: FormRepositoryPort,
        responseRepository: SurveyResponseRepositoryPort,
        captchaValidator: CaptchaValidatorService,
        rateLimiter: GuestSubmissionRateLimiter,
      ) =>
        new PublicFormsService(
          formRepository,
          responseRepository,
          captchaValidator,
          rateLimiter,
        ),
      inject: [
        FORM_REPOSITORY_PORT,
        SURVEY_RESPONSE_REPOSITORY_PORT,
        CaptchaValidatorService,
        GuestSubmissionRateLimiter,
      ],
    },
  ],
  exports: [
    FormsService,
    FormModerationCommands,
    FORM_REPOSITORY_PORT,
    COMPLETION_CODE_PORT,
    PublicFormsService,
  ],
})
export class FormsModule {}
