import { RESERVATION_EXPIRY_MS } from '@rescom/schemas';
import { testJobContext } from '../../../../common/scheduler/test-job-context';
import { InMemoryParticipationRepository } from '../in-memory-participation.repository';
import { ReservationExpiryJob } from './reservation-expiry.job';

describe('ReservationExpiryJob (Story IR.2b Task 8)', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const grace = 2 * 60_000;

  async function seed(
    repo: InMemoryParticipationRepository,
    id: string,
    startedAt: Date,
  ) {
    await repo.createAttemptWithResponse({
      attemptId: id,
      formId: 'form-1',
      formVersionId: 'v1',
      respondentId: `user-${id}`,
      isGuest: false,
      formType: 'EXTERNAL',
      ipAddress: '127.0.0.1',
      startedAt,
    } as never);
  }

  it('abandons only attempts past 30 min + grace, as EXPIRED, without changing the quota', async () => {
    const repo = new InMemoryParticipationRepository();
    const boundary = now.getTime() - RESERVATION_EXPIRY_MS - grace;
    await seed(repo, 'old', new Date(boundary - 1));
    await seed(repo, 'edge', new Date(boundary));
    await seed(repo, 'live', new Date(now.getTime() - 5 * 60_000));
    const cutoff = new Date(now.getTime() - RESERVATION_EXPIRY_MS);
    const quotaBefore = await repo.getQuotaStatus('form-1', cutoff);

    const summary = await new ReservationExpiryJob(repo).run(
      testJobContext(now),
    );

    expect(summary).toEqual({
      status: 'SUCCEEDED',
      counts: { abandonedCount: 1 },
      hasMore: false,
    });
    const old = await repo.findAttemptById('old');
    expect(old).toMatchObject({ status: 'ABANDONED', closedReason: 'EXPIRED' });
    expect(old?.closedAt?.getTime()).toBe(now.getTime());
    expect((await repo.findAttemptById('edge'))?.status).toBe('IN_PROGRESS');
    expect((await repo.findAttemptById('live'))?.status).toBe('IN_PROGRESS');
    expect(await repo.getQuotaStatus('form-1', cutoff)).toEqual(quotaBefore);

    // Re-run: nothing more to do.
    const again = await new ReservationExpiryJob(repo).run(testJobContext(now));
    expect(again.counts).toEqual({ abandonedCount: 0 });
  });

  it('pages full batches while the lease holds', async () => {
    const repo = {
      abandonExpiredAttemptsBatch: jest
        .fn()
        .mockResolvedValueOnce({ abandonedIds: Array(200).fill('a') })
        .mockResolvedValueOnce({ abandonedIds: ['b'] }),
    };
    const summary = await new ReservationExpiryJob(repo).run(
      testJobContext(now),
    );
    expect(summary.counts).toEqual({ abandonedCount: 201 });
    expect(repo.abandonExpiredAttemptsBatch).toHaveBeenCalledWith(
      new Date(now.getTime() - RESERVATION_EXPIRY_MS - grace),
      200,
      now,
    );
  });
});
