import { Injectable } from '@nestjs/common';
import type { UpdateUserProfileInput } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import type {
  UserProfileRecord,
  UserProfileRepositoryPort,
} from '../application/ports/user-profile.repository.port';

const SELECT = {
  userId: true,
  displayName: true,
  birthYear: true,
  school: true,
  schoolYear: true,
  goal: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** The keys present in `patch`: `undefined` keeps the stored value. */
function presentFields(patch: UpdateUserProfileInput) {
  return {
    ...(patch.displayName !== undefined
      ? { displayName: patch.displayName }
      : {}),
    ...(patch.birthYear !== undefined ? { birthYear: patch.birthYear } : {}),
    ...(patch.school !== undefined ? { school: patch.school } : {}),
    ...(patch.schoolYear !== undefined ? { schoolYear: patch.schoolYear } : {}),
    ...(patch.goal !== undefined ? { goal: patch.goal } : {}),
  };
}

@Injectable()
export class PrismaUserProfileRepository implements UserProfileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string): Promise<UserProfileRecord | null> {
    return this.prisma.userProfile.findUnique({
      where: { userId },
      select: SELECT,
    });
  }

  /**
   * One atomic `INSERT … ON CONFLICT ("user_id") DO UPDATE` (a Prisma 6 native
   * upsert: one unique key, scalar select) whose update sets only the keys
   * present in `patch`. Every field has its own column, so concurrent partial
   * edits never overwrite each other's fields and, unlike
   * `demographic_profiles` (JSON packing, Epic 7 P6), no read-merge-write lock
   * is needed. Uses the base client: no caller wraps profile edits in a Unit
   * of Work.
   */
  upsertPartial(
    userId: string,
    patch: UpdateUserProfileInput,
  ): Promise<UserProfileRecord> {
    const data = presentFields(patch);
    return this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
      select: SELECT,
    });
  }

  async findDisplayLabels(
    userIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    const labels = new Map<string, string | null>(
      userIds.map((userId) => [userId, null]),
    );
    if (labels.size === 0) return labels;
    const rows = await this.prisma.userProfile.findMany({
      where: { userId: { in: [...labels.keys()] } },
      select: { userId: true, displayName: true },
    });
    for (const row of rows) labels.set(row.userId, row.displayName);
    return labels;
  }
}
