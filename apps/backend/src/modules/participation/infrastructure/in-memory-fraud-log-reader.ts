import { fraudLogKindOf } from '@rescom/schemas';
import {
  FraudLogAccountCount,
  FraudLogFlaggedAccount,
  FraudLogReadFilter,
  FraudLogReadPort,
  FraudLogRecord,
} from '../application/ports/fraud-log-read.port';

export interface InMemoryFraudLogRow {
  id: string;
  userId: string;
  type: string;
  details: Record<string, unknown> | null;
  createdAt: Date;
  /** Survey the attempt of `details.attemptId` belongs to (the join of the Prisma reader). */
  attemptSurveyId?: string | null;
}

/** Test double of `PrismaFraudLogReader` over seeded rows. */
export class InMemoryFraudLogReader implements FraudLogReadPort {
  rows: InMemoryFraudLogRow[] = [];
  calls = 0;

  clear(): void {
    this.rows = [];
    this.calls = 0;
  }

  private matching(filter: FraudLogReadFilter): InMemoryFraudLogRow[] {
    return this.rows.filter(
      (row) =>
        (!filter.userIds || filter.userIds.includes(row.userId)) &&
        (!filter.since || row.createdAt >= filter.since) &&
        (!filter.kind || fraudLogKindOf(row) === filter.kind),
    );
  }

  private static newestFirst(
    a: InMemoryFraudLogRow,
    b: InMemoryFraudLogRow,
  ): number {
    return (
      b.createdAt.getTime() - a.createdAt.getTime() ||
      (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
    );
  }

  private static byCount(counts: Map<string, number>): FraudLogAccountCount[] {
    return [...counts.entries()]
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
  }

  async list(
    filter: FraudLogReadFilter,
    before: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<FraudLogRecord[]> {
    this.calls += 1;
    const beforeAt = before ? Date.parse(before.createdAt) : null;
    return this.matching(filter)
      .filter(
        (row) =>
          !before ||
          row.createdAt.getTime() < beforeAt! ||
          (row.createdAt.getTime() === beforeAt && row.id < before.id),
      )
      .sort(InMemoryFraudLogReader.newestFirst)
      .slice(0, limit)
      .map((row) => {
        const formId = row.details?.formId;
        const formVersionId = row.details?.formVersionId;
        return {
          id: row.id,
          userId: row.userId,
          type: row.type,
          details: row.details,
          createdAt: row.createdAt.toISOString(),
          surveyId:
            typeof formId === 'string' ? formId : (row.attemptSurveyId ?? null),
          formVersionId:
            typeof formVersionId === 'string' ? formVersionId : null,
        };
      });
  }

  /** The newest `cap` matching rows, like the Prisma reader's bounded subquery. */
  private newest(
    filter: FraudLogReadFilter,
    cap: number,
  ): InMemoryFraudLogRow[] {
    return this.matching(filter)
      .sort(InMemoryFraudLogReader.newestFirst)
      .slice(0, cap);
  }

  async countCapped(filter: FraudLogReadFilter, cap: number): Promise<number> {
    this.calls += 1;
    return this.newest(filter, cap).length;
  }

  async countByAccount(
    filter: FraudLogReadFilter,
    limit: number,
    cap: number,
  ): Promise<FraudLogAccountCount[]> {
    this.calls += 1;
    const counts = new Map<string, number>();
    for (const row of this.newest(filter, cap)) {
      counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    }
    return InMemoryFraudLogReader.byCount(counts).slice(0, limit);
  }

  async candidateUserIds(
    filter: FraudLogReadFilter,
    limit: number,
    cap: number,
  ): Promise<string[]> {
    this.calls += 1;
    // Newest first, so the first occurrence of an account is its latest entry.
    const ids: string[] = [];
    for (const row of this.newest(filter, cap)) {
      if (!ids.includes(row.userId)) ids.push(row.userId);
    }
    return ids.slice(0, limit);
  }

  async topAccountsSince(
    since: Date,
    limit: number,
  ): Promise<FraudLogFlaggedAccount[]> {
    this.calls += 1;
    const rows = this.matching({ since });
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
    }
    return InMemoryFraudLogReader.byCount(counts)
      .slice(0, limit)
      .map((account) => ({
        ...account,
        kinds: [
          ...new Set(
            rows
              .filter((row) => row.userId === account.userId)
              .map((row) => fraudLogKindOf(row)),
          ),
        ].sort(),
      }));
  }
}
