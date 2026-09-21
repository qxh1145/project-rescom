import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { FormsController } from './presentation/forms.controller';
import { PublicFormsController } from './presentation/public-forms.controller';
import { FormsService } from './application/forms.service';
import { PublicFormsService } from './application/public-forms.service';
import { CaptchaValidatorService } from './infrastructure/captcha-validator.service';
import { GuestSubmissionRateLimiter } from './infrastructure/guest-submission-rate-limiter';
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
  imports: [PrismaModule, AuthModule, UsersModule],
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
    CaptchaValidatorService,
    GuestSubmissionRateLimiter,
    {
      provide: FormsService,
      useFactory: (
        formRepository: FormRepositoryPort,
        completionCodePort: CompletionCodePort,
      ) => new FormsService(formRepository, completionCodePort),
      inject: [FORM_REPOSITORY_PORT, COMPLETION_CODE_PORT],
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
    FORM_REPOSITORY_PORT,
    COMPLETION_CODE_PORT,
    PublicFormsService,
  ],
})
export class FormsModule {}
