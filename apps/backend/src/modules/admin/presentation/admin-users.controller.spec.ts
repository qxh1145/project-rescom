import { AdminUsersController } from './admin-users.controller';
import { UserAdminService } from '../../users/application/user-admin.service';
import { User } from '../../users/domain/user.entity';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('AdminUsersController', () => {
  let controller: AdminUsersController;
  let mockUserAdminService: jest.Mocked<Partial<UserAdminService>>;

  const adminActor: AuthenticatedUser = {
    id: 'admin-actor-id',
    email: 'admin@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
  };

  const sampleUser = new User({
    id: '123e4567-e89b-12d3-a456-426614174000',
    email: 'test@example.com',
    passwordHash: 'hash',
    role: 'RESPONDENT',
    status: 'ACTIVE',
    createdAt: new Date('2026-09-14T10:00:00.000Z'),
    updatedAt: new Date('2026-09-14T10:00:00.000Z'),
  });

  const mockReq: any = {
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'Jest-Test',
    },
  };

  beforeEach(() => {
    mockUserAdminService = {
      listUsers: jest.fn().mockResolvedValue({
        users: [sampleUser],
        total: 1,
      }),
      getUserById: jest.fn().mockResolvedValue(sampleUser),
      updateUserStatus: jest.fn().mockResolvedValue(
        new User({
          ...sampleUser,
          status: 'LOCKED',
        }),
      ),
      updateUserRole: jest.fn().mockResolvedValue(
        new User({
          ...sampleUser,
          role: 'PUBLISHER',
        }),
      ),
    };

    controller = new AdminUsersController(
      mockUserAdminService as UserAdminService,
    );
  });

  describe('listUsers', () => {
    it('should return paginated user envelope with sanitized items and computed totalPages', async () => {
      const response = await controller.listUsers({ page: 1, limit: 10 });

      expect(response.error).toBeNull();
      expect(response.data!.items).toHaveLength(1);
      expect(response.data!.items[0]).toEqual({
        id: sampleUser.id,
        email: sampleUser.email,
        role: 'RESPONDENT',
        status: 'ACTIVE',
        createdAt: '2026-09-14T10:00:00.000Z',
        updatedAt: '2026-09-14T10:00:00.000Z',
      });
      expect((response.data!.items[0] as any).passwordHash).toBeUndefined();
      expect(response.data!.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it('should return totalPages 0 when total is 0', async () => {
      (mockUserAdminService.listUsers as jest.Mock).mockResolvedValueOnce({
        users: [],
        total: 0,
      });

      const response = await controller.listUsers({ page: 1, limit: 10 });
      expect(response.data!.pagination.totalPages).toBe(0);
      expect(response.data!.items).toEqual([]);
    });
  });

  describe('getUserById', () => {
    it('should return user detail envelope without sensitive fields', async () => {
      const response = await controller.getUserById(sampleUser.id);

      expect(response.error).toBeNull();
      expect(response.data!.user).toEqual({
        id: sampleUser.id,
        email: sampleUser.email,
        role: 'RESPONDENT',
        status: 'ACTIVE',
        createdAt: '2026-09-14T10:00:00.000Z',
        updatedAt: '2026-09-14T10:00:00.000Z',
      });
      expect((response.data!.user as any).passwordHash).toBeUndefined();
    });
  });

  describe('updateUserStatus', () => {
    it('should delegate to service with actor id and audit metadata and return updated user', async () => {
      const response = await controller.updateUserStatus(
        sampleUser.id,
        { status: 'LOCKED' },
        adminActor,
        mockReq,
      );

      expect(mockUserAdminService.updateUserStatus).toHaveBeenCalledWith(
        adminActor.id,
        sampleUser.id,
        'LOCKED',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Jest-Test',
        },
      );
      expect(response.data!.user.status).toBe('LOCKED');
    });
  });

  describe('updateUserRole', () => {
    it('should delegate to service with actor id and audit metadata and return updated user', async () => {
      const response = await controller.updateUserRole(
        sampleUser.id,
        { role: 'PUBLISHER' },
        adminActor,
        mockReq,
      );

      expect(mockUserAdminService.updateUserRole).toHaveBeenCalledWith(
        adminActor.id,
        sampleUser.id,
        'PUBLISHER',
        {
          ipAddress: '127.0.0.1',
          userAgent: 'Jest-Test',
        },
      );
      expect(response.data!.user.role).toBe('PUBLISHER');
    });
  });
});
