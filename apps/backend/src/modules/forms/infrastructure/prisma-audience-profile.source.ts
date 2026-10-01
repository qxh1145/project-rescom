import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { toDemographicProfileEntity } from '../../users/infrastructure/prisma-demographic-profile.repository';
import {
  AudienceCandidate,
  AudienceCandidatePageQuery,
  AudienceProfileSourcePort,
} from '../application/ports/audience-profile-source.port';

/** ACTIVE, non-admin accounts: who can take a survey. */
const CANDIDATE_USER: Prisma.UserWhereInput = {
  status: 'ACTIVE',
  role: { not: 'ADMIN' },
};

/**
 * Pages `demographic_profiles` by `user_id` (its unique index serves the
 * keyset). The columns SQL can test exactly are pushed down: the required
 * `age`, `location`, `household_income` are NOT NULL and `age` is in range.
 * Gender, occupation and field of study live in the `specific_interests`
 * JSON and free text is matched after Unicode/whitespace folding
 * (`normalizeTargetingText`), so those are left to the shared matcher.
 * Rows are mapped like the participation gate reads them.
 */
@Injectable()
export class PrismaAudienceProfileSource implements AudienceProfileSourcePort {
  constructor(private readonly prisma: PrismaService) {}

  async listCandidates(
    query: AudienceCandidatePageQuery,
  ): Promise<AudienceCandidate[]> {
    const rows = await this.prisma.demographicProfile.findMany({
      where: {
        ...(query.afterUserId ? { userId: { gt: query.afterUserId } } : {}),
        user: CANDIDATE_USER,
        age: query.ageRange
          ? { gte: query.ageRange.min, lte: query.ageRange.max }
          : { not: null },
        location: { not: null },
        householdIncome: { not: null },
      },
      orderBy: { userId: 'asc' },
      take: query.limit,
    });
    return rows.map((row) => ({
      userId: row.userId,
      profile: toDemographicProfileEntity(row).toDto(),
    }));
  }

  async findCandidate(userId: string): Promise<AudienceCandidate | null> {
    const row = await this.prisma.demographicProfile.findFirst({
      where: { userId, user: CANDIDATE_USER },
    });
    return row
      ? { userId: row.userId, profile: toDemographicProfileEntity(row).toDto() }
      : null;
  }
}
