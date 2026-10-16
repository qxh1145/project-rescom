import { LedgerAccountClass } from '@rescom/schemas';

export const SPEND_DESTINATION_CLASSES = [
  'ESCROW',
  'SYSTEM_SINK',
] as const satisfies readonly LedgerAccountClass[];

export type SpendDestinationClass = (typeof SPEND_DESTINATION_CLASSES)[number];

export const USER_AVAILABLE_DEBIT_JOURNALS: Record<
  string,
  'SPEND' | 'NON_SPEND'
> = {
  'publish:': 'SPEND',
  'reopen-escrow:': 'SPEND',
  'redemption:': 'SPEND',
  'topup-refund-hold:': 'NON_SPEND',
  'reversal:': 'NON_SPEND',
  'topup-refund-withdraw:': 'NON_SPEND',
  'topup-refund-resolve:': 'NON_SPEND',
  'transfer:': 'NON_SPEND',
};

export interface SpendJournalEntryCandidate {
  accountClass: LedgerAccountClass | string;
  amount: number;
}

/**
 * Evaluates whether an entry set represents a spend journal.
 * A spend journal debits the user's USER_AVAILABLE and credits an account
 * whose class is in SPEND_DESTINATION_CLASSES (ESCROW or SYSTEM_SINK).
 */
export function isSpendJournal(
  entries: readonly SpendJournalEntryCandidate[],
): boolean {
  const hasUserAvailableDebit = entries.some(
    (entry) => entry.accountClass === 'USER_AVAILABLE' && entry.amount < 0,
  );
  const hasSpendDestinationCredit = entries.some(
    (entry) =>
      (SPEND_DESTINATION_CLASSES as readonly string[]).includes(
        entry.accountClass,
      ) && entry.amount > 0,
  );
  return hasUserAvailableDebit && hasSpendDestinationCredit;
}
