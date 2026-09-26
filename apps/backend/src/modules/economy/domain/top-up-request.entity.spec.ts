import { TopUpRequestEntity } from './top-up-request.entity';

describe('TopUpRequestEntity (Story 6.6)', () => {
  const base = {
    userId: '11111111-1111-4111-8111-111111111111',
    amount: 100,
    amountVnd: 20_000,
    transferReference: 'RESCOMABCDEFGH',
  };
  const reviewedAt = new Date('2026-09-26T10:00:00.000Z');

  it('creates requests in the PENDING ("Pending Payment") state', () => {
    const request = TopUpRequestEntity.create(base);
    expect(request.status).toBe('PENDING');
    expect(request.isPending()).toBe(true);
    expect(request.adminId).toBeNull();
    expect(request.journalId).toBeNull();
  });

  it('rejects non-positive or fractional amounts', () => {
    expect(() => TopUpRequestEntity.create({ ...base, amount: 0 })).toThrow();
    expect(() => TopUpRequestEntity.create({ ...base, amount: 1.5 })).toThrow();
  });

  it('approves immutably, recording actor, journal and correlation', () => {
    const request = TopUpRequestEntity.create(base);
    const approved = request.approve({
      adminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      journalId: '44444444-4444-4444-8444-444444444444',
      correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reviewedAt,
    });

    expect(request.status).toBe('PENDING');
    expect(approved.status).toBe('APPROVED');
    expect(approved.adminId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(approved.journalId).toBe('44444444-4444-4444-8444-444444444444');
    expect(approved.reviewedAt).toEqual(reviewedAt);
    expect(approved.id).toBe(request.id);
  });

  it('rejects with a reason and forbids any further transition', () => {
    const rejected = TopUpRequestEntity.create(base).reject({
      adminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reason: 'Không tìm thấy giao dịch',
      correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reviewedAt,
    });

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Không tìm thấy giao dịch');
    expect(() =>
      rejected.approve({
        adminId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        journalId: '44444444-4444-4444-8444-444444444444',
        correlationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        reviewedAt,
      }),
    ).toThrow(/REJECTED/);
  });
});
