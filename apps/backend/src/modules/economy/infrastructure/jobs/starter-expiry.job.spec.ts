import { testJobContext } from '../../../../common/scheduler/test-job-context';
import { StarterExpiryJob } from './starter-expiry.job';

type Expire = ConstructorParameters<
  typeof StarterExpiryJob
>[0]['expireUnmaturedStarterPoints'];
type Result = Awaited<ReturnType<Expire>>;

const page = (over: Record<string, unknown>): Result =>
  ({
    scannedCount: 0,
    expiredCount: 0,
    deferredCount: 0,
    failedCount: 0,
    totalPointsVoided: 0,
    unlockedUserIds: [],
    expiredUserIds: ['user-secret'],
    nextCursor: null,
    ...over,
  }) as unknown as Result;

describe('StarterExpiryJob (Story IR.2b Task 7)', () => {
  it('pages until the cursor ends and reports counts, never user ids', async () => {
    const expire = jest
      .fn()
      .mockResolvedValueOnce(
        page({
          scannedCount: 3,
          expiredCount: 2,
          totalPointsVoided: 20,
          unlockedUserIds: ['user-secret'],
          nextCursor: 'c1',
        }),
      )
      .mockResolvedValueOnce(page({ scannedCount: 1, deferredCount: 1 }));

    const summary = await new StarterExpiryJob({
      expireUnmaturedStarterPoints: expire,
    }).run(testJobContext());

    expect(expire.mock.calls.map((c) => c[1].after)).toEqual([undefined, 'c1']);
    expect(summary).toEqual({
      status: 'SUCCEEDED',
      counts: {
        scannedCount: 4,
        expiredCount: 2,
        unlockedCount: 1,
        deferredCount: 1,
        failedCount: 0,
        totalPointsVoided: 20,
      },
      hasMore: false,
    });
    expect(JSON.stringify(summary)).not.toContain('user-secret');
  });

  it('stops when the lease is lost and reports hasMore', async () => {
    const expire = jest
      .fn()
      .mockResolvedValue(page({ scannedCount: 1, nextCursor: 'c1' }));

    const summary = await new StarterExpiryJob({
      expireUnmaturedStarterPoints: expire,
    }).run(testJobContext(new Date(), [false]));

    expect(expire).toHaveBeenCalledTimes(1);
    expect(summary.hasMore).toBe(true);
  });

  it('fails the run when every scanned user failed', async () => {
    const expire = jest
      .fn()
      .mockResolvedValue(page({ scannedCount: 2, failedCount: 2 }));

    await expect(
      new StarterExpiryJob({ expireUnmaturedStarterPoints: expire }).run(
        testJobContext(),
      ),
    ).rejects.toMatchObject({ code: 'ALL_ITEMS_FAILED' });
  });
});
