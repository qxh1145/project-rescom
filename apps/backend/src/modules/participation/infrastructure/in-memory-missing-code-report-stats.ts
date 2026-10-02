import {
  MissingCodeReportStatsPort,
  UnresolvedMissingCodeReport,
} from '../application/ports/missing-code-report-stats.port';

/** Test double: a settable count of unresolved reports. */
export class InMemoryMissingCodeReportStats implements MissingCodeReportStatsPort {
  unresolved = 0;
  calls = 0;
  reports: UnresolvedMissingCodeReport[] = [];

  async countUnresolved(): Promise<number> {
    this.calls += 1;
    return this.unresolved;
  }

  async listUnresolved(
    before: { createdAt: string; id: string } | null,
    limit: number,
  ): Promise<UnresolvedMissingCodeReport[]> {
    return [...this.reports]
      .sort(
        (a, b) =>
          b.reportedAt.getTime() - a.reportedAt.getTime() ||
          b.attemptId.localeCompare(a.attemptId),
      )
      .filter(
        (r) =>
          !before ||
          r.reportedAt.getTime() < Date.parse(before.createdAt) ||
          (r.reportedAt.getTime() === Date.parse(before.createdAt) &&
            r.attemptId < before.id),
      )
      .slice(0, limit);
  }
}
