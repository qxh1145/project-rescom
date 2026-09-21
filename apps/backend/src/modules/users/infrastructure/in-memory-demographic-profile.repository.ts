import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DemographicProfileEntity } from '../domain/demographic-profile.entity';
import { DemographicProfileRepositoryPort } from '../application/ports/demographic-profile.repository.port';
import { UpdateDemographicProfileInput, Gender } from '@rescom/schemas';

@Injectable()
export class InMemoryDemographicProfileRepository implements DemographicProfileRepositoryPort {
  private profiles = new Map<string, DemographicProfileEntity>();

  clear(): void {
    this.profiles.clear();
  }

  async findByUserId(userId: string): Promise<DemographicProfileEntity | null> {
    return this.profiles.get(userId) ?? null;
  }

  async upsert(
    userId: string,
    data: UpdateDemographicProfileInput,
  ): Promise<DemographicProfileEntity> {
    const existing = this.profiles.get(userId);
    const now = new Date();

    const entity = new DemographicProfileEntity(
      existing ? existing.id : randomUUID(),
      userId,
      data.age !== undefined ? data.age : (existing?.age ?? null),
      data.gender !== undefined
        ? (data.gender as Gender | null)
        : (existing?.gender ?? null),
      data.location !== undefined
        ? data.location
        : (existing?.location ?? null),
      data.occupation !== undefined
        ? data.occupation
        : (existing?.occupation ?? null),
      data.fieldOfStudy !== undefined
        ? data.fieldOfStudy
        : (existing?.fieldOfStudy ?? null),
      data.householdIncome !== undefined
        ? data.householdIncome
        : (existing?.householdIncome ?? null),
      data.specificInterests !== undefined
        ? (data.specificInterests as Record<string, unknown> | string[] | null)
        : (existing?.specificInterests ?? null),
      existing?.createdAt ?? now,
      now,
    );

    this.profiles.set(userId, entity);
    return entity;
  }
}
