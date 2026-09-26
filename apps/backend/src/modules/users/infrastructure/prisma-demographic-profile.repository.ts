import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import { DemographicProfileEntity } from '../domain/demographic-profile.entity';
import { DemographicProfileRepositoryPort } from '../application/ports/demographic-profile.repository.port';
import { UpdateDemographicProfileInput, Gender } from '@rescom/schemas';

type DemographicInterests = Record<string, unknown> | string[] | null;

/**
 * Maps a `demographic_profiles` row to the domain entity. Gender, occupation,
 * field of study and the interest list (`customInterests`) are packed into the
 * `specific_interests` JSON column; legacy rows may hold a plain interest
 * array there. Shared with the starter-points provider so both read the same
 * profile (Story 7.1).
 */
export function toDemographicProfileEntity(raw: any): DemographicProfileEntity {
  const stored = raw.specificInterests as unknown;
  const isLegacyArray = Array.isArray(stored);
  const json: Record<string, unknown> =
    stored && typeof stored === 'object' && !isLegacyArray
      ? (stored as Record<string, unknown>)
      : {};

  const gender =
    (raw.gender as Gender | undefined) ??
    ((json.gender as Gender | undefined) || null);

  const occupation =
    (raw.occupation as string | undefined) ??
    ((json.occupation as string | undefined) || null);

  const fieldOfStudy =
    (raw.fieldOfStudy as string | undefined) ??
    ((json.fieldOfStudy as string | undefined) || null);

  const interests: DemographicInterests = isLegacyArray
    ? (stored as string[])
    : ((json.customInterests as DemographicInterests | undefined) ?? null);

  return new DemographicProfileEntity(
    raw.id,
    raw.userId,
    raw.age ?? null,
    gender,
    raw.location ?? null,
    occupation,
    fieldOfStudy,
    raw.householdIncome ?? null,
    interests,
    raw.createdAt,
    raw.updatedAt,
  );
}

const toEntity = toDemographicProfileEntity;

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

  /**
   * Partial profile write. Gender, occupation, field of study and interests
   * share the `specific_interests` JSON column, so the write is a
   * read-merge-update in one transaction (Epic 7 review P6 — corrects Epic 4
   * P15):
   * 1. `createMany({ skipDuplicates: true })` makes sure the user's row exists
   *    (`INSERT … ON CONFLICT DO NOTHING`, which never aborts the
   *    transaction). A concurrent first-time writer waits on the unique
   *    `user_id` until the other transaction commits, then inserts nothing.
   * 2. `SELECT … FOR UPDATE` now always locks a row, so concurrent partial
   *    edits — first-time ones included — serialize and each merges the
   *    previous writer's JSON fields instead of overwriting them.
   * 3. `update` writes the merged result: `undefined` keeps a field, explicit
   *    `null` clears it, and a legacy interest array is kept as
   *    `customInterests`.
   * A Prisma 6 `upsert` on the unique `userId` is a native
   * `INSERT … ON CONFLICT DO UPDATE`: it never raised P2002, and with no row
   * to lock both first-time writers merged from `{}`.
   *
   * Uses its own `$transaction` (not the ambient Unit of Work): no caller
   * wraps profile edits in a UoW.
   */
  async upsert(
    userId: string,
    data: UpdateDemographicProfileInput,
  ): Promise<DemographicProfileEntity> {
    return this.prisma.$transaction(async (tx) => {
      await tx.demographicProfile.createMany({
        data: [{ userId }],
        skipDuplicates: true,
      });
      await tx.$queryRaw`SELECT id FROM demographic_profiles WHERE user_id = ${userId}::uuid FOR UPDATE`;

      const existing = await tx.demographicProfile.findUnique({
        where: { userId },
      });

      const storedJson = existing?.specificInterests as unknown;
      const existingJson: Record<string, unknown> = Array.isArray(storedJson)
        ? { customInterests: storedJson }
        : storedJson && typeof storedJson === 'object'
          ? (storedJson as Record<string, unknown>)
          : {};

      const updatedJson: Record<string, unknown> = {
        ...existingJson,
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
        ...(data.occupation !== undefined
          ? { occupation: data.occupation }
          : {}),
        ...(data.fieldOfStudy !== undefined
          ? { fieldOfStudy: data.fieldOfStudy }
          : {}),
        ...(data.specificInterests !== undefined
          ? { customInterests: data.specificInterests }
          : {}),
      };

      const raw = await tx.demographicProfile.update({
        where: { userId },
        data: {
          ...(data.age !== undefined ? { age: data.age } : {}),
          ...(data.location !== undefined ? { location: data.location } : {}),
          ...(data.householdIncome !== undefined
            ? { householdIncome: data.householdIncome }
            : {}),
          specificInterests: updatedJson as unknown as Prisma.InputJsonValue,
        },
      });

      return toEntity(raw);
    });
  }
}
