import { TIME_BARRIER_POLICY_VERSION } from '@rescom/schemas';
import { FormEntity } from '../../forms/domain/form.entity';
import { FormVersionEntity } from '../../forms/domain/form-version.entity';
import {
  describeAttemptTimeBarrier,
  findPinnedVersion,
  resolveTimeBarrier,
} from './attempt-projection';

/**
 * Story IR.2a: the helpers extracted from `ParticipationService` keep the
 * Story 8.2 rules, so the start response and `GET /attempts/:id` agree.
 */
describe('attempt projection helpers', () => {
  const formId = '11111111-1111-4111-8111-111111111111';
  const block = (id: string, order: number) => ({
    id,
    order,
    type: 'text' as const,
    title: `Q ${id}`,
    required: true,
  });

  function version(
    id: string,
    versionNumber: number,
    schemaJson: unknown,
  ): FormVersionEntity {
    return new FormVersionEntity(
      id,
      formId,
      versionNumber,
      schemaJson as any,
      null,
      true,
      null,
      null,
      new Date(),
      new Date(),
    );
  }

  const form = new FormEntity(
    formId,
    '22222222-2222-4222-8222-222222222222',
    'INTERNAL',
    'PUBLISHED',
    'Survey',
    null,
    10,
    50,
    new Date(),
    new Date(),
  );

  it('finds the pinned version among all versions, else only the current one', () => {
    const v1 = version('v1', 1, { blocks: [] });
    const v2 = version('v2', 2, { blocks: [] });
    expect(
      findPinnedVersion({ form, currentVersion: v2, versions: [v2, v1] }, 'v1'),
    ).toBe(v1);
    expect(findPinnedVersion({ form, currentVersion: v2 }, 'v2')).toBe(v2);
    expect(findPinnedVersion({ form, currentVersion: v2 }, 'v1')).toBeNull();
  });

  it('Internal: max(answerable questions x 2 s, publisher minimum)', () => {
    const fewQuestions = version('v1', 1, {
      title: 'S',
      blocks: [block('q1', 0), block('q2', 1)],
      metadata: { expectedEffortSeconds: 120, minTimeBarrierSeconds: 30 },
    });
    expect(resolveTimeBarrier('INTERNAL', fewQuestions)).toEqual({
      requiredSeconds: 30,
      questionCount: 2,
      secondsPerQuestion: 2,
      publisherMinimumSeconds: 30,
      policyVersion: TIME_BARRIER_POLICY_VERSION,
    });

    const manyQuestions = version('v2', 2, {
      title: 'S',
      blocks: Array.from({ length: 20 }, (_, i) => block(`q${i}`, i)),
      metadata: { expectedEffortSeconds: 120, minTimeBarrierSeconds: 15 },
    });
    expect(resolveTimeBarrier('INTERNAL', manyQuestions).requiredSeconds).toBe(
      40,
    );
  });

  it('External: the publisher minimum, else 15 s, without a question count', () => {
    const withMinimum = version('v1', 1, {
      title: 'S',
      blocks: [],
      metadata: { expectedEffortSeconds: 300, minTimeBarrierSeconds: 90 },
    });
    expect(resolveTimeBarrier('EXTERNAL', withMinimum)).toEqual({
      requiredSeconds: 90,
      questionCount: null,
      secondsPerQuestion: null,
      publisherMinimumSeconds: 90,
      policyVersion: TIME_BARRIER_POLICY_VERSION,
    });
    expect(
      resolveTimeBarrier('EXTERNAL', version('v2', 2, null)).requiredSeconds,
    ).toBe(15);
  });

  it('announces the earliest submit time from the server start', () => {
    const startedAt = new Date('2026-10-01T08:00:00.000Z');
    expect(
      describeAttemptTimeBarrier(
        {
          requiredSeconds: 42,
          questionCount: 21,
          secondsPerQuestion: 2,
          publisherMinimumSeconds: 15,
          policyVersion: TIME_BARRIER_POLICY_VERSION,
        },
        startedAt,
      ),
    ).toEqual({
      requiredSeconds: 42,
      questionCount: 21,
      secondsPerQuestion: 2,
      earliestSubmitAt: '2026-10-01T08:00:42.000Z',
      policyVersion: TIME_BARRIER_POLICY_VERSION,
    });
  });
});
