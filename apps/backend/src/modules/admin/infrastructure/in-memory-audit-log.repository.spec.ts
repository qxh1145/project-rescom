import { InMemoryAuditLogRepository } from './in-memory-audit-log.repository';

describe('InMemoryAuditLogRepository', () => {
  let repository: InMemoryAuditLogRepository;

  beforeEach(() => {
    repository = new InMemoryAuditLogRepository();
  });

  it('should append and retrieve an audit log by id', async () => {
    const created = await repository.append({
      action: 'USER_ROLE_CHANGED',
      userId: '11111111-1111-1111-1111-111111111111',
      targetUserId: '22222222-2222-2222-2222-222222222222',
      outcome: 'SUCCESS',
      metadata: { role: 'ADMIN' },
    });

    expect(created.id).toBeDefined();
    expect(created.action).toBe('USER_ROLE_CHANGED');

    const found = await repository.findById(created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  it('should return null when finding by non-existent id', async () => {
    const found = await repository.findById(
      '00000000-0000-0000-0000-000000000000',
    );
    expect(found).toBeNull();
  });

  it('should filter logs by action, outcome, userId, targetUserId, and date range', async () => {
    const userA = '11111111-1111-1111-1111-111111111111';
    const userB = '22222222-2222-2222-2222-222222222222';

    await repository.append({
      action: 'USER_ROLE_CHANGED',
      userId: userA,
      targetUserId: userB,
      outcome: 'SUCCESS',
    });

    await repository.append({
      action: 'USER_STATUS_CHANGED',
      userId: userA,
      targetUserId: userB,
      outcome: 'FAILURE',
      errorCode: 'CANNOT_LOCK_SELF',
    });

    await repository.append({
      action: 'LOGIN_FAILURE',
      userId: null,
      targetUserId: null,
      outcome: 'FAILURE',
    });

    // Filter by action
    const actionResult = await repository.findMany({
      page: 1,
      limit: 10,
      action: 'USER_ROLE_CHANGED',
    });
    expect(actionResult.total).toBe(1);
    expect(actionResult.items[0].action).toBe('USER_ROLE_CHANGED');

    // Filter by outcome
    const outcomeResult = await repository.findMany({
      page: 1,
      limit: 10,
      outcome: 'FAILURE',
    });
    expect(outcomeResult.total).toBe(2);

    // Filter by userId
    const userResult = await repository.findMany({
      page: 1,
      limit: 10,
      userId: userA,
    });
    expect(userResult.total).toBe(2);

    // Filter by targetUserId
    const targetResult = await repository.findMany({
      page: 1,
      limit: 10,
      targetUserId: userB,
    });
    expect(targetResult.total).toBe(2);
  });

  it('should handle pagination correctly and sort by createdAt DESC', async () => {
    const baseTime = Date.now();
    for (let i = 1; i <= 5; i++) {
      await repository.append({
        action: `ACTION_${i}`,
        outcome: 'SUCCESS',
        createdAt: new Date(baseTime + i * 1000),
      });
    }

    const page1 = await repository.findMany({ page: 1, limit: 2 });
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].action).toBe('ACTION_5');
    expect(page1.items[1].action).toBe('ACTION_4');

    const page2 = await repository.findMany({ page: 2, limit: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].action).toBe('ACTION_3');
    expect(page2.items[1].action).toBe('ACTION_2');

    const page3 = await repository.findMany({ page: 3, limit: 2 });
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0].action).toBe('ACTION_1');
  });

  it('should filter by valid date ranges and ignore invalid dates gracefully', async () => {
    const now = new Date();
    await repository.append({
      action: 'RECENT_ACTION',
      outcome: 'SUCCESS',
    });

    const pastDate = new Date(now.getTime() - 60000).toISOString();
    const futureDate = new Date(now.getTime() + 60000).toISOString();

    const inRange = await repository.findMany({
      page: 1,
      limit: 10,
      startDate: pastDate,
      endDate: futureDate,
    });
    expect(inRange.total).toBe(1);

    const outOfRange = await repository.findMany({
      page: 1,
      limit: 10,
      startDate: futureDate,
    });
    expect(outOfRange.total).toBe(0);

    // Invalid date string should not crash or corrupt
    const invalidDateQuery = await repository.findMany({
      page: 1,
      limit: 10,
      startDate: 'invalid-date',
    });
    expect(invalidDateQuery.total).toBe(1);
  });
});
