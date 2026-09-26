import { listCompletionRefsForForm } from './completion-counts';

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
