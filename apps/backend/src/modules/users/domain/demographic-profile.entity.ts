import {
  Gender,
  DemographicProfileDto,
  DemographicProfileField,
  getMissingDemographicFields,
} from '@rescom/schemas';

export class DemographicProfileEntity {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly age: number | null,
    public readonly gender: Gender | null,
    public readonly location: string | null,
    public readonly occupation: string | null,
    public readonly fieldOfStudy: string | null,
    public readonly householdIncome: string | null,
    public readonly specificInterests:
      Record<string, unknown> | string[] | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  /** FR-6 fields still missing; shared rule from `@rescom/schemas` (Story 7.1). */
  missingFields(): DemographicProfileField[] {
    return getMissingDemographicFields(this.toDto());
  }

  isComplete(): boolean {
    return this.missingFields().length === 0;
  }

  toDto(): DemographicProfileDto {
    return {
      id: this.id,
      userId: this.userId,
      age: this.age,
      gender: this.gender,
      location: this.location,
      occupation: this.occupation,
      fieldOfStudy: this.fieldOfStudy,
      householdIncome: this.householdIncome,
      specificInterests: this.specificInterests,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
