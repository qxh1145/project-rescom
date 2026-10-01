import { DemographicProfileDto } from '@rescom/schemas';
import {
  AudienceCandidate,
  AudienceCandidatePageQuery,
  AudienceProfileSourcePort,
} from '../application/ports/audience-profile-source.port';

/** Test double of the audience read side; callers add only ACTIVE, non-admin users. */
export class InMemoryAudienceProfileSource implements AudienceProfileSourcePort {
  private readonly candidates = new Map<string, DemographicProfileDto>();
  readonly queries: AudienceCandidatePageQuery[] = [];

  add(userId: string, profile: DemographicProfileDto): void {
    this.candidates.set(userId, profile);
  }

  async listCandidates(
    query: AudienceCandidatePageQuery,
  ): Promise<AudienceCandidate[]> {
    this.queries.push(query);
    return [...this.candidates.entries()]
      .filter(
        ([userId]) => query.afterUserId === null || userId > query.afterUserId,
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .slice(0, query.limit)
      .map(([userId, profile]) => ({ userId, profile }));
  }

  async findCandidate(userId: string): Promise<AudienceCandidate | null> {
    const profile = this.candidates.get(userId);
    return profile ? { userId, profile } : null;
  }
}
