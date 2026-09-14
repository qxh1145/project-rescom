import { UserAdminService } from './user-admin.service';
import { InMemoryUserRepository } from '../infrastructure/in-memory-user.repository';
import { InMemoryUserAdminTransactionAdapter } from '../infrastructure/in-memory-user-admin-transaction.adapter';
import { InMemorySessionRepository } from '../../auth/infrastructure/in-memory-session.repository';
import { InMemoryIdentityAuditRepository } from '../../auth/infrastructure/in-memory-identity-audit.repository';
import { User } from '../domain/user.entity';
import {
  UserNotFoundException,
  CannotLockSelfException,
  CannotLockLastAdminException,
  CannotDemoteSelfException,
  CannotDemoteLastAdminException,
} from './exceptions/user-admin.exceptions';

describe('UserAdminService', () => {
  let service: UserAdminService;
  let userRepo: InMemoryUserRepository;
  let sessionRepo: InMemorySessionRepository;
  let auditRepo: InMemoryIdentityAuditRepository;
  let transactionAdapter: InMemoryUserAdminTransactionAdapter;

  const admin1 = new User({
    id: 'admin-1',
    email: 'admin1@example.com',
    passwordHash: 'hash',
    role: 'ADMIN',
    status: 'ACTIVE',
  });

  const admin2 = new User({
    id: 'admin-2',
    email: 'admin2@example.com',
    passwordHash: 'hash',
    role: 'ADMIN',
    status: 'ACTIVE',
  });

  const normalUser = new User({
    id: 'user-normal',
    email: 'normal@example.com',
    passwordHash: 'hash',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  });

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();
    auditRepo = new InMemoryIdentityAuditRepository();
    sessionRepo = new InMemorySessionRepository(auditRepo);
    transactionAdapter = new InMemoryUserAdminTransactionAdapter(
      userRepo,
      sessionRepo,
      auditRepo,
    );
    service = new UserAdminService(userRepo, transactionAdapter, auditRepo);

    userRepo.save(admin1);
    userRepo.save(admin2);
    userRepo.save(normalUser);
  });

  describe('listUsers', () => {
    it('should return paginated list of users', async () => {
      const result = await service.listUsers({ page: 1, limit: 10 });
      expect(result.total).toBe(3);
      expect(result.users).toHaveLength(3);
    });

    it('should filter by search and role', async () => {
      const result = await service.listUsers({
        page: 1,
        limit: 10,
        search: 'admin1',
        role: 'ADMIN',
      });
      expect(result.total).toBe(1);
      expect(result.users[0].id).toBe('admin-1');
    });
  });

  describe('getUserById', () => {
    it('should return user by id', async () => {
      const user = await service.getUserById('admin-1');
      expect(user.id).toBe('admin-1');
    });

    it('should throw UserNotFoundException if user does not exist', async () => {
      await expect(service.getUserById('unknown-id')).rejects.toThrow(
        UserNotFoundException,
      );
    });
  });

  describe('updateUserStatus', () => {
    it('should prevent self-locking and log failure audit', async () => {
      await expect(
        service.updateUserStatus('admin-1', 'admin-1', 'LOCKED'),
      ).rejects.toThrow(CannotLockSelfException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          userId: 'admin-1',
          targetUserId: 'admin-1',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_LOCK_SELF',
        }),
      );
    });

    it('should throw UserNotFoundException if target does not exist', async () => {
      await expect(
        service.updateUserStatus('admin-1', 'missing-user', 'LOCKED'),
      ).rejects.toThrow(UserNotFoundException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          userId: 'admin-1',
          targetUserId: 'missing-user',
          outcome: 'FAILURE',
          errorCode: 'USER_NOT_FOUND',
        }),
      );
    });

    it('should treat identical status update as a no-op with audit', async () => {
      const result = await service.updateUserStatus(
        'admin-1',
        'user-normal',
        'ACTIVE',
      );
      expect(result.status).toBe('ACTIVE');

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          userId: 'admin-1',
          targetUserId: 'user-normal',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({ noOp: true }),
        }),
      );
    });

    it('should lock normal user successfully, revoke sessions, and audit', async () => {
      const revokeSpy = jest.spyOn(sessionRepo, 'revokeAllByUserId');

      const result = await service.updateUserStatus(
        'admin-1',
        'user-normal',
        'LOCKED',
      );
      expect(result.status).toBe('LOCKED');
      expect(revokeSpy).toHaveBeenCalledWith('user-normal');

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          userId: 'admin-1',
          targetUserId: 'user-normal',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({
            previousStatus: 'ACTIVE',
            newStatus: 'LOCKED',
          }),
        }),
      );
    });

    it('should allow locking an admin when at least one other active admin remains', async () => {
      const result = await service.updateUserStatus(
        'admin-1',
        'admin-2',
        'LOCKED',
      );
      expect(result.status).toBe('LOCKED');

      const remainingActiveAdmins = await userRepo.countByRoleAndStatus(
        'ADMIN',
        'ACTIVE',
      );
      expect(remainingActiveAdmins).toBe(1);
    });

    it('should reject locking the last remaining active admin', async () => {
      // First lock admin-2 -> only admin-1 is left
      await service.updateUserStatus('admin-1', 'admin-2', 'LOCKED');

      // Now attempt by a hypothetical actor to lock admin-1
      await expect(
        service.updateUserStatus('admin-2', 'admin-1', 'LOCKED'),
      ).rejects.toThrow(CannotLockLastAdminException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          userId: 'admin-2',
          targetUserId: 'admin-1',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_LOCK_LAST_ADMIN',
        }),
      );
    });
  });

  describe('updateUserRole', () => {
    it('should prevent self-demotion and log failure audit', async () => {
      await expect(
        service.updateUserRole('admin-1', 'admin-1', 'RESPONDENT'),
      ).rejects.toThrow(CannotDemoteSelfException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          userId: 'admin-1',
          targetUserId: 'admin-1',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_DEMOTE_SELF',
        }),
      );
    });

    it('should allow self-assignment to ADMIN (no demotion)', async () => {
      const result = await service.updateUserRole(
        'admin-1',
        'admin-1',
        'ADMIN',
      );
      expect(result.role).toBe('ADMIN');
    });

    it('should throw UserNotFoundException if target does not exist', async () => {
      await expect(
        service.updateUserRole('admin-1', 'missing-user', 'ADMIN'),
      ).rejects.toThrow(UserNotFoundException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          userId: 'admin-1',
          targetUserId: 'missing-user',
          outcome: 'FAILURE',
          errorCode: 'USER_NOT_FOUND',
        }),
      );
    });

    it('should treat identical role update as a no-op with audit', async () => {
      const result = await service.updateUserRole(
        'admin-1',
        'user-normal',
        'RESPONDENT',
      );
      expect(result.role).toBe('RESPONDENT');

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          userId: 'admin-1',
          targetUserId: 'user-normal',
          outcome: 'SUCCESS',
          metadata: expect.objectContaining({ noOp: true }),
        }),
      );
    });

    it('should promote normal user to PUBLISHER and revoke sessions', async () => {
      const revokeSpy = jest.spyOn(sessionRepo, 'revokeAllByUserId');

      const result = await service.updateUserRole(
        'admin-1',
        'user-normal',
        'PUBLISHER',
      );
      expect(result.role).toBe('PUBLISHER');
      expect(revokeSpy).toHaveBeenCalledWith('user-normal');

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          userId: 'admin-1',
          targetUserId: 'user-normal',
          outcome: 'SUCCESS',
        }),
      );
    });

    it('should allow demoting an admin when at least one other active admin remains', async () => {
      const result = await service.updateUserRole(
        'admin-1',
        'admin-2',
        'RESPONDENT',
      );
      expect(result.role).toBe('RESPONDENT');

      const remainingActiveAdmins = await userRepo.countByRoleAndStatus(
        'ADMIN',
        'ACTIVE',
      );
      expect(remainingActiveAdmins).toBe(1);
    });

    it('should reject demoting the last remaining active admin', async () => {
      // Demote admin-2 -> only admin-1 is left
      await service.updateUserRole('admin-1', 'admin-2', 'RESPONDENT');

      // Attempt to demote admin-1
      await expect(
        service.updateUserRole('admin-2', 'admin-1', 'RESPONDENT'),
      ).rejects.toThrow(CannotDemoteLastAdminException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          userId: 'admin-2',
          targetUserId: 'admin-1',
          outcome: 'FAILURE',
          errorCode: 'CANNOT_DEMOTE_LAST_ADMIN',
        }),
      );
    });

    it('should allow demoting a locked admin because they are not active', async () => {
      // First lock admin-2
      await service.updateUserStatus('admin-1', 'admin-2', 'LOCKED');

      // Now demoting admin-2 does not violate active admin count (since admin-2 was already locked)
      const result = await service.updateUserRole(
        'admin-1',
        'admin-2',
        'RESPONDENT',
      );
      expect(result.role).toBe('RESPONDENT');
    });
  });
});
