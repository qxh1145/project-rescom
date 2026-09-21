import { Gender, DemographicProfileDto } from '@rescom/schemas';

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

  isComplete(): boolean {
    return (
      typeof this.age === 'number' &&
      this.age >= 13 &&
      Boolean(this.gender) &&
      Boolean(this.location && this.location.trim().length > 0)
    );
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
