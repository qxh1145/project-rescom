import { InMemoryNotificationRepository } from '../infrastructure/in-memory-notification.repository';
import { NotificationsService } from './notifications.service';
import { NotificationNotFoundException } from './exceptions/notification.exceptions';

describe('Story 9.6: NotificationsService', () => {
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';

  let repo: InMemoryNotificationRepository;
  let logger: { warn: jest.Mock };
  let now: Date;
  let service: NotificationsService;

  beforeEach(() => {
    repo = new InMemoryNotificationRepository();
    logger = { warn: jest.fn() };
    now = new Date('2026-09-26T09:00:00.000Z');
    service = new NotificationsService(repo, logger, () => now);
  });

  async function seed(userId: string, count: number, prefix = 'evt') {
    for (let i = 0; i < count; i++) {
      await repo.createIfAbsent({
        userId,
        type: 'REWARD_RELEASED',
        message: `${prefix} ${i}`,
        dedupeKey: `${prefix}:${userId}:${i}`,
      });
    }
  }

  describe('publish (NotificationPublisherPort)', () => {
    it('creates an unread notification for the target user', async () => {
      const result = await service.publish({
        userId: alice,
        type: 'REWARD_RELEASED',
        message: '  +20 points released.  ',
        dedupeKey: 'release-pending:attempt-1',
      });

      expect(result).toBe('CREATED');
      const list = await service.list(alice, {
        limit: 20,
        offset: 0,
        unreadOnly: false,
      });
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        type: 'REWARD_RELEASED',
        message: '+20 points released.',
        isRead: false,
        readAt: null,
      });
      expect(list.unreadCount).toBe(1);
    });

    it('stores a message with a lone surrogate as U+FFFD instead of failing (Epic 9 review P9)', async () => {
      const result = await service.publish({
        userId: alice,
        type: 'SURVEY_APPROVED',
        message: 'Your survey "Khảo sát \uD83D..." was approved.',
        dedupeKey: 'moderation:version-1',
      });

      expect(result).toBe('CREATED');
      expect(repo.all()[0].message).toBe(
        'Your survey "Khảo sát \uFFFD..." was approved.',
      );
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('is idempotent per (userId, dedupeKey)', async () => {
      const command = {
        userId: alice,
        type: 'ACCOUNT_ACTIVATED' as const,
        message: 'Unlocked.',
        dedupeKey: `starter-unlock:${alice}`,
      };

      expect(await service.publish(command)).toBe('CREATED');
      expect(await service.publish(command)).toBe('DUPLICATE');
      expect(repo.all()).toHaveLength(1);
    });

    it('lets one event key notify several users', async () => {
      const dedupeKey = 'dispute-resolved:case-1';
      await service.publish({
        userId: alice,
        type: 'WARNING',
        message: 'Dispute resolved.',
        dedupeKey,
      });
      await service.publish({
        userId: bob,
        type: 'WARNING',
        message: 'Dispute resolved.',
        dedupeKey,
      });

      expect(repo.all()).toHaveLength(2);
    });

    it('returns FAILED and logs for an invalid command without storing anything', async () => {
      const result = await service.publish({
        userId: 'not-a-uuid',
        type: 'WARNING',
        message: '   ',
        dedupeKey: 'k',
      });

      expect(result).toBe('FAILED');
      expect(repo.all()).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('never throws when the repository fails', async () => {
      jest
        .spyOn(repo, 'createIfAbsent')
        .mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.publish({
          userId: alice,
          type: 'WARNING',
          message: 'Hello',
          dedupeKey: 'k-1',
        }),
      ).resolves.toBe('FAILED');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('db down'),
      );
    });

    it('never throws even without a logger', async () => {
      const silent = new NotificationsService(repo);
      jest
        .spyOn(repo, 'createIfAbsent')
        .mockRejectedValueOnce(new Error('db down'));

      await expect(
        silent.publish({
          userId: alice,
          type: 'WARNING',
          message: 'Hello',
          dedupeKey: 'k-2',
        }),
      ).resolves.toBe('FAILED');
    });
  });

  describe('list', () => {
    it('returns only the caller notifications, newest first, with paging metadata', async () => {
      await seed(alice, 5);
      await seed(bob, 2);

      const page1 = await service.list(alice, {
        limit: 2,
        offset: 0,
        unreadOnly: false,
      });
      expect(page1.items.map((n) => n.message)).toEqual(['evt 4', 'evt 3']);
      expect(page1).toMatchObject({
        total: 5,
        unreadCount: 5,
        limit: 2,
        offset: 0,
        hasMore: true,
      });

      const page3 = await service.list(alice, {
        limit: 2,
        offset: 4,
        unreadOnly: false,
      });
      expect(page3.items.map((n) => n.message)).toEqual(['evt 0']);
      expect(page3.hasMore).toBe(false);
    });

    it('filters unread notifications while unreadCount stays global', async () => {
      await seed(alice, 3);
      const [newest] = await repo.listForUser(alice, {
        limit: 1,
        offset: 0,
        unreadOnly: false,
      });
      await service.markRead(alice, newest.id);

      const unread = await service.list(alice, {
        limit: 20,
        offset: 0,
        unreadOnly: true,
      });
      expect(unread.items).toHaveLength(2);
      expect(unread.items.every((n) => !n.isRead)).toBe(true);
      expect(unread.total).toBe(2);
      expect(unread.unreadCount).toBe(2);

      const all = await service.list(alice, {
        limit: 1,
        offset: 0,
        unreadOnly: false,
      });
      expect(all.total).toBe(3);
      expect(all.unreadCount).toBe(2);
    });

    it('returns an empty list for a user without notifications', async () => {
      const list = await service.list(bob, {
        limit: 20,
        offset: 0,
        unreadOnly: false,
      });
      expect(list).toEqual({
        items: [],
        unreadCount: 0,
        total: 0,
        limit: 20,
        offset: 0,
        hasMore: false,
      });
    });
  });

  describe('getUnreadCount', () => {
    it('counts only unread notifications of the caller', async () => {
      await seed(alice, 3);
      await seed(bob, 1);
      expect(await service.getUnreadCount(alice)).toEqual({ unreadCount: 3 });
    });
  });

  describe('markRead', () => {
    it('marks an owned notification read and returns the new unread count', async () => {
      await seed(alice, 2);
      const [target] = await repo.listForUser(alice, {
        limit: 1,
        offset: 0,
        unreadOnly: false,
      });

      const result = await service.markRead(alice, target.id);

      expect(result.notification).toMatchObject({
        id: target.id,
        isRead: true,
        readAt: now.toISOString(),
      });
      expect(result.unreadCount).toBe(1);
    });

    it('is idempotent and keeps the original readAt', async () => {
      await seed(alice, 1);
      const [target] = await repo.listForUser(alice, {
        limit: 1,
        offset: 0,
        unreadOnly: false,
      });
      await service.markRead(alice, target.id);

      now = new Date('2026-09-27T09:00:00.000Z');
      const again = await service.markRead(alice, target.id);

      expect(again.notification.readAt).toBe('2026-09-26T09:00:00.000Z');
      expect(again.unreadCount).toBe(0);
    });

    it("refuses to touch another user's notification", async () => {
      await seed(bob, 1);
      const [bobs] = await repo.listForUser(bob, {
        limit: 1,
        offset: 0,
        unreadOnly: false,
      });

      await expect(service.markRead(alice, bobs.id)).rejects.toBeInstanceOf(
        NotificationNotFoundException,
      );
      const [unchanged] = await repo.listForUser(bob, {
        limit: 1,
        offset: 0,
        unreadOnly: false,
      });
      expect(unchanged.isRead).toBe(false);
    });

    it('throws NOTIFICATION_NOT_FOUND for an unknown id', async () => {
      await expect(
        service.markRead(alice, '33333333-3333-4333-8333-333333333333'),
      ).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND' });
    });
  });

  describe('markAllRead', () => {
    it("marks every unread notification of the caller and leaves others' alone", async () => {
      await seed(alice, 3);
      await seed(bob, 2);

      const result = await service.markAllRead(alice);

      expect(result).toEqual({ updatedCount: 3, unreadCount: 0 });
      expect(await service.getUnreadCount(bob)).toEqual({ unreadCount: 2 });
      expect(await service.markAllRead(alice)).toEqual({
        updatedCount: 0,
        unreadCount: 0,
      });
    });
  });
});
