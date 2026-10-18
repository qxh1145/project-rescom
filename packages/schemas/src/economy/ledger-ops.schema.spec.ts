import {
  LEDGER_DRIFT_REPORT_LIMIT,
  accountBalanceVerificationSchema,
  accountReconciliationResultSchema,
  ledgerIntegrityReportSchema,
} from './ledger-ops.schema';
import { maturedReleaseSummarySchema } from './reward.schema';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

describe('Story 14.4 ledger operations schemas', () => {
  it('parses an integrity report with drifted accounts', () => {
    const report = {
      totalSystemBalance: 0,
      isZeroSum: true,
      driftedAccounts: [
        {
          accountId: ACCOUNT,
          userId: USER,
          accountClass: 'USER_AVAILABLE',
          projectedBalance: 120,
          calculatedBalance: 100,
        },
        {
          accountId: ACCOUNT,
          userId: null,
          accountClass: 'SYSTEM_ISSUANCE',
          projectedBalance: -5,
          calculatedBalance: 0,
        },
      ],
      driftedAccountsTruncated: false,
    };
    expect(ledgerIntegrityReportSchema.parse(report)).toEqual(report);
    expect(LEDGER_DRIFT_REPORT_LIMIT).toBe(100);
  });

  it('rejects unknown keys and non-integer balances', () => {
    const base = {
      totalSystemBalance: 0,
      isZeroSum: true,
      driftedAccounts: [],
      driftedAccountsTruncated: false,
    };
    expect(ledgerIntegrityReportSchema.safeParse(base).success).toBe(true);
    expect(
      ledgerIntegrityReportSchema.safeParse({ ...base, extra: 1 }).success,
    ).toBe(false);
    expect(
      ledgerIntegrityReportSchema.safeParse({ ...base, totalSystemBalance: 1.5 })
        .success,
    ).toBe(false);
    expect(
      ledgerIntegrityReportSchema.safeParse({
        totalSystemBalance: 0,
        isZeroSum: true,
      }).success,
    ).toBe(false);
  });

  it('parses balance verification and reconciliation results', () => {
    expect(
      accountBalanceVerificationSchema.parse({
        accountId: ACCOUNT,
        projectedBalance: 5,
        calculatedBalance: 5,
        isConsistent: true,
      }).isConsistent,
    ).toBe(true);
    expect(
      accountReconciliationResultSchema.parse({
        accountId: ACCOUNT,
        priorBalance: 120,
        correctedBalance: 100,
      }).correctedBalance,
    ).toBe(100);
    expect(
      accountReconciliationResultSchema.safeParse({
        accountId: 'nope',
        priorBalance: 1,
        correctedBalance: 1,
      }).success,
    ).toBe(false);
  });

  it('parses the matured release summary', () => {
    const summary = {
      processed: 3,
      releasedCount: 2,
      disputedCount: 1,
      failedCount: 0,
      hasMore: true,
      nextCursor: 'abc',
      cutoffDate: '2026-10-16T00:00:00.000Z',
    };
    expect(maturedReleaseSummarySchema.parse(summary)).toEqual(summary);
    expect(
      maturedReleaseSummarySchema.safeParse({ ...summary, nextCursor: null })
        .success,
    ).toBe(true);
    expect(
      maturedReleaseSummarySchema.safeParse({ ...summary, failedCount: -1 })
        .success,
    ).toBe(false);
    expect(
      maturedReleaseSummarySchema.safeParse({ ...summary, extra: true }).success,
    ).toBe(false);
  });
});
