import { testJobContext } from '../../../../common/scheduler/test-job-context';
import { DEADLINE_CLOSE_GRACE_MS } from '../../application/forms.service';
import { DeadlineCloseJob } from './deadline-close.job';

describe('DeadlineCloseJob (Story IR.2b Task 9.6)', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');

  it('closes due forms one by one, counts refunds and survives one failure', async () => {
    const forms = {
      closeFormAtDeadline: jest
        .fn()
        .mockResolvedValueOnce({
          closed: true,
          refundAmount: 40,
          refundIdempotencyKey: 'k',
        })
        .mockResolvedValueOnce({
          closed: false,
          refundAmount: 0,
          refundIdempotencyKey: null,
        })
        .mockRejectedValueOnce(new Error('ledger down')),
    };
    const repo = {
      findFormsPastDeadline: jest.fn().mockResolvedValue(['f1', 'f2', 'f3']),
    };

    const summary = await new DeadlineCloseJob(forms, repo).run(
      testJobContext(now),
    );

    expect(repo.findFormsPastDeadline).toHaveBeenCalledWith(
      new Date(now.getTime() - DEADLINE_CLOSE_GRACE_MS),
      25,
    );
    expect(forms.closeFormAtDeadline.mock.calls.map((c) => c[0])).toEqual([
      'f1',
      'f2',
      'f3',
    ]);
    expect(summary).toEqual({
      status: 'PARTIAL',
      counts: {
        closedCount: 1,
        skippedCount: 1,
        failedCount: 1,
        pointsRefunded: 40,
      },
      hasMore: false,
    });
  });

  it('tries a stuck form once per run (no loop)', async () => {
    const forms = {
      closeFormAtDeadline: jest.fn().mockRejectedValue(new Error('x')),
    };
    const repo = { findFormsPastDeadline: jest.fn().mockResolvedValue(['f1']) };
    // Review LOW-6: every attempted form failed -> a FAILED run.
    await expect(
      new DeadlineCloseJob(forms, repo).run(testJobContext(now)),
    ).rejects.toMatchObject({ code: 'ALL_ITEMS_FAILED' });
    expect(forms.closeFormAtDeadline).toHaveBeenCalledTimes(1);
  });
});
