import { z } from 'zod';
import { ledgerAccountClassSchema } from './ledger-account.schema';

/**
 * Story 14.4: responses of the Admin ledger operator routes
 * (`GET /economy/integrity`, `GET /economy/accounts/:id/balance`,
 * `POST /economy/accounts/:id/reconcile`).
 */

/** Most drifted accounts one integrity report lists. */
export const LEDGER_DRIFT_REPORT_LIMIT = 100;

/** An account whose denormalised `balance` differs from the sum of its entries. */
export const ledgerDriftedAccountSchema = z
  .object({
    accountId: z.string().uuid(),
    userId: z.string().uuid().nullable(),
    accountClass: ledgerAccountClassSchema,
    projectedBalance: z.number().int(),
    calculatedBalance: z.number().int(),
  })
  .strict();
export type LedgerDriftedAccount = z.infer<typeof ledgerDriftedAccountSchema>;

export const ledgerIntegrityReportSchema = z
  .object({
    totalSystemBalance: z.number().int(),
    isZeroSum: z.boolean(),
    /** Ordered by `accountId`, at most `LEDGER_DRIFT_REPORT_LIMIT`. */
    driftedAccounts: z.array(ledgerDriftedAccountSchema),
    driftedAccountsTruncated: z.boolean(),
  })
  .strict();
export type LedgerIntegrityReport = z.infer<typeof ledgerIntegrityReportSchema>;

export const accountBalanceVerificationSchema = z
  .object({
    accountId: z.string().uuid(),
    projectedBalance: z.number().int(),
    calculatedBalance: z.number().int(),
    isConsistent: z.boolean(),
  })
  .strict();
export type AccountBalanceVerification = z.infer<
  typeof accountBalanceVerificationSchema
>;

export const accountReconciliationResultSchema = z
  .object({
    accountId: z.string().uuid(),
    priorBalance: z.number().int(),
    correctedBalance: z.number().int(),
  })
  .strict();
export type AccountReconciliationResult = z.infer<
  typeof accountReconciliationResultSchema
>;
