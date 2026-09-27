import { AdminRewardRedriveController } from './admin-reward-redrive.controller';
import { ParticipationService } from '../application/participation.service';
import { ROLES_KEY } from '../../auth/presentation/decorators/roles.decorator';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { rewardRedriveRequestSchema } from '@rescom/schemas';

describe('AdminRewardRedriveController (Epic 6 review P1)', () => {
  const responseId = '11111111-1111-4111-8111-111111111111';
  const attemptId = '22222222-2222-4222-8222-222222222222';
  const settled = {
    status: 'SETTLED' as const,
    journalId: 'journal-1',
    amount: 40,
    targetAccountClass: 'USER_AVAILABLE' as const,
    settledAt: new Date().toISOString(),
  };

  let service: jest.Mocked<
    Pick<
      ParticipationService,
      'redriveInternalReward' | 'redriveExternalReward'
    >
  >;
  let controller: AdminRewardRedriveController;

  beforeEach(() => {
    service = {
      redriveInternalReward: jest
        .fn()
        .mockResolvedValue({ reward: settled, policyMode: 'SHADOW' }),
      redriveExternalReward: jest
        .fn()
        .mockResolvedValue({ ...settled, status: 'PENDING' }),
    };
    controller = new AdminRewardRedriveController(
      service as unknown as ParticipationService,
    );
  });

  it('is Admin-only for every route (RESPONDENT/PUBLISHER get 403 from RolesGuard)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminRewardRedriveController),
    ).toEqual(['ADMIN']);
  });

  it('re-drives an Internal reward from server-side data only', async () => {
    const res = await controller.redriveInternalReward(responseId, {});

    expect(service.redriveInternalReward).toHaveBeenCalledWith(responseId);
    expect(res.data).toEqual(settled);
    expect(res.error).toBeNull();
  });

  it('re-drives an External credit from server-side data only', async () => {
    const res = await controller.redriveExternalReward(attemptId, {});

    expect(service.redriveExternalReward).toHaveBeenCalledWith(attemptId);
    expect(res.data?.status).toBe('PENDING');
  });

  it('rejects any settlement parameter in the body', () => {
    const pipe = new ZodValidationPipe(rewardRedriveRequestSchema);

    expect(() =>
      pipe.transform(
        { publisherId: 'x', rewardPerResponse: 1000 },
        { type: 'body' },
      ),
    ).toThrow();
    expect(pipe.transform({}, { type: 'body' })).toEqual({});
  });
});
