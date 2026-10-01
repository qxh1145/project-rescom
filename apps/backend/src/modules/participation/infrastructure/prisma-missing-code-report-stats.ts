import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { MissingCodeReportStatsPort } from '../application/ports/missing-code-report-stats.port';

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
}
