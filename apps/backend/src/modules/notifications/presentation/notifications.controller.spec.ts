import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from '../application/notifications.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';

describe('Story 9.6: NotificationsController', () => {
  let controller: NotificationsController;
  let service: jest.Mocked<
    Pick<
      NotificationsService,
      'list' | 'getUnreadCount' | 'markRead' | 'markAllRead'
    >
  >;

  const user = { id: '11111111-1111-4111-8111-111111111111' } as any;
  const notificationId = '22222222-2222-4222-8222-222222222222';
  const dto = {
    id: notificationId,
    type: 'REWARD_RELEASED' as const,
    message: '+20 points released.',
    isRead: false,
    createdAt: '2026-09-26T09:00:00.000Z',
    readAt: null,
  };

  beforeEach(async () => {
    service = {
      list: jest.fn(),
      getUnreadCount: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(NotificationsController);
  });

  it('lists the caller notifications in a success envelope', async () => {
    const list = {
      items: [dto],
      unreadCount: 1,
      total: 1,
      limit: 20,
      offset: 0,
      hasMore: false,
    };
    service.list.mockResolvedValue(list);
    const query = { limit: 20, offset: 0, unreadOnly: false };

    await expect(controller.list(user, query)).resolves.toEqual({
      data: list,
      error: null,
      meta: {},
    });
    expect(service.list).toHaveBeenCalledWith(user.id, query);
  });

  it('returns the unread count for the caller', async () => {
    service.getUnreadCount.mockResolvedValue({ unreadCount: 4 });

    await expect(controller.unreadCount(user)).resolves.toEqual({
      data: { unreadCount: 4 },
      error: null,
      meta: {},
    });
    expect(service.getUnreadCount).toHaveBeenCalledWith(user.id);
  });

  it('marks one notification read on behalf of the caller only', async () => {
    const result = {
      notification: { ...dto, isRead: true, readAt: dto.createdAt },
      unreadCount: 0,
    };
    service.markRead.mockResolvedValue(result);

    await expect(controller.markRead(user, notificationId)).resolves.toEqual({
      data: result,
      error: null,
      meta: {},
    });
    expect(service.markRead).toHaveBeenCalledWith(user.id, notificationId);
  });

  it('marks all notifications of the caller read', async () => {
    service.markAllRead.mockResolvedValue({ updatedCount: 2, unreadCount: 0 });

    await expect(controller.markAllRead(user)).resolves.toEqual({
      data: { updatedCount: 2, unreadCount: 0 },
      error: null,
      meta: {},
    });
    expect(service.markAllRead).toHaveBeenCalledWith(user.id);
  });

  it('protects mutations with CsrfGuard and the class with SessionAuthGuard', () => {
    const classGuards = Reflect.getMetadata(
      '__guards__',
      NotificationsController,
    );
    expect(classGuards).toContain(SessionAuthGuard);
    for (const method of ['markRead', 'markAllRead'] as const) {
      const guards = Reflect.getMetadata(
        '__guards__',
        NotificationsController.prototype[method],
      );
      expect(guards).toContain(CsrfGuard);
    }
  });
});
