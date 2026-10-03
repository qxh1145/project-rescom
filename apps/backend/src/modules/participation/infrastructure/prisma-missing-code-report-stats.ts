import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import {
  MissingCodeReportStatsPort,
  UnresolvedMissingCodeReport,
} from '../application/ports/missing-code-report-stats.port';

/** One count; the reset lookup uses `completion_code_limit_resets (respondent_id, form_version_id)`. */
@Injectable()
export class PrismaMissingCodeReportStats implements MissingCodeReportStatsPort {
  constructor(private readonly prisma: PrismaService) {}

  async countUnresolved(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS "count"
      FROM survey_attempts a
      WHERE a.missing_code_reported_at IS NOT NULL
        AND a.status <> 'COMPLETED'
        AND NOT EXISTS (
          SELECT 1 FROM completion_code_limit_resets r
          WHERE r.respondent_id = a.respondent_id
            AND r.form_version_id = a.form_version_id
            AND r.created_at >= a.missing_code_reported_at
        )
    `;
    return row?.count ?? 0;
  }

  async listUnresolved(
    before: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<UnresolvedMissingCodeReport[]> {
    // `missing_code_reported_at` is TIMESTAMP(3) holding UTC: the ISO cursor
    // cast to `timestamp` drops its `Z`, independent of the session TimeZone.
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        survey_id: string;
        respondent_id: string | null;
        reason: string | null;
        reported_at: Date;
        status: string;
      }>
    >`
      SELECT a.id::text AS id, a.survey_id::text AS survey_id,
             a.respondent_id::text AS respondent_id,
             a.missing_code_reason AS reason,
             a.missing_code_reported_at AS reported_at,
             a.status::text AS status
      FROM survey_attempts a
      WHERE a.missing_code_reported_at IS NOT NULL
        AND a.status <> 'COMPLETED'
        AND NOT EXISTS (
          SELECT 1 FROM completion_code_limit_resets r
          WHERE r.respondent_id = a.respondent_id
            AND r.form_version_id = a.form_version_id
            AND r.created_at >= a.missing_code_reported_at
        )
        AND (${before === null}
          OR (a.missing_code_reported_at, a.id)
             < (${before?.createdAt ?? null}::timestamp, ${before?.id ?? null}::uuid))
      ORDER BY a.missing_code_reported_at DESC, a.id DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      attemptId: row.id,
      surveyId: row.survey_id,
      respondentId: row.respondent_id,
      reason: row.reason,
      reportedAt: row.reported_at,
      attemptStatus: row.status,
    }));
  }
}
