import { testJobContext } from '../../../../common/scheduler/test-job-context';
import { PendingReleaseJob } from './pending-release.job';

type Release = ConstructorParameters<
  typeof PendingReleaseJob
>[0]['releaseMaturedPendingRewards'];
type Result = Awaited<ReturnType<Release>>;

const page = (over: Partial<Result>): Result =>
  ({
    processed: 0,
    releasedCount: 0,
    disputedCount: 0,
    failedCount: 0,
    hasMore: false,
    nextCursor: null,
    releasedAttemptIds: ['attempt-secret'],
    ...over,
  }) as unknown as Result;

describe('PendingReleaseJob (Story IR.2b Task 6)', () => {
  it('pages with the cursor until hasMore is false and sums counts only', async () => {
    const release = jest
      .fn()
      .mockResolvedValueOnce(
        page({
          processed: 2,
          releasedCount: 2,
          hasMore: true,
          nextCursor: 'c1',
        }),
      )
      .mockResolvedValueOnce(
        page({ processed: 1, releasedCount: 1, disputedCount: 0 }),
      );

    const summary = await new PendingReleaseJob({
      releaseMaturedPendingRewards: release,
    }).run(testJobContext());

    expect(release.mock.calls.map((c) => c[0].after)).toEqual([
      undefined,
      'c1',
    ]);
    expect(summary).toEqual({
      status: 'SUCCEEDED',
      counts: {
        processed: 3,
        releasedCount: 3,
        disputedCount: 0,
        failedCount: 0,
      },
      hasMore: false,
    });
    expect(JSON.stringify(summary)).not.toContain('attempt-secret');
  });

  it('stops when the lease is lost and reports hasMore', async () => {
    const release = jest
      .fn()
      .mockResolvedValue(
        page({ processed: 1, hasMore: true, nextCursor: 'c1' }),
      );

    const summary = await new PendingReleaseJob({
      releaseMaturedPendingRewards: release,
    }).run(testJobContext(new Date(), [false]));

    expect(release).toHaveBeenCalledTimes(1);
    expect(summary.hasMore).toBe(true);
  });

  it('fails the run when every attempted credit failed', async () => {
    const release = jest
      .fn()
      .mockResolvedValue(page({ processed: 2, failedCount: 2 }));

    await expect(
      new PendingReleaseJob({ releaseMaturedPendingRewards: release }).run(
        testJobContext(),
      ),
    ).rejects.toMatchObject({ code: 'ALL_ITEMS_FAILED' });
  });
});
