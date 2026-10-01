import type { UpdateUserProfileInput, UserGoal } from '@rescom/schemas';

export const USER_PROFILE_REPOSITORY_PORT = Symbol(
  'USER_PROFILE_REPOSITORY_PORT',
);

/** A stored `user_profiles` row (FR-9, Story IR.4b part A). */
export interface UserProfileRecord {
  userId: string;
  displayName: string | null;
  birthYear: number | null;
  school: string | null;
  schoolYear: string | null;
  goal: UserGoal | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfileRepositoryPort {
  findByUserId(userId: string): Promise<UserProfileRecord | null>;
  /**
   * Creates the row on the first write. Only the keys present in `patch` are
   * written: an absent key keeps the stored value, `null` clears it.
   */
  upsertPartial(
    userId: string,
    patch: UpdateUserProfileInput,
  ): Promise<UserProfileRecord>;
  /**
   * Display names for admin labels (IR.4b part C), one entry per requested
   * id: `null` when the user has no profile row or no display name.
   */
  findDisplayLabels(
    userIds: readonly string[],
  ): Promise<Map<string, string | null>>;
}
