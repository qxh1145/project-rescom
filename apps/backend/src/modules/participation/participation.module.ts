import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/database/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { FormsModule } from '../forms/forms.module';
import { UsersModule } from '../users/users.module';
import { ParticipationController } from './presentation/participation.controller';
import { ParticipationService } from './application/participation.service';
import { PARTICIPATION_REPOSITORY_PORT } from './application/ports/participation-repository.port';
import { PrismaParticipationRepository } from './infrastructure/prisma-participation.repository';
import {
  FORM_REPOSITORY_PORT,
  FormRepositoryPort,
} from '../forms/application/ports/form-repository.port';
import {
  DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
  DemographicProfileRepositoryPort,
} from '../users/application/ports/demographic-profile.repository.port';
import { ParticipationRepositoryPort } from './application/ports/participation-repository.port';

@Module({
  imports: [PrismaModule, AuthModule, FormsModule, UsersModule],
  controllers: [ParticipationController],
  providers: [
    {
      provide: PARTICIPATION_REPOSITORY_PORT,
      useClass: PrismaParticipationRepository,
    },
    {
      provide: ParticipationService,
      useFactory: (
        formRepository: FormRepositoryPort,
        demographicRepository: DemographicProfileRepositoryPort,
        participationRepository: ParticipationRepositoryPort,
      ) =>
        new ParticipationService(
          formRepository,
          demographicRepository,
          participationRepository,
        ),
      inject: [
        FORM_REPOSITORY_PORT,
        DEMOGRAPHIC_PROFILE_REPOSITORY_PORT,
        PARTICIPATION_REPOSITORY_PORT,
      ],
    },
  ],
  exports: [ParticipationService, PARTICIPATION_REPOSITORY_PORT],
})
export class ParticipationModule {}
