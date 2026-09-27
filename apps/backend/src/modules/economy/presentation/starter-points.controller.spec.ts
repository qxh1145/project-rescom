import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  encodeStarterPointsExpiryCursor,
  expireStarterPointsSchema,
} from '@rescom/schemas';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { StarterPointsController } from './starter-points.controller';
import { StarterPointsCoordinator } from '../application/starter-points.coordinator';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';

describe('StarterPointsController', () => {
  let controller: StarterPointsController;
  let coordinator: jest.Mocked<StarterPointsCoordinator>;

  const mockUser = {
    id: '11111111-1111-4111-8111-111111111111',
    role: 'RESPONDENT',
  };

  beforeEach(async () => {
    coordinator = {
      getStatus: jest.fn(),
      checkAndUnlockStarterPoints: jest.fn(),
      expireUnmaturedStarterPoints: jest.fn(),
      grantStarterPoints: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StarterPointsController],
      providers: [
        {
          provide: StarterPointsCoordinator,
          useValue: coordinator,
        },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<StarterPointsController>(StarterPointsController);
  });

  describe('getStatus', () => {
    it('returns starter points status for the authenticated user', async () => {
      const mockStatus = {
        userId: mockUser.id,
        isGranted: true,
        frozenBalance: 100,
        isDemographicComplete: true,
        hasCompletedMarketplaceSurvey: false,
        isUnlocked: false,
        isExpired: false,
        registeredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        daysRemaining: 25,
        unlockEligibility: {
          eligible: false,
          missingSteps: ['Complete 1 Marketplace Survey'],
        },
      };

      coordinator.getStatus.mockResolvedValue(mockStatus as any);

      const result = await controller.getStatus(mockUser as any);

      expect(coordinator.getStatus).toHaveBeenCalledWith(mockUser.id);
      expect(result).toEqual({
        data: mockStatus,
        error: null,
        meta: {},
      });
    });
  });

  describe('unlock', () => {
    it('triggers evaluation and returns unlock result', async () => {
      const mockUnlock = {
        unlocked: true,
        amount: 100,
        journalId: 'journal-uuid-1',
      };
      coordinator.checkAndUnlockStarterPoints.mockResolvedValue(mockUnlock);

      const result = await controller.unlock(mockUser as any);

      expect(coordinator.checkAndUnlockStarterPoints).toHaveBeenCalledWith(
        mockUser.id,
      );
      expect(result).toEqual({
        data: mockUnlock,
        error: null,
        meta: {},
      });
    });
  });

  describe('expire', () => {
    it('triggers batch expiry with optional cutoffDate and returns result', async () => {
      const mockExpiryResult = {
        scannedCount: 5,
        expiredCount: 2,
        expiredUserIds: ['user-1', 'user-2'],
        totalPointsVoided: 200,
        timestamp: new Date().toISOString(),
      };

      coordinator.expireUnmaturedStarterPoints.mockResolvedValue(
        mockExpiryResult as any,
      );

      const cutoff = new Date().toISOString();
      const result = await controller.expire({
        cutoffDate: cutoff,
        limit: 100,
      });

      expect(coordinator.expireUnmaturedStarterPoints).toHaveBeenCalledWith(
        new Date(cutoff),
        { limit: 100, after: undefined },
      );
      expect(result).toEqual({
        data: mockExpiryResult,
        error: null,
        meta: {},
      });
    });

    it('passes the batch size and cursor through to the coordinator', async () => {
      const after = encodeStarterPointsExpiryCursor({
        registeredAt: '2026-08-01T10:00:00.000Z',
        userId: mockUser.id,
      });
      coordinator.expireUnmaturedStarterPoints.mockResolvedValue({
        nextCursor: null,
      } as any);

      await controller.expire({ limit: 25, after });

      expect(coordinator.expireUnmaturedStarterPoints).toHaveBeenCalledWith(
        undefined,
        { limit: 25, after },
      );
    });
  });

  describe('expire request validation (ZodValidationPipe)', () => {
    const pipe = new ZodValidationPipe(expireStarterPointsSchema);
    const metadata = { type: 'body' } as const;

    it('applies the default batch size of 100', () => {
      expect(pipe.transform({}, metadata)).toEqual({ limit: 100 });
    });

    it('rejects an out-of-range batch size or a forged cursor with 400', () => {
      for (const body of [
        { limit: 0 },
        { limit: 501 },
        { after: 'not-a-cursor' },
        {
          after: Buffer.from(
            JSON.stringify({ registeredAt: 'yesterday', userId: mockUser.id }),
          ).toString('base64url'),
        },
      ]) {
        expect(() => pipe.transform(body, metadata)).toThrow(
          BadRequestException,
        );
      }
    });
  });
});
