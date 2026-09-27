import { DemographicProfileEntity } from '../../domain/demographic-profile.entity';
import { UpdateDemographicProfileInput } from '@rescom/schemas';

export const DEMOGRAPHIC_PROFILE_REPOSITORY_PORT = Symbol(
  'DEMOGRAPHIC_PROFILE_REPOSITORY_PORT',
);

export interface DemographicProfileRepositoryPort {
  findByUserId(userId: string): Promise<DemographicProfileEntity | null>;
  upsert(
    userId: string,
    data: UpdateDemographicProfileInput,
  ): Promise<DemographicProfileEntity>;
}
