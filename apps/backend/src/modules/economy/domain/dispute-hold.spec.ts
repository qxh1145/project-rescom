import { LedgerJournalEntity } from './ledger-journal.entity';
import {
  attemptIdFromDisputeHold,
  disputeHoldDescription,
  disputeHoldKey,
} from './dispute-hold';

describe('attemptIdFromDisputeHold (BE-5)', () => {
  function hold(caseId: string, description: string | null) {
    return new LedgerJournalEntity({
      idempotencyKey: disputeHoldKey(caseId),
      description,
    });
  }

  it.each(['case-1', 'case)1', 'case.*', 'case (Case x)', 'case with spaces'])(
    'reads the attempt id back from the hold of case %j',
    (caseId) => {
      expect(
        attemptIdFromDisputeHold(
          hold(caseId, disputeHoldDescription('attempt-1', caseId)),
        ),
      ).toBe('attempt-1');
    },
  );

  it.each([
    [
      'another case id',
      'Dispute hold placed for external attempt: a (Case other)',
    ],
    [
      'trailing text',
      'Dispute hold placed for external attempt: a (Case c) note',
    ],
    [
      'a trailing note in parentheses',
      'Dispute hold placed for external attempt: a (Case c) (note)',
    ],
    ['no description', null],
  ])('returns null for %s', (_label, description) => {
    expect(attemptIdFromDisputeHold(hold('c', description))).toBeNull();
  });

  it('matches a line break in the case id like PostgreSQL does', () => {
    expect(
      attemptIdFromDisputeHold(
        hold('c\nd', disputeHoldDescription('attempt-1', 'c\nd')),
      ),
    ).toBe('attempt-1');
  });
});
