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
  UserAdminActorNotActiveAdminException,
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
      expect(revokeSpy).toHaveBeenCalledWith('user-normal', 'ADMIN_LOCK');

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

    it('audits a concurrent duplicate lock as a changed:false no-op', async () => {
      // BE-8: both concurrent callers must themselves be active admins, so
      // this uses admin-1 for both legs instead of a non-admin actor id.
      const results = await Promise.all([
        service.updateUserStatus('admin-1', 'admin-2', 'LOCKED'),
        service.updateUserStatus('admin-1', 'admin-2', 'LOCKED'),
      ]);

      expect(results.every((user) => user.status === 'LOCKED')).toBe(true);
      expect(auditRepo.records).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            outcome: 'SUCCESS',
            metadata: expect.objectContaining({ changed: true }),
          }),
          expect.objectContaining({
            outcome: 'SUCCESS',
            metadata: expect.objectContaining({ changed: false }),
          }),
        ]),
      );
    });

    it('rolls back an in-memory transaction when audit persistence fails', async () => {
      jest
        .spyOn(auditRepo, 'append')
        .mockRejectedValueOnce(new Error('audit unavailable'));

      await expect(
        service.updateUserStatus('admin-1', 'user-normal', 'LOCKED'),
      ).rejects.toThrow('audit unavailable');
      expect((await userRepo.findById('user-normal'))?.status).toBe('ACTIVE');
      expect(auditRepo.records).toHaveLength(0);
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

    it('should reject the action if the acting admin was concurrently locked (BE-8)', async () => {
      // Simulate a concurrent lock of the acting admin's own row that lands
      // between the controller's auth check and the transaction acquiring
      // the active-admin lock.
      userRepo.save(
        new User({
          id: admin1.id,
          email: admin1.email,
          passwordHash: admin1.passwordHash,
          role: admin1.role,
          status: 'LOCKED',
          createdAt: admin1.createdAt,
          updatedAt: new Date(),
        }),
      );

      await expect(
        service.updateUserStatus('admin-1', 'user-normal', 'LOCKED'),
      ).rejects.toThrow(UserAdminActorNotActiveAdminException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          userId: 'admin-1',
          targetUserId: 'user-normal',
          outcome: 'FAILURE',
          errorCode: 'USER_ADMIN_ACTOR_NOT_ACTIVE_ADMIN',
        }),
      );

      // Target must remain untouched.
      expect((await userRepo.findById('user-normal'))?.status).toBe('ACTIVE');
    });

    it('should reject the action if the acting user no longer exists (BE-8)', async () => {
      await expect(
        service.updateUserStatus('ghost-admin', 'user-normal', 'LOCKED'),
      ).rejects.toThrow(UserAdminActorNotActiveAdminException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          userId: 'ghost-admin',
          targetUserId: 'user-normal',
          outcome: 'FAILURE',
          errorCode: 'USER_ADMIN_ACTOR_NOT_ACTIVE_ADMIN',
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
      expect(revokeSpy).toHaveBeenCalledWith('user-normal', 'ROLE_CHANGED');

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

    it('should reject the action if the acting admin was concurrently demoted (BE-8)', async () => {
      // Simulate a concurrent demotion of the acting admin's own row that
      // lands between the controller's auth check and the transaction
      // acquiring the active-admin lock.
      userRepo.save(
        new User({
          id: admin1.id,
          email: admin1.email,
          passwordHash: admin1.passwordHash,
          role: 'RESPONDENT',
          status: admin1.status,
          createdAt: admin1.createdAt,
          updatedAt: new Date(),
        }),
      );

      await expect(
        service.updateUserRole('admin-1', 'user-normal', 'PUBLISHER'),
      ).rejects.toThrow(UserAdminActorNotActiveAdminException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          userId: 'admin-1',
          targetUserId: 'user-normal',
          outcome: 'FAILURE',
          errorCode: 'USER_ADMIN_ACTOR_NOT_ACTIVE_ADMIN',
        }),
      );

      // Target must remain untouched.
      expect((await userRepo.findById('user-normal'))?.role).toBe('RESPONDENT');
    });

    it('should reject the action if the acting user no longer exists (BE-8)', async () => {
      await expect(
        service.updateUserRole('ghost-admin', 'user-normal', 'PUBLISHER'),
      ).rejects.toThrow(UserAdminActorNotActiveAdminException);

      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_ROLE_CHANGED',
          userId: 'ghost-admin',
          targetUserId: 'user-normal',
          outcome: 'FAILURE',
          errorCode: 'USER_ADMIN_ACTOR_NOT_ACTIVE_ADMIN',
        }),
      );
    });
  });

  describe('findLockReasons (mock-off plan 4.6)', () => {
    it('returns the reason of the latest effective lock of LOCKED users only', async () => {
      service = new UserAdminService(
        userRepo,
        transactionAdapter,
        auditRepo,
        auditRepo,
      );
      const locked = await service.updateUserStatus(
        admin1.id,
        normalUser.id,
        'LOCKED',
        { reason: 'Vi phạm lặp lại: nộp quá nhanh' },
      );
      // A no-op re-lock with another reason does not replace it.
      await service.updateUserStatus(admin1.id, normalUser.id, 'LOCKED', {
        reason: 'Lý do khác, không áp dụng',
      });

      const reasons = await service.findLockReasons([locked, admin2]);
      expect([...reasons]).toEqual([
        [normalUser.id, 'Vi phạm lặp lại: nộp quá nhanh'],
      ]);

      // Unlocking then locking without a reason leaves no reason.
      await service.updateUserStatus(admin1.id, normalUser.id, 'ACTIVE');
      const relocked = await service.updateUserStatus(
        admin1.id,
        normalUser.id,
        'LOCKED',
      );
      expect((await service.findLockReasons([relocked])).size).toBe(0);
    });

    it('reads nothing without a reader or without a locked user', async () => {
      const findLatestLockReasons = jest.fn();
      const withReader = new UserAdminService(
        userRepo,
        transactionAdapter,
        auditRepo,
        { findLatestLockReasons },
      );
      expect((await withReader.findLockReasons([admin1, admin2])).size).toBe(0);
      expect(findLatestLockReasons).not.toHaveBeenCalled();

      const lockedUser = new User({ ...normalUser, status: 'LOCKED' });
      expect((await service.findLockReasons([lockedUser])).size).toBe(0);
    });
  });

  describe('Story IR.4b B3: ACCOUNT_LOCKED / ACCOUNT_UNLOCKED notices', () => {
    let publisher: { publish: jest.Mock };
    let ids: number;

    beforeEach(() => {
      publisher = { publish: jest.fn().mockResolvedValue('CREATED') };
      ids = 0;
      service = new UserAdminService(
        userRepo,
        transactionAdapter,
        auditRepo,
        undefined,
        publisher,
        () => `change-${++ids}`,
      );
    });

    it('publishes once per effective change, with the change id shared by the audit row', async () => {
      await service.updateUserStatus('admin-1', 'user-normal', 'LOCKED');
      await service.updateUserStatus('admin-1', 'user-normal', 'ACTIVE');

      expect(publisher.publish).toHaveBeenCalledTimes(2);
      expect(publisher.publish).toHaveBeenNthCalledWith(1, {
        userId: 'user-normal',
        type: 'ACCOUNT_LOCKED',
        message: expect.any(String),
        dedupeKey: 'account-status:user-normal:change-1',
      });
      expect(publisher.publish).toHaveBeenNthCalledWith(2, {
        userId: 'user-normal',
        type: 'ACCOUNT_UNLOCKED',
        message: expect.any(String),
        dedupeKey: 'account-status:user-normal:change-2',
      });
      expect(auditRepo.records).toContainEqual(
        expect.objectContaining({
          action: 'USER_STATUS_CHANGED',
          metadata: expect.objectContaining({
            changed: true,
            changeId: 'change-1',
            newStatus: 'LOCKED',
          }),
        }),
      );
    });

    it('publishes nothing for a same-status no-op or a refused change', async () => {
      await service.updateUserStatus('admin-1', 'user-normal', 'ACTIVE');
      await expect(
        service.updateUserStatus('admin-1', 'admin-1', 'LOCKED'),
      ).rejects.toThrow(CannotLockSelfException);
      await service.updateUserRole('admin-1', 'user-normal', 'PUBLISHER');
      expect(publisher.publish).not.toHaveBeenCalled();
    });

    it('keeps the result when publishing fails', async () => {
      publisher.publish.mockRejectedValueOnce(new Error('down'));
      const result = await service.updateUserStatus(
        'admin-1',
        'user-normal',
        'LOCKED',
      );
      expect(result.status).toBe('LOCKED');
    });
  });
});
