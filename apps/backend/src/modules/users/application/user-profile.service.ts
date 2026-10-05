import {
  USER_PROFILE_BIRTH_YEAR_MESSAGE,
  UpdateUserProfileInput,
  UserProfileDto,
  isBirthYearAllowed,
  updateUserProfileSchema,
} from '@rescom/schemas';
import { UserProfileValidationException } from './exceptions/user-profile.exceptions';
import type {
  UserProfileRecord,
  UserProfileRepositoryPort,
} from './ports/user-profile.repository.port';

/** Vietnam has used UTC+7 without daylight saving time since 1975. */
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function toDto(record: UserProfileRecord | null): UserProfileDto {
  return {
    displayName: record?.displayName ?? null,
    birthYear: record?.birthYear ?? null,
    school: record?.school ?? null,
    schoolYear: record?.schoolYear ?? null,
    goal: record?.goal ?? null,
  };
}

/**
 * FR-9 profile (Story IR.4b part A): display name, birth year, school, school
 * year and goal. Writes `user_profiles` only — never the demographic profile
 * (`age` stays the matching field and is not derived from `birthYear`), the
 * user's role or status, sessions or starter points. `goal` is intent only.
 */
export class UserProfileService {
  constructor(
    private readonly repository: UserProfileRepositoryPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** A user without a stored profile gets every field `null`, never a 404. */
  async getOwnProfile(userId: string): Promise<UserProfileDto> {
    return toDto(await this.repository.findByUserId(userId));
  }

  /**
   * Partial update: an absent key keeps the stored value, `null` clears it and
   * blank text is stored as `null`. The input is validated here again with the
   * shared schema because non-HTTP callers (the seed) reach this method too.
   */
  async updateOwnProfile(
    userId: string,
    rawInput: UpdateUserProfileInput,
  ): Promise<UserProfileDto> {
    const parsed = updateUserProfileSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new UserProfileValidationException(
        parsed.error.errors[0]?.message ?? 'Validation failed',
        parsed.error.format(),
      );
    }
    const input = parsed.data;

    if (
      typeof input.birthYear === 'number' &&
      !isBirthYearAllowed(input.birthYear, this.currentYear())
    ) {
      throw new UserProfileValidationException(
        USER_PROFILE_BIRTH_YEAR_MESSAGE,
        {
          _errors: [],
          birthYear: { _errors: [USER_PROFILE_BIRTH_YEAR_MESSAGE] },
        },
      );
    }

    if (Object.values(input).every((value) => value === undefined)) {
      // `{}` is a no-op: no row is created and `updatedAt` does not move.
      return this.getOwnProfile(userId);
    }
    return toDto(await this.repository.upsertPartial(userId, input));
  }

  /**
   * The year ages are computed in: Vietnam's calendar year, the one the
   * onboarding screen of the pilot's users derives the birth year from.
   */
  private currentYear(): number {
    return new Date(
      this.clock().getTime() + VIETNAM_UTC_OFFSET_MS,
    ).getUTCFullYear();
  }
}
