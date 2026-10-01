import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  PublisherAnswerRow,
  PublisherResponseReadPort,
  PublisherResponseReadRow,
  ResponseFeedPosition,
} from '../application/ports/publisher-response-read.port';

/**
 * `(submitted_at, id) < (after)` keyset predicate, or nothing on the first
 * page. `submitted_at` is `TIMESTAMP(3)` holding UTC: the ISO instant is cast
 * to `timestamp` (its `Z` is dropped), independent of the session time zone.
 */
function keysetAfter(after?: ResponseFeedPosition): Prisma.Sql {
  return after
    ? Prisma.sql`AND (r.submitted_at, r.id) < (${after.submittedAt.toISOString()}::timestamp, ${after.id}::uuid)`
    : Prisma.empty;
}

/**
 * Story IR.4a (AC9): PostgreSQL reads of the Publisher responses feed. Every
 * query repeats the partial-index predicate literally
 * (`status IN ('SUBMITTED','VALIDATED')`) so they are served by
 * `responses_version_completed_feed_idx` (form_version_id, submitted_at DESC,
 * id DESC); the attempt start comes from the unique `attempt_id` join (no
 * N+1). Explicit columns only (AD-18).
 */
@Injectable()
export class PrismaPublisherResponseReadRepository implements PublisherResponseReadPort {
  constructor(private readonly prisma: PrismaService) {}

  async countListed(formVersionId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM responses r
      WHERE r.form_version_id = ${formVersionId}::uuid
        AND r.status IN ('SUBMITTED', 'VALIDATED')
        AND r.submitted_at IS NOT NULL
    `;
    return Number(row?.count ?? 0);
  }

  async listPage(params: {
    formVersionId: string;
    after?: ResponseFeedPosition;
    limit: number;
  }): Promise<PublisherResponseReadRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        form_version_id: string;
        submitted_at: Date;
        answers_json: unknown;
        started_at: Date | null;
      }>
    >`
      SELECT r.id, r.form_version_id, r.submitted_at, r.answers_json, a.started_at
      FROM responses r
      LEFT JOIN survey_attempts a ON a.id = r.attempt_id
      WHERE r.form_version_id = ${params.formVersionId}::uuid
        AND r.status IN ('SUBMITTED', 'VALIDATED')
        AND r.submitted_at IS NOT NULL
        ${keysetAfter(params.after)}
      ORDER BY r.submitted_at DESC, r.id DESC
      LIMIT ${params.limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      formVersionId: row.form_version_id,
      submittedAt: row.submitted_at,
      answers: row.answers_json,
      attemptStartedAt: row.started_at,
    }));
  }

  /** Served by `responses_form_completed_submitted_idx` (literal statuses). */
  async versionIdsWithListedResponses(formId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ form_version_id: string }>
    >`
      SELECT DISTINCT r.form_version_id
      FROM responses r
      WHERE r.form_id = ${formId}::uuid
        AND r.status IN ('SUBMITTED', 'VALIDATED')
        AND r.submitted_at IS NOT NULL
    `;
    return rows.map((row) => row.form_version_id);
  }

  async listAnswerBatch(params: {
    formVersionId: string;
    after?: ResponseFeedPosition;
    limit: number;
  }): Promise<PublisherAnswerRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; submitted_at: Date; answers_json: unknown }>
    >`
      SELECT r.id, r.submitted_at, r.answers_json
      FROM responses r
      WHERE r.form_version_id = ${params.formVersionId}::uuid
        AND r.status IN ('SUBMITTED', 'VALIDATED')
        AND r.submitted_at IS NOT NULL
        ${keysetAfter(params.after)}
      ORDER BY r.submitted_at DESC, r.id DESC
      LIMIT ${params.limit}
    `;
    return rows.map((row) => ({
      id: row.id,
      submittedAt: row.submitted_at,
      answers: row.answers_json,
    }));
  }
}
