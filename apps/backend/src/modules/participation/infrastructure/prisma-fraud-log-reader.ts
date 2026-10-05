import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WRONG_COMPLETION_CODE_ACTION } from '@rescom/schemas';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  FraudLogAccountCount,
  FraudLogFlaggedAccount,
  FraudLogReadFilter,
  FraudLogReadPort,
  FraudLogRecord,
} from '../application/ports/fraud-log-read.port';

const UUID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

/** Displayed kind of a row (`fraudLogKindOf` in `@rescom/schemas`). */
const KIND = Prisma.sql`(CASE WHEN f.type = 'SECURITY_VIOLATION' AND f.details->>'action' = ${WRONG_COMPLETION_CODE_ACTION} THEN 'COMPLETION_CODE' ELSE f.type::text END)`;

/**
 * `created_at` is `timestamp(3)` holding UTC: compare against an explicit UTC
 * instant so the session time zone never shifts the bound.
 */
function utc(instant: Date | string): Prisma.Sql {
  const iso = instant instanceof Date ? instant.toISOString() : instant;
  return Prisma.sql`(${iso}::timestamptz AT TIME ZONE 'UTC')`;
}

function whereOf(filter: FraudLogReadFilter): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (filter.userIds) {
    parts.push(
      filter.userIds.length > 0
        ? Prisma.sql`f.user_id = ANY(${[...filter.userIds]}::uuid[])`
        : Prisma.sql`FALSE`,
    );
  }
  if (filter.since)
    parts.push(Prisma.sql`f.created_at >= ${utc(filter.since)}`);
  if (filter.kind) parts.push(kindCondition(filter.kind));
  return Prisma.join(parts, ' AND ');
}

/**
 * `KIND = kind`, written so that every kind but the two derived from
 * `SECURITY_VIOLATION` is a plain `type` comparison.
 */
function kindCondition(kind: string): Prisma.Sql {
  if (kind === 'COMPLETION_CODE') {
    return Prisma.sql`(f.type = 'SECURITY_VIOLATION' AND f.details->>'action' = ${WRONG_COMPLETION_CODE_ACTION})`;
  }
  if (kind === 'SECURITY_VIOLATION') {
    return Prisma.sql`(f.type = 'SECURITY_VIOLATION' AND f.details->>'action' IS DISTINCT FROM ${WRONG_COMPLETION_CODE_ACTION})`;
  }
  return Prisma.sql`f.type::text = ${kind}`;
}

/** The newest `cap` matching entries: the bounded input of every aggregate. */
function newest(filter: FraudLogReadFilter, cap: number): Prisma.Sql {
  return Prisma.sql`(
    SELECT f.id, f.user_id, f.created_at
    FROM fraud_logs f
    WHERE ${whereOf(filter)}
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT ${cap}
  )`;
}

/**
 * Raw SQL because the kind of a row depends on a JSON key and the survey of a
 * row on its evidence (`details.formId`, else the attempt of
 * `details.attemptId`, joined by primary key for one page only).
 */
@Injectable()
export class PrismaFraudLogReader implements FraudLogReadPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    filter: FraudLogReadFilter,
    before: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<FraudLogRecord[]> {
    const keyset = before
      ? Prisma.sql`AND (f.created_at, f.id) < (${utc(before.createdAt)}, ${before.id}::uuid)`
      : Prisma.empty;
    return this.prisma.$queryRaw<FraudLogRecord[]>`
      WITH page AS (
        SELECT f.id, f.user_id, f.type, f.details, f.created_at
        FROM fraud_logs f
        WHERE ${whereOf(filter)} ${keyset}
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT ${limit}
      )
      SELECT
        page.id::text AS "id",
        page.user_id::text AS "userId",
        page.type::text AS "type",
        page.details AS "details",
        to_char(page.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
        COALESCE(
          CASE WHEN page.details->>'formId' ~* ${UUID_PATTERN} THEN page.details->>'formId' END,
          a.survey_id::text
        ) AS "surveyId",
        CASE WHEN page.details->>'formVersionId' ~* ${UUID_PATTERN}
          THEN page.details->>'formVersionId' END AS "formVersionId"
      FROM page
      LEFT JOIN survey_attempts a ON a.id = (
        CASE WHEN page.details->>'attemptId' ~* ${UUID_PATTERN}
          THEN (page.details->>'attemptId')::uuid END
      )
      ORDER BY page.created_at DESC, page.id DESC
    `;
  }

  async countCapped(filter: FraudLogReadFilter, cap: number): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS "count" FROM ${newest(filter, cap)} AS bounded
    `;
    return row?.count ?? 0;
  }

  async countByAccount(
    filter: FraudLogReadFilter,
    limit: number,
    cap: number,
  ): Promise<FraudLogAccountCount[]> {
    return this.prisma.$queryRaw<FraudLogAccountCount[]>`
      SELECT bounded.user_id::text AS "userId", count(*)::int AS "count"
      FROM ${newest(filter, cap)} AS bounded
      GROUP BY bounded.user_id
      ORDER BY count(*) DESC, bounded.user_id
      LIMIT ${limit}
    `;
  }

  async candidateUserIds(
    filter: FraudLogReadFilter,
    limit: number,
    cap: number,
  ): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT bounded.user_id::text AS "userId"
      FROM ${newest(filter, cap)} AS bounded
      GROUP BY bounded.user_id
      ORDER BY max(bounded.created_at) DESC, bounded.user_id
      LIMIT ${limit}
    `;
    return rows.map((row) => row.userId);
  }

  async topAccountsSince(
    since: Date,
    limit: number,
  ): Promise<FraudLogFlaggedAccount[]> {
    return this.prisma.$queryRaw<FraudLogFlaggedAccount[]>`
      SELECT
        f.user_id::text AS "userId",
        count(*)::int AS "count",
        array_agg(DISTINCT ${KIND}) AS "kinds"
      FROM fraud_logs f
      WHERE ${whereOf({ since })}
      GROUP BY f.user_id
      ORDER BY count(*) DESC, f.user_id
      LIMIT ${limit}
    `;
  }
}
