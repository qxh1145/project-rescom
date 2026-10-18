import { AdminRewardRedriveController } from './admin-reward-redrive.controller';
import { ParticipationService } from '../application/participation.service';
import { InMemoryIdentityAuditRepository } from '../../auth/infrastructure/in-memory-identity-audit.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
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
  let audit: InMemoryIdentityAuditRepository;
  const admin: AuthenticatedUser = {
    id: '77777777-7777-4777-8777-777777777777',
    email: 'admin@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    service = {
      redriveInternalReward: jest
        .fn()
        .mockResolvedValue({ reward: settled, policyMode: 'SHADOW' }),
      redriveExternalReward: jest
        .fn()
        .mockResolvedValue({ ...settled, status: 'PENDING' }),
    };
    audit = new InMemoryIdentityAuditRepository();
    controller = new AdminRewardRedriveController(
      service as unknown as ParticipationService,
      audit,
    );
  });

  it('is Admin-only for every route (RESPONDENT/PUBLISHER get 403 from RolesGuard)', () => {
    expect(
      Reflect.getMetadata(ROLES_KEY, AdminRewardRedriveController),
    ).toEqual(['ADMIN']);
  });

  it('re-drives an Internal reward from server-side data only', async () => {
    const res = await controller.redriveInternalReward(responseId, {}, admin);

    expect(service.redriveInternalReward).toHaveBeenCalledWith(responseId);
    expect(res.data).toEqual(settled);
    expect(res.error).toBeNull();
  });

  it('re-drives an External credit from server-side data only', async () => {
    const res = await controller.redriveExternalReward(attemptId, {}, admin);

    expect(service.redriveExternalReward).toHaveBeenCalledWith(attemptId);
    expect(res.data?.status).toBe('PENDING');
  });

  it('audits an Internal re-drive once, after it succeeds (Story 14.4 D2)', async () => {
    await controller.redriveInternalReward(responseId, {}, admin);

    expect(audit.records).toEqual([
      {
        action: 'REWARD_REDRIVEN',
        userId: admin.id,
        outcome: 'SUCCESS',
        metadata: {
          kind: 'INTERNAL',
          responseId,
          status: 'SETTLED',
          journalId: 'journal-1',
          amount: 40,
        },
      },
    ]);
  });

  it('audits an External re-drive, including a null result', async () => {
    await controller.redriveExternalReward(attemptId, {}, admin);
    service.redriveExternalReward.mockResolvedValueOnce(null);
    await controller.redriveExternalReward(attemptId, {}, admin);

    expect(audit.records.map((r) => r.metadata)).toEqual([
      {
        kind: 'EXTERNAL',
        attemptId,
        status: 'PENDING',
        journalId: 'journal-1',
        amount: 40,
      },
      {
        kind: 'EXTERNAL',
        attemptId,
        status: null,
        journalId: null,
        amount: null,
      },
    ]);
  });

  it('appends no audit record when a re-drive throws', async () => {
    service.redriveInternalReward.mockRejectedValueOnce(new Error('boom'));
    service.redriveExternalReward.mockRejectedValueOnce(new Error('boom'));

    await expect(
      controller.redriveInternalReward(responseId, {}, admin),
    ).rejects.toThrow('boom');
    await expect(
      controller.redriveExternalReward(attemptId, {}, admin),
    ).rejects.toThrow('boom');

    expect(audit.records).toEqual([]);
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
