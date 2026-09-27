import {
  DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS,
  DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
  MAX_TIME_BARRIER_SECONDS,
  PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
  PARTICIPATION_RATE_LIMIT_POLICY_VERSION_PATTERN,
  hasDefaultParticipationRateLimitValues,
  resolveParticipationRateLimitPolicyVersion,
  TIME_BARRIER_POLICY_VERSION,
  TIME_BARRIER_SECONDS_PER_QUESTION,
  attemptTimeBarrierSchema,
  computeInternalTimeBarrier,
  countAnswerableQuestions,
  evaluateRollingWindowLimit,
  evaluateTimeBarrier,
  isAnswerableBlockType,
  participationRateLimitDetailsSchema,
  resolveExternalTimeBarrierSeconds,
  securityEvidenceSchema,
  timeBarrierRejectionDetailsSchema,
} from './bot-protection';
import { surveyAttemptResponseSchema } from './survey-attempt.schema';
import { integrityAssessmentRequestedPayloadSchema } from '../forms/internal-submission.schema';

const block = (type: string) => ({ type });

describe('Story 8.2 bot protection contract', () => {
  describe('answerable questions', () => {
    it('treats every current form block type as an answerable question', () => {
      for (const type of [
        'text',
        'textarea',
        'number',
        'single_choice',
        'multiple_choice',
        'rating',
        'linear_scale',
        'date',
        'file_upload',
      ]) {
        expect(isAnswerableBlockType(type)).toBe(true);
      }
    });

    it('excludes static/unknown blocks (sections, descriptions) from the count', () => {
      expect(isAnswerableBlockType('section')).toBe(false);
      expect(isAnswerableBlockType('description')).toBe(false);
      expect(isAnswerableBlockType(undefined)).toBe(false);
      expect(
        countAnswerableQuestions([
          block('text'),
          block('section'),
          block('rating'),
          block('description'),
          block('file_upload'),
        ]),
      ).toBe(3);
    });

    it('returns 0 for missing or empty block lists', () => {
      expect(countAnswerableQuestions(undefined)).toBe(0);
      expect(countAnswerableQuestions(null)).toBe(0);
      expect(countAnswerableQuestions([])).toBe(0);
    });
  });

  describe('computeInternalTimeBarrier', () => {
    it('requires number_of_questions x 2 seconds when that exceeds the publisher minimum', () => {
      const blocks = Array.from({ length: 12 }, () => block('single_choice'));
      const barrier = computeInternalTimeBarrier({
        blocks,
        metadata: { minTimeBarrierSeconds: 15 },
      });
      expect(barrier).toEqual({
        requiredSeconds: 24,
        questionCount: 12,
        secondsPerQuestion: TIME_BARRIER_SECONDS_PER_QUESTION,
        publisherMinimumSeconds: 15,
        policyVersion: TIME_BARRIER_POLICY_VERSION,
      });
    });

    it('keeps the publisher-configured minimum when it is stricter', () => {
      const barrier = computeInternalTimeBarrier({
        blocks: [block('text'), block('rating')],
        metadata: { minTimeBarrierSeconds: 15 },
      });
      expect(barrier.requiredSeconds).toBe(15);
      expect(barrier.questionCount).toBe(2);
    });

    it('uses the question rule alone when no publisher minimum exists', () => {
      const barrier = computeInternalTimeBarrier({
        blocks: [block('text'), block('section'), block('rating')],
      });
      expect(barrier.requiredSeconds).toBe(4);
      expect(barrier.publisherMinimumSeconds).toBe(0);
    });

    it('ignores invalid publisher minimums', () => {
      const barrier = computeInternalTimeBarrier({
        blocks: [block('text')],
        metadata: { minTimeBarrierSeconds: -5 },
      });
      expect(barrier.requiredSeconds).toBe(2);
      expect(barrier.publisherMinimumSeconds).toBe(0);
    });

    it('clamps a huge stored publisher minimum to the metadata maximum (Epic 8 review P11)', () => {
      const barrier = computeInternalTimeBarrier({
        blocks: [block('text')],
        metadata: { minTimeBarrierSeconds: 1e20 },
      });
      expect(MAX_TIME_BARRIER_SECONDS).toBe(86_400);
      expect(barrier.requiredSeconds).toBe(86_400);
      expect(barrier.publisherMinimumSeconds).toBe(86_400);
      // The clamped barrier stays representable as a Date (no RangeError).
      expect(
        evaluateTimeBarrier({
          startedAt: new Date('2026-09-26T10:00:00.000Z'),
          now: new Date('2026-09-26T10:00:05.000Z'),
          requiredSeconds: barrier.requiredSeconds,
        }).earliestSubmitAt,
      ).toBe('2026-09-27T10:00:00.000Z');
    });
  });

  describe('evaluateTimeBarrier', () => {
    const startedAt = new Date('2026-09-26T10:00:00.000Z');

    it('rejects a submission 1 ms before the barrier with the remaining seconds', () => {
      const result = evaluateTimeBarrier({
        startedAt,
        now: new Date(startedAt.getTime() + 9_999),
        requiredSeconds: 10,
      });
      expect(result.passed).toBe(false);
      expect(result.elapsedSeconds).toBe(9);
      expect(result.remainingSeconds).toBe(1);
      expect(result.earliestSubmitAt).toBe('2026-09-26T10:00:10.000Z');
    });

    it('accepts a submission at exactly the required seconds (boundary)', () => {
      const result = evaluateTimeBarrier({
        startedAt,
        now: new Date(startedAt.getTime() + 10_000),
        requiredSeconds: 10,
      });
      expect(result.passed).toBe(true);
      expect(result.elapsedSeconds).toBe(10);
      expect(result.remainingSeconds).toBe(0);
    });

    it('reports whole remaining seconds rounded up', () => {
      const result = evaluateTimeBarrier({
        startedAt: startedAt.toISOString(),
        now: new Date(startedAt.getTime() + 2_500).toISOString(),
        requiredSeconds: 10,
      });
      expect(result.passed).toBe(false);
      expect(result.elapsedSeconds).toBe(2);
      expect(result.elapsedMs).toBe(2_500);
      expect(result.remainingSeconds).toBe(8);
    });

    it('treats a start time in the future as zero elapsed', () => {
      const result = evaluateTimeBarrier({
        startedAt,
        now: new Date(startedAt.getTime() - 5_000),
        requiredSeconds: 4,
      });
      expect(result.passed).toBe(false);
      expect(result.elapsedSeconds).toBe(0);
      expect(result.remainingSeconds).toBe(4);
    });

    it('passes immediately when no barrier applies', () => {
      expect(
        evaluateTimeBarrier({ startedAt, now: startedAt, requiredSeconds: 0 })
          .passed,
      ).toBe(true);
    });
  });

  describe('resolveExternalTimeBarrierSeconds', () => {
    it('uses the configured minimum or the 15 s default', () => {
      expect(resolveExternalTimeBarrierSeconds({ minTimeBarrierSeconds: 30 })).toBe(30);
      expect(resolveExternalTimeBarrierSeconds({})).toBe(
        DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS,
      );
      expect(resolveExternalTimeBarrierSeconds(null)).toBe(15);
    });

    it('clamps a huge stored minimum to 86400 seconds (Epic 8 review P11)', () => {
      expect(resolveExternalTimeBarrierSeconds({ minTimeBarrierSeconds: 1e20 })).toBe(
        86_400,
      );
      expect(resolveExternalTimeBarrierSeconds({ minTimeBarrierSeconds: 86_400 })).toBe(
        86_400,
      );
    });
  });

  describe('evaluateRollingWindowLimit', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

    it('allows while the rolling-window count is below the limit', () => {
      const result = evaluateRollingWindowLimit({
        eventTimes: [minutesAgo(50), minutesAgo(10)],
        now,
        limit: 3,
        windowSeconds: 3600,
      });
      expect(result).toMatchObject({
        allowed: true,
        count: 2,
        retryAfterSeconds: 0,
        retryAt: null,
        anchor: null,
      });
    });

    it('ignores events that already left the window', () => {
      const result = evaluateRollingWindowLimit({
        eventTimes: [minutesAgo(61), minutesAgo(60), minutesAgo(5)],
        now,
        limit: 2,
        windowSeconds: 3600,
      });
      expect(result.allowed).toBe(true);
      expect(result.count).toBe(1);
    });

    it('blocks at the limit and retries when the oldest blocking event leaves the window', () => {
      const result = evaluateRollingWindowLimit({
        eventTimes: [minutesAgo(10), minutesAgo(40), minutesAgo(20)],
        now,
        limit: 3,
        windowSeconds: 3600,
      });
      expect(result.allowed).toBe(false);
      expect(result.count).toBe(3);
      expect(result.anchor).toBe(minutesAgo(40).toISOString());
      expect(result.retryAt).toBe(
        new Date(minutesAgo(40).getTime() + 3_600_000).toISOString(),
      );
      expect(result.retryAfterSeconds).toBe(20 * 60);
    });

    it('computes the retry time when the count overshoots the limit', () => {
      const result = evaluateRollingWindowLimit({
        eventTimes: [minutesAgo(50), minutesAgo(40), minutesAgo(30), minutesAgo(1)],
        now,
        limit: 2,
        windowSeconds: 3600,
      });
      // 4 events, limit 2: three must leave before one more fits -> the 30-minute-old one.
      expect(result.allowed).toBe(false);
      expect(result.anchor).toBe(minutesAgo(30).toISOString());
      expect(result.retryAfterSeconds).toBe(30 * 60);
    });
  });

  describe('contracts', () => {
    it('ships the provisional central policy (Open Question 16)', () => {
      expect(DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY).toEqual({
        completionLimit: 20,
        completionWindowSeconds: 3600,
        burstLimit: 10,
        burstWindowSeconds: 60,
      });
      expect(PARTICIPATION_RATE_LIMIT_POLICY_VERSION).toBe(
        'participation-rate-limit-v1',
      );
    });

    it('names the policy version stamped on evidence (decision E8-D4)', () => {
      expect(
        resolveParticipationRateLimitPolicyVersion(
          DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
        ),
      ).toBe('participation-rate-limit-v1');
      expect(
        resolveParticipationRateLimitPolicyVersion({
          policyVersion: 'participation-rate-limit-2026-10-pilot',
        }),
      ).toBe('participation-rate-limit-2026-10-pilot');

      expect(
        hasDefaultParticipationRateLimitValues(
          DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
        ),
      ).toBe(true);
      expect(
        hasDefaultParticipationRateLimitValues({
          ...DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY,
          burstLimit: 11,
        }),
      ).toBe(false);

      const pattern = PARTICIPATION_RATE_LIMIT_POLICY_VERSION_PATTERN;
      expect(pattern.test('participation-rate-limit-v2')).toBe(true);
      expect(pattern.test('rl:2026.10_pilot')).toBe(true);
      expect(pattern.test('')).toBe(false);
      expect(pattern.test('-leading-dash')).toBe(false);
      expect(pattern.test('has space')).toBe(false);
      expect(pattern.test('x'.repeat(65))).toBe(false);
    });

    it('validates time barrier rejection details', () => {
      expect(
        timeBarrierRejectionDetailsSchema.safeParse({
          requiredSeconds: 10,
          elapsedSeconds: 3,
          remainingSeconds: 7,
          retryAfterSeconds: 7,
          earliestSubmitAt: '2026-09-26T10:00:10.000Z',
          questionCount: 5,
          secondsPerQuestion: 2,
          publisherMinimumSeconds: 4,
          policyVersion: TIME_BARRIER_POLICY_VERSION,
        }).success,
      ).toBe(true);
      expect(
        timeBarrierRejectionDetailsSchema.safeParse({
          requiredSeconds: 10,
          elapsedSeconds: 3,
          remainingSeconds: 0,
          retryAfterSeconds: 0,
          earliestSubmitAt: 'soon',
          questionCount: 5,
          secondsPerQuestion: 2,
          publisherMinimumSeconds: 4,
          policyVersion: TIME_BARRIER_POLICY_VERSION,
        }).success,
      ).toBe(false);
    });

    it('validates rate limit details', () => {
      expect(
        participationRateLimitDetailsSchema.safeParse({
          scope: 'COMPLETIONS',
          limit: 20,
          windowSeconds: 3600,
          retryAfterSeconds: 120,
          retryAt: '2026-09-26T12:02:00.000Z',
          policyVersion: PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
        }).success,
      ).toBe(true);
      expect(
        participationRateLimitDetailsSchema.safeParse({
          scope: 'EVERYTHING',
          limit: 20,
          windowSeconds: 3600,
          retryAfterSeconds: 120,
          retryAt: '2026-09-26T12:02:00.000Z',
          policyVersion: PARTICIPATION_RATE_LIMIT_POLICY_VERSION,
        }).success,
      ).toBe(false);
    });

    it('lets the attempt DTO carry an optional time barrier', () => {
      const base = {
        attemptId: '11111111-1111-4111-8111-111111111111',
        responseId: null,
        formId: '22222222-2222-4222-8222-222222222222',
        formVersionId: '33333333-3333-4333-8333-333333333333',
        type: 'INTERNAL',
        status: 'IN_PROGRESS',
        startedAt: '2026-09-26T10:00:00.000Z',
        expiresAt: '2026-09-26T10:30:00.000Z',
        storageCapability: 'x'.repeat(40),
      };
      expect(surveyAttemptResponseSchema.safeParse(base).success).toBe(true);
      const timeBarrier = {
        requiredSeconds: 10,
        questionCount: 5,
        secondsPerQuestion: 2,
        earliestSubmitAt: '2026-09-26T10:00:10.000Z',
        policyVersion: TIME_BARRIER_POLICY_VERSION,
      };
      expect(attemptTimeBarrierSchema.safeParse(timeBarrier).success).toBe(true);
      expect(
        surveyAttemptResponseSchema.safeParse({ ...base, timeBarrier }).success,
      ).toBe(true);
    });

    it('lets the integrity assessment payload carry security evidence', () => {
      const securityEvidence = {
        timeBarrier: {
          policyVersion: TIME_BARRIER_POLICY_VERSION,
          requiredSeconds: 10,
          elapsedSeconds: 42,
          questionCount: 5,
        },
      };
      expect(securityEvidenceSchema.safeParse(securityEvidence).success).toBe(true);
      expect(
        integrityAssessmentRequestedPayloadSchema.safeParse({
          responseId: '11111111-1111-4111-8111-111111111111',
          attemptId: '22222222-2222-4222-8222-222222222222',
          formId: '33333333-3333-4333-8333-333333333333',
          formVersionId: '44444444-4444-4444-8444-444444444444',
          respondentId: null,
          policyMode: 'SHADOW',
          policyDeploymentId: 'policy-default-v1',
          answers: {},
          submittedAt: '2026-09-26T10:00:42.000Z',
          securityEvidence,
        }).success,
      ).toBe(true);
    });
  });
});
