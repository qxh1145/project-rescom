import { JobRunContext } from '../../../../common/scheduler/scheduled-job';
import {
  PASSWORD_RESET_CLEANUP_JOB,
  PasswordResetCleanupJob,
} from './password-reset-cleanup.job';

describe('PasswordResetCleanupJob (review L9)', () => {
  const now = new Date('2026-10-01T09:00:00.000Z');
  const ctx = (shouldContinue = true): JobRunContext => ({
    runId: 'run',
    now,
    owner: 'test',
    fencingToken: '1',
    shouldContinue: async () => shouldContinue,
    logger: { log() {}, warn() {}, error() {}, debug() {} },
  });

  it('deletes in bounded batches with a 7-day cutoff until a short batch', async () => {
    const batches = [500, 500, 12];
    const purgeBefore = jest.fn(async () => batches.shift() ?? 0);
    const summary = await new PasswordResetCleanupJob({ purgeBefore }).run(
      ctx(),
    );

    expect(summary).toEqual({
      status: 'SUCCEEDED',
      counts: { deletedCount: 1012 },
      hasMore: false,
    });
    expect(purgeBefore).toHaveBeenCalledTimes(3);
    expect(purgeBefore).toHaveBeenCalledWith(
      new Date(now.getTime() - PASSWORD_RESET_CLEANUP_JOB.retentionMs),
      PASSWORD_RESET_CLEANUP_JOB.batchSize,
    );
  });

  it('stops at the batch budget or when the lease is lost, reporting more work', async () => {
    const purgeBefore = jest.fn(async () => 500);
    expect(
      (await new PasswordResetCleanupJob({ purgeBefore }, 2).run(ctx()))
        .hasMore,
    ).toBe(true);
    expect(purgeBefore).toHaveBeenCalledTimes(2);

    purgeBefore.mockClear();
    await new PasswordResetCleanupJob({ purgeBefore }, 5).run(ctx(false));
    expect(purgeBefore).toHaveBeenCalledTimes(1);
  });
});
