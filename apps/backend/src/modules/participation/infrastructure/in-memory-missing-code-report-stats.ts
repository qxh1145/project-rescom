import { MissingCodeReportStatsPort } from '../application/ports/missing-code-report-stats.port';

/** Test double: a settable count of unresolved reports. */
export class InMemoryMissingCodeReportStats implements MissingCodeReportStatsPort {
  unresolved = 0;
  calls = 0;

  async countUnresolved(): Promise<number> {
    this.calls += 1;
    return this.unresolved;
  }
}
