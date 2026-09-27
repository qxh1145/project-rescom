import { PrismaService } from '../../../common/database/prisma.service';
import { PrismaNotificationRepository } from './prisma-notification.repository';

describe('Story 9.6: PrismaNotificationRepository', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const notificationId = '22222222-2222-4222-8222-222222222222';
  const createdAt = new Date('2026-09-26T09:00:00.000Z');

  let prisma: {
    $transaction: jest.Mock;
    notification: Record<string, jest.Mock>;
  };
  let repo: PrismaNotificationRepository;

  const row = (overrides: Record<string, unknown> = {}) => ({
    id: notificationId,
    userId,
    type: 'REWARD_RELEASED',
    message: '+20 points released.',
    isRead: false,
    readAt: null,
    dedupeKey: 'release-pending:a-1',
    createdAt,
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      notification: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    repo = new PrismaNotificationRepository(prisma as unknown as PrismaService);
  });

  it('inserts with ON CONFLICT DO NOTHING and reports whether a row was created', async () => {
    prisma.notification.createMany.mockResolvedValueOnce({ count: 1 });
    prisma.notification.createMany.mockResolvedValueOnce({ count: 0 });
    const record = {
      userId,
      type: 'REWARD_RELEASED' as const,
      message: 'm',
      dedupeKey: 'release-pending:a-1',
    };

    await expect(repo.createIfAbsent(record)).resolves.toBe(true);
    await expect(repo.createIfAbsent(record)).resolves.toBe(false);
    expect(prisma.notification.createMany).toHaveBeenCalledWith({
      data: [record],
      skipDuplicates: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lists owner-scoped rows newest first with paging and maps them to entities', async () => {
    prisma.notification.findMany.mockResolvedValue([row()]);

    const result = await repo.listForUser(userId, {
      limit: 5,
      offset: 10,
      unreadOnly: true,
    });

    expect(prisma.notification.findMany).toHaveBeenCalledWith({
      where: { userId, isRead: false },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 5,
    });
    expect(result[0].toDto()).toEqual({
      id: notificationId,
      type: 'REWARD_RELEASED',
      message: '+20 points released.',
      isRead: false,
      readAt: null,
      createdAt: createdAt.toISOString(),
    });
  });

  it('counts with the owner filter', async () => {
    prisma.notification.count.mockResolvedValue(3);
    await expect(
      repo.countForUser(userId, { unreadOnly: false }),
    ).resolves.toBe(3);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId },
    });
  });

  it('marks only an owned unread row and returns the owned row', async () => {
    const readAt = new Date('2026-09-26T10:00:00.000Z');
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.findFirst.mockResolvedValue(
      row({ isRead: true, readAt }),
    );

    const entity = await repo.markRead(userId, notificationId, readAt);

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId, isRead: false },
      data: { isRead: true, readAt },
    });
    expect(prisma.notification.findFirst).toHaveBeenCalledWith({
      where: { id: notificationId, userId },
    });
    expect(entity?.isRead).toBe(true);
  });

  it('returns null when the notification is not owned by the user', async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    prisma.notification.findFirst.mockResolvedValue(null);

    await expect(
      repo.markRead(userId, notificationId, new Date()),
    ).resolves.toBeNull();
  });

  it('marks all unread rows of the user', async () => {
    const readAt = new Date();
    prisma.notification.updateMany.mockResolvedValue({ count: 4 });

    await expect(repo.markAllRead(userId, readAt)).resolves.toBe(4);
    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId, isRead: false },
      data: { isRead: true, readAt },
    });
  });
});
