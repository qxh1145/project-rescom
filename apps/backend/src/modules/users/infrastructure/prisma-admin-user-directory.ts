import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { shortCodePrefixOf } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  AdminUserDirectoryPort,
  AdminUserLabel,
} from '../application/ports/admin-user-directory.port';
import { UserStatus } from '../domain/user.entity';

function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

@Injectable()
export class PrismaAdminUserDirectory implements AdminUserDirectoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findStatuses(
    userIds: readonly string[],
  ): Promise<Map<string, UserStatus>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
      take: ids.length,
    });
    return new Map(rows.map((row) => [row.id, row.status]));
  }

  async findLabels(
    userIds: readonly string[],
  ): Promise<Map<string, AdminUserLabel>> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        profile: { select: { displayName: true } },
      },
      take: ids.length,
    });
    return new Map(
      rows.map((row) => [
        row.id,
        { email: row.email, displayName: row.profile?.displayName ?? null },
      ]),
    );
  }

  async filterMatching(
    term: string,
    userIds: readonly string[],
  ): Promise<string[]> {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const pattern = likeContains(term.trim());
    const code = shortCodePrefixOf(term);
    const byCode = code
      ? Prisma.sql`OR replace(u.id::text, '-', '') LIKE ${`${code}%`}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT u.id::text AS "id"
      FROM users u
      LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE u.id = ANY(${ids}::uuid[])
        AND (
          u.email ILIKE ${pattern} ESCAPE '\\'
          OR p.display_name ILIKE ${pattern} ESCAPE '\\'
          ${byCode}
        )
    `;
    const matched = new Set(rows.map((row) => row.id));
    return ids.filter((id) => matched.has(id));
  }
}
