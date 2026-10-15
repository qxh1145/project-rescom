import { uniqueViolationOf } from './unique-violation';

const p2002 = (target: string) => ({ code: 'P2002', meta: { target } });

describe('uniqueViolationOf', () => {
  it('classifies the open-report index', () => {
    expect(
      uniqueViolationOf(p2002('code_issue_reports_open_redemption_key')),
    ).toBe('code_issue_open');
  });

  it('does not mistake other code_issue_reports uniques for an open report', () => {
    expect(
      uniqueViolationOf(p2002('code_issue_reports_replacement_code_id_key')),
    ).toBe('other');
    expect(
      uniqueViolationOf(p2002('code_issue_reports_refund_journal_id_key')),
    ).toBe('other');
  });

  it('ignores non-P2002 errors', () => {
    expect(uniqueViolationOf(new Error('x'))).toBeNull();
  });
});
