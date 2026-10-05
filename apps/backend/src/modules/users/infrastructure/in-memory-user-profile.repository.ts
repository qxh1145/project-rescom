import type { UpdateUserProfileInput } from '@rescom/schemas';
import type {
  UserProfileRecord,
  UserProfileRepositoryPort,
} from '../application/ports/user-profile.repository.port';

/** Test double for `UserProfileRepositoryPort`. */
export class InMemoryUserProfileRepository implements UserProfileRepositoryPort {
  private readonly rows = new Map<string, UserProfileRecord>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  clear(): void {
    this.rows.clear();
  }

  findByUserId(userId: string): Promise<UserProfileRecord | null> {
    return Promise.resolve(this.rows.get(userId) ?? null);
  }

  upsertPartial(
    userId: string,
    patch: UpdateUserProfileInput,
  ): Promise<UserProfileRecord> {
    const existing = this.rows.get(userId);
    const now = this.now();
    const record: UserProfileRecord = {
      userId,
      displayName:
        patch.displayName !== undefined
          ? patch.displayName
          : (existing?.displayName ?? null),
      birthYear:
        patch.birthYear !== undefined
          ? patch.birthYear
          : (existing?.birthYear ?? null),
      school:
        patch.school !== undefined ? patch.school : (existing?.school ?? null),
      schoolYear:
        patch.schoolYear !== undefined
          ? patch.schoolYear
          : (existing?.schoolYear ?? null),
      goal: patch.goal !== undefined ? patch.goal : (existing?.goal ?? null),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(userId, record);
    return Promise.resolve(record);
  }

  findDisplayLabels(
    userIds: readonly string[],
  ): Promise<Map<string, string | null>> {
    return Promise.resolve(
      new Map(
        userIds.map((userId) => [
          userId,
          this.rows.get(userId)?.displayName ?? null,
        ]),
      ),
    );
  }
}
