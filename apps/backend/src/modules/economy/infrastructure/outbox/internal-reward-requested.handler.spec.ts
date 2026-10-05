import {
  OutboxEnvelope,
  OutboxPayloadInvalidError,
} from '../../../../common/scheduler/outbox/outbox-handler';
import { InternalRewardRequestedHandler } from './internal-reward-requested.handler';

describe('InternalRewardRequestedHandler (Story IR.2b Task 5)', () => {
  const payload = {
    responseId: '11111111-1111-4111-8111-111111111111',
    attemptId: '22222222-2222-4222-8222-222222222222',
    formId: '33333333-3333-4333-8333-333333333333',
    formVersionId: '44444444-4444-4444-8444-444444444444',
    publisherId: '55555555-5555-4555-8555-555555555555',
    respondentId: '66666666-6666-4666-8666-666666666666',
    rewardAmount: 50,
    policyMode: 'SHADOW',
    policyDeploymentId: 'policy-default-v1',
    submittedAt: '2026-10-01T00:00:00.000Z',
  };
  const event = (p: unknown = payload) =>
    ({ eventType: 'InternalRewardRequested', payload: p }) as OutboxEnvelope;

  function setup(opts: {
    settlement?: unknown;
    response?: { status: string } | null;
  }) {
    const coordinator = {
      findInternalSettlement: jest
        .fn()
        .mockResolvedValue(opts.settlement ?? null),
      settleInternalReward: jest.fn().mockResolvedValue(undefined),
    };
    const responses = {
      findResponseById: jest
        .fn()
        .mockResolvedValue(
          opts.response === undefined ? { status: 'SUBMITTED' } : opts.response,
        ),
    };
    return {
      coordinator,
      handler: new InternalRewardRequestedHandler(
        coordinator as never,
        responses,
      ),
    };
  }

  it('rejects an invalid payload', async () => {
    const { handler, coordinator } = setup({});
    await expect(handler.handle(event({ responseId: 'x' }))).rejects.toThrow(
      OutboxPayloadInvalidError,
    );
    expect(coordinator.settleInternalReward).not.toHaveBeenCalled();
  });

  it('is a no-op when the settlement already exists', async () => {
    const { handler, coordinator } = setup({ settlement: { id: 'j' } });
    await handler.handle(event());
    expect(coordinator.settleInternalReward).not.toHaveBeenCalled();
  });

  it.each([null, { status: 'REJECTED' }, { status: 'DISPUTED' }])(
    'does not settle for response %j',
    async (response) => {
      const { handler, coordinator } = setup({ response });
      await handler.handle(event());
      expect(coordinator.settleInternalReward).not.toHaveBeenCalled();
    },
  );

  it.each(['SUBMITTED', 'VALIDATED'])(
    'settles a %s response with the payload fields',
    async (status) => {
      const { handler, coordinator } = setup({ response: { status } });
      await handler.handle(event());
      expect(coordinator.settleInternalReward).toHaveBeenCalledWith({
        responseId: payload.responseId,
        publisherId: payload.publisherId,
        respondentId: payload.respondentId,
        rewardPerResponse: 50,
        policyMode: 'SHADOW',
      });
    },
  );
});
