import { DemographicProfileDto } from '@rescom/schemas';

export const AUDIENCE_PROFILE_SOURCE_PORT = Symbol(
  'AUDIENCE_PROFILE_SOURCE_PORT',
);

/** One potential respondent: an active, non-admin account and its profile. */
export interface AudienceCandidate {
  userId: string;
  profile: DemographicProfileDto;
}

export interface AudienceCandidatePageQuery {
  /** Keyset cursor: only users with a greater id. */
  afterUserId: string | null;
  limit: number;
  /** Optional pre-filter; the matcher re-checks it, so it may be ignored. */
  ageRange?: { min: number; max: number };
}

/**
 * Read side of plan 5.5: pages of demographic profiles of ACTIVE, non-admin
 * users ordered by user id. Implementations may drop rows that can never be
 * eligible (a required column is NULL, age outside `ageRange`); everything
 * else — profile completeness and targeting — is decided by
 * `AudienceEstimateService` with the shared rules, never here.
 */
export interface AudienceProfileSourcePort {
  listCandidates(
    query: AudienceCandidatePageQuery,
  ): Promise<AudienceCandidate[]>;
  /** The caller's own candidate row (they are never counted), or null. */
  findCandidate(userId: string): Promise<AudienceCandidate | null>;
}
