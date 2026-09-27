import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FormsModule } from '../forms/forms.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../common/database/prisma.module';
import { MarketplaceService } from './application/marketplace.service';
import { MarketplaceController } from './presentation/marketplace.controller';
import { DemographicsController } from '../users/presentation/demographics.controller';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../forms/application/ports/form-repository.port';
import {
  DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
  DemographicProfileRepositoryPort,
} from '../users/application/ports/demographic-profile.repository.port';
import {
  SURVEY_RESPONSE_REPOSITORY_PORT,
  SurveyResponseRepositoryPort,
} from './application/ports/survey-response.repository.port';
import { PrismaSurveyResponseRepository } from './infrastructure/prisma-survey-response.repository';

@Module({
  imports: [AuthModule, FormsModule, UsersModule, PrismaModule],
  controllers: [MarketplaceController, DemographicsController],
  providers: [
    {
      provide: SURVEY_RESPONSE_REPOSITORY_PORT,
      useClass: PrismaSurveyResponseRepository,
    },
    {
      provide: MarketplaceService,
      useFactory: (
        formRepository: FormRepositoryPort,
        demographicRepository: DemographicProfileRepositoryPort,
        responseRepository: SurveyResponseRepositoryPort,
      ) =>
        new MarketplaceService(
          formRepository,
          demographicRepository,
          responseRepository,
        ),
      inject: [
        FORM_REPOSITORY_PORT,
        DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
        SURVEY_RESPONSE_REPOSITORY_PORT,
      ],
    },
  ],
  exports: [MarketplaceService, SURVEY_RESPONSE_REPOSITORY_PORT],
})
export class MarketplaceModule {}
