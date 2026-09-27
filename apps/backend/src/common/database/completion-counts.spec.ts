import {
  listCompletionRefsByFormIds,
  listCompletionRefsForForm,
} from './completion-counts';

describe('listCompletionRefsForForm (Epic 6 review P4)', () => {
  const formId = '11111111-1111-4111-8111-111111111111';

  function fakeClient() {
    return {
      response: {
        groupBy: jest.fn().mockResolvedValue([{ formId, _count: { _all: 3 } }]),
        findMany: jest.fn().mockResolvedValue([
          { id: 'r-validated', status: 'VALIDATED' },
          { id: 'r-submitted', status: 'SUBMITTED' },
          { id: 'r-rejected', status: 'REJECTED' },
        ]),
      },
      surveyAttempt: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ surveyId: formId, _count: { _all: 2 } }]),
        findMany: jest.fn().mockResolvedValue([{ id: 'a-1' }, { id: 'a-2' }]),
      },
    };
  }

  it('uses the quota count (guests included) and lists the settleable completions', async () => {
    const client = fakeClient();

    const refs = await listCompletionRefsForForm(client as any, formId);

    expect(refs).toEqual({
      completedCount: 5,
      internalResponses: [
        { id: 'r-validated', rewardable: true },
        { id: 'r-submitted', rewardable: true },
        { id: 'r-rejected', rewardable: false },
      ],
      externalAttemptIds: ['a-1', 'a-2'],
    });
    // Guests are never paid, so only non-guest responses are listed.
    expect(client.response.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        formId,
        isGuest: false,
        respondentId: { not: null },
      }),
      select: { id: true, status: true },
    });
    // External completions have no Response row (same rule as the quota).
    expect(client.surveyAttempt.findMany).toHaveBeenCalledWith({
      where: { surveyId: formId, status: 'COMPLETED', response: null },
      select: { id: true },
    });
  });
});

describe('listCompletionRefsByFormIds (Phase 5 M-1)', () => {
  const formA = '11111111-1111-4111-8111-111111111111';
  const formB = '22222222-2222-4222-8222-222222222222';
  const formC = '33333333-3333-4333-8333-333333333333';

  it("groups the page's completions per form in constant reads, with every form present", async () => {
    const client = {
      response: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ formId: formA, _count: { _all: 2 } }]),
        findMany: jest.fn().mockResolvedValue([
          { id: 'r-1', status: 'VALIDATED', formId: formA },
          { id: 'r-2', status: 'DISPUTED', formId: formA },
          { id: 'r-3', status: 'SUBMITTED', formId: formB },
        ]),
      },
      surveyAttempt: {
        groupBy: jest
          .fn()
          .mockResolvedValue([{ surveyId: formB, _count: { _all: 1 } }]),
        findMany: jest.fn().mockResolvedValue([{ id: 'a-1', surveyId: formB }]),
      },
    };

    const refs = await listCompletionRefsByFormIds(client as any, [
      formA,
      formB,
      formC,
    ]);

    expect(refs.get(formA)).toEqual({
      completedCount: 2,
      internalResponses: [
        { id: 'r-1', rewardable: true },
        { id: 'r-2', rewardable: false },
      ],
      externalAttemptIds: [],
    });
    expect(refs.get(formB)).toEqual({
      completedCount: 1,
      internalResponses: [{ id: 'r-3', rewardable: true }],
      externalAttemptIds: ['a-1'],
    });
    expect(refs.get(formC)).toEqual({
      completedCount: 0,
      internalResponses: [],
      externalAttemptIds: [],
    });
    expect(client.response.findMany).toHaveBeenCalledTimes(1);
    expect(client.response.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        formId: { in: [formA, formB, formC] },
        isGuest: false,
        respondentId: { not: null },
      }),
      select: { id: true, status: true, formId: true },
    });
    expect(client.surveyAttempt.findMany).toHaveBeenCalledWith({
      where: {
        surveyId: { in: [formA, formB, formC] },
        status: 'COMPLETED',
        response: null,
      },
      select: { id: true, surveyId: true },
    });
  });

  it('reads nothing for an empty page', async () => {
    const client = {
      response: { groupBy: jest.fn(), findMany: jest.fn() },
      surveyAttempt: { groupBy: jest.fn(), findMany: jest.fn() },
    };
    expect(await listCompletionRefsByFormIds(client as any, [])).toEqual(
      new Map(),
    );
    expect(client.response.findMany).not.toHaveBeenCalled();
  });
});
