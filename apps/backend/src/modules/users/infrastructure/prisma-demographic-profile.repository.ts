import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { DemographicProfileEntity } from '../domain/demographic-profile.entity';
import { DemographicProfileRepositoryPort } from '../application/ports/demographic-profile.repository.port';
import { UpdateDemographicProfileInput, Gender } from '@rescom/schemas';

function toEntity(raw: any): DemographicProfileEntity {
  const json = (raw.specificInterests as Record<string, unknown> | null) ?? {};

  const gender =
    (raw.gender as Gender | undefined) ??
    ((json.gender as Gender | undefined) || null);

  const occupation =
    (raw.occupation as string | undefined) ??
    ((json.occupation as string | undefined) || null);

  const fieldOfStudy =
    (raw.fieldOfStudy as string | undefined) ??
    ((json.fieldOfStudy as string | undefined) || null);

  return new DemographicProfileEntity(
    raw.id,
    raw.userId,
    raw.age,
    gender,
    raw.location,
    occupation,
    fieldOfStudy,
    raw.householdIncome,
    json.customInterests ?? raw.specificInterests,
    raw.createdAt,
    raw.updatedAt,
  );
}

@Injectable()
export class PrismaDemographicProfileRepository implements DemographicProfileRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<DemographicProfileEntity | null> {
    const raw = await this.prisma.demographicProfile.findUnique({
      where: { userId },
    });
    if (!raw) return null;
    return toEntity(raw);
  }

  async upsert(
    userId: string,
    data: UpdateDemographicProfileInput,
  ): Promise<DemographicProfileEntity> {
    const existing = await this.prisma.demographicProfile.findUnique({
      where: { userId },
    });

    const existingJson =
      (existing?.specificInterests as Record<string, unknown> | null) ?? {};

    const updatedJson: Record<string, unknown> = {
      ...existingJson,
      ...(data.gender !== undefined ? { gender: data.gender } : {}),
      ...(data.occupation !== undefined ? { occupation: data.occupation } : {}),
      ...(data.fieldOfStudy !== undefined
        ? { fieldOfStudy: data.fieldOfStudy }
        : {}),
      ...(data.specificInterests !== undefined
        ? { customInterests: data.specificInterests }
        : {}),
    };

    const raw = await this.prisma.demographicProfile.upsert({
      where: { userId },
      create: {
        userId,
        age: data.age ?? null,
        location: data.location ?? null,
        householdIncome: data.householdIncome ?? null,
        specificInterests: updatedJson as unknown as Prisma.InputJsonValue,
      },
      update: {
        ...(data.age !== undefined ? { age: data.age } : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
        ...(data.householdIncome !== undefined
          ? { householdIncome: data.householdIncome }
          : {}),
        specificInterests: updatedJson as unknown as Prisma.InputJsonValue,
      },
    });

    return toEntity(raw);
  }
}
