import { testJobContext } from '../../../common/scheduler/test-job-context';
import { OutboxPayloadInvalidError } from '../../../common/scheduler/outbox/outbox-handler';
import { PendingReleaseJob } from './jobs/pending-release.job';
import { StarterExpiryJob } from './jobs/starter-expiry.job';
import { InternalRewardRequestedHandler } from './outbox/internal-reward-requested.handler';

const ids = {
  response: '11111111-1111-4111-8111-111111111111',
  attempt: '22222222-2222-4222-8222-222222222222',
  form: '33333333-3333-4333-8333-333333333333',
  version: '44444444-4444-4444-8444-444444444444',
  publisher: '55555555-5555-4555-8555-555555555555',
  respondent: '66666666-6666-4666-8666-666666666666',
};

function envelope(payload: unknown) {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    idempotencyKey: `internal-reward:${ids.response}`,
    eventType: 'InternalRewardRequested',
    schemaVersion: 1,
    producer: 'participation-service',
    aggregateType: 'Response',
    aggregateId: ids.response,
    aggregateVersion: 1,
    orderingStream: `internal-reward:${ids.response}`,
    streamSequence: 1,
    correlationId: null,
    causationId: null,
    payload,
    attempts: 1,
    createdAt: new Date(),
  };
}

const payload = {
  responseId: ids.response,
  attemptId: ids.attempt,
  formId: ids.form,
  formVersionId: ids.version,
  publisherId: ids.publisher,
  respondentId: ids.respondent,
  rewardAmount: 12,
  policyMode: 'SHADOW',
  policyDeploymentId: 'policy-default-v1',
  submittedAt: '2026-10-01T00:00:00.000Z',
};

describe('InternalRewardRequestedHandler (Story IR.2b Task 5)', () => {
  const validated = {
    findResponseById: jest.fn().mockResolvedValue({ status: 'VALIDATED' }),
  };

  it.each([['DISPUTED'], ['REJECTED'], [null]])(
    'review LOW-15: skips (records, pays nothing) a response that is %s',
    async (status) => {
      const coordinator = {
        findInternalSettlement: jest.fn().mockResolvedValue(null),
        settleInternalReward: jest.fn(),
      };
      await new InternalRewardRequestedHandler(coordinator as never, {
        findResponseById: async () => (status ? { status } : null),
      }).handle(envelope(payload));
      expect(coordinator.settleInternalReward).not.toHaveBeenCalled();
    },
  );

  it('settles from the pinned request with the re-drive mapping', async () => {
    const coordinator = {
      findInternalSettlement: jest.fn().mockResolvedValue(null),
      settleInternalReward: jest.fn().mockResolvedValue({ status: 'SETTLED' }),
    };
    const handler = new InternalRewardRequestedHandler(
      coordinator as never,
      validated,
    );

    await handler.handle(envelope(payload));

    expect(handler.name).toBe('economy.internal-reward-settlement');
    expect(coordinator.settleInternalReward).toHaveBeenCalledWith({
      responseId: ids.response,
      publisherId: ids.publisher,
      respondentId: ids.respondent,
      rewardPerResponse: 12,
      policyMode: 'SHADOW',
    });
  });

  it('is a no-op (no settlement, no notice) when the reward was already posted', async () => {
    const coordinator = {
      findInternalSettlement: jest
        .fn()
        .mockResolvedValue({ status: 'SETTLED', journalId: 'j1' }),
      settleInternalReward: jest.fn(),
    };
    await new InternalRewardRequestedHandler(
      coordinator as never,
      validated,
    ).handle(envelope(payload));
    expect(coordinator.settleInternalReward).not.toHaveBeenCalled();
  });

  it('accepts a free survey (reward 0) and rejects a malformed payload', async () => {
    const coordinator = {
      findInternalSettlement: jest.fn().mockResolvedValue(null),
      settleInternalReward: jest.fn().mockResolvedValue({ status: 'SETTLED' }),
    };
    const handler = new InternalRewardRequestedHandler(
      coordinator as never,
      validated,
    );
    await handler.handle(envelope({ ...payload, rewardAmount: 0 }));
    expect(coordinator.settleInternalReward).toHaveBeenCalledTimes(1);

    await expect(
      handler.handle(envelope({ ...payload, responseId: 'nope' })),
    ).rejects.toBeInstanceOf(OutboxPayloadInvalidError);
  });
});

describe('PendingReleaseJob (Story IR.2b Task 6)', () => {
  const batch = (over: Record<string, unknown>) => ({
    processed: 100,
    releasedCount: 100,
    disputedCount: 0,
    failedCount: 0,
    hasMore: false,
    nextCursor: null,
    cutoffDate: '',
    ...over,
  });

  it('pages with the cursor until hasMore is false and sums counts', async () => {
    const coordinator = {
      releaseMaturedPendingRewards: jest
        .fn()
        .mockResolvedValueOnce(
          batch({
            hasMore: true,
            nextCursor: 'c1',
            failedCount: 2,
            releasedCount: 98,
          }),
        )
        .mockResolvedValueOnce(batch({ processed: 5, releasedCount: 5 })),
    };
    const summary = await new PendingReleaseJob(coordinator).run(
      testJobContext(),
    );
    expect(coordinator.releaseMaturedPendingRewards.mock.calls).toEqual([
      [{ limit: 100, after: undefined }],
      [{ limit: 100, after: 'c1' }],
    ]);
    expect(summary).toEqual({
      status: 'PARTIAL',
      counts: {
        processed: 105,
        releasedCount: 103,
        disputedCount: 0,
        failedCount: 2,
      },
      hasMore: false,
    });
  });

  it('review LOW-7: resumes from the last cursor and wraps to the oldest at the end', async () => {
    const coordinator = {
      releaseMaturedPendingRewards: jest
        .fn()
        .mockResolvedValueOnce(batch({ hasMore: true, nextCursor: 'c1' }))
        .mockResolvedValueOnce(batch({ processed: 3, releasedCount: 3 }))
        .mockResolvedValueOnce(batch({ processed: 1, releasedCount: 1 })),
    };
    const job = new PendingReleaseJob(coordinator, 1);
    await job.run(testJobContext());
    await job.run(testJobContext());
    await job.run(testJobContext());
    expect(
      coordinator.releaseMaturedPendingRewards.mock.calls.map(
        (c) => c[0].after,
      ),
    ).toEqual([undefined, 'c1', undefined]);
  });

  it('review LOW-6: a run where every credit failed is FAILED', async () => {
    const coordinator = {
      releaseMaturedPendingRewards: jest
        .fn()
        .mockResolvedValue(
          batch({ processed: 2, releasedCount: 0, failedCount: 2 }),
        ),
    };
    await expect(
      new PendingReleaseJob(coordinator).run(testJobContext()),
    ).rejects.toMatchObject({ code: 'ALL_ITEMS_FAILED' });
  });

  it('stops when the lease is lost and reports more work', async () => {
    const coordinator = {
      releaseMaturedPendingRewards: jest
        .fn()
        .mockResolvedValue(batch({ hasMore: true, nextCursor: 'c' })),
    };
    const summary = await new PendingReleaseJob(coordinator).run(
      testJobContext(new Date(), [false]),
    );
    expect(coordinator.releaseMaturedPendingRewards).toHaveBeenCalledTimes(1);
    expect(summary.hasMore).toBe(true);
  });
});

describe('StarterExpiryJob (Story IR.2b Task 7)', () => {
  it('pages to the end and reports counts only (never user ids)', async () => {
    const coordinator = {
      expireUnmaturedStarterPoints: jest
        .fn()
        .mockResolvedValueOnce({
          scannedCount: 100,
          expiredCount: 2,
          expiredUserIds: ['u1', 'u2'],
          totalPointsVoided: 40,
          unlockedUserIds: ['u3'],
          deferredCount: 1,
          failedCount: 0,
          timestamp: '',
          nextCursor: 'next',
        })
        .mockResolvedValueOnce({
          scannedCount: 3,
          expiredCount: 0,
          expiredUserIds: [],
          totalPointsVoided: 0,
          unlockedUserIds: [],
          deferredCount: 0,
          failedCount: 1,
          timestamp: '',
          nextCursor: null,
        }),
    };
    const summary = await new StarterExpiryJob(coordinator as never).run(
      testJobContext(),
    );
    expect(coordinator.expireUnmaturedStarterPoints.mock.calls).toEqual([
      [undefined, { limit: 100, after: undefined }],
      [undefined, { limit: 100, after: 'next' }],
    ]);
    expect(summary).toEqual({
      status: 'PARTIAL',
      counts: {
        scannedCount: 103,
        expiredCount: 2,
        unlockedCount: 1,
        deferredCount: 1,
        failedCount: 1,
        totalPointsVoided: 40,
      },
      hasMore: false,
    });
    expect(JSON.stringify(summary)).not.toContain('u1');
  });
});
