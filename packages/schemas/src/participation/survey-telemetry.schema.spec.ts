import {
  integrityEventTypeEnum,
  telemetryEventItemSchema,
  batchTelemetryEventsInputSchema,
  TelemetryEventItem,
  BatchTelemetryEventsInput,
} from './survey-telemetry.schema';

describe('Survey Telemetry Schemas', () => {
  const attemptId = '11111111-1111-4111-8111-111111111111';
  const formVersionId = '22222222-2222-4222-8222-222222222222';
  const responseId = '33333333-3333-4333-8333-333333333333';
  const clientEventId = '44444444-4444-4444-8444-444444444444';

  describe('integrityEventTypeEnum', () => {
    it('should validate allowed integrity event types', () => {
      const allowed = [
        'SURVEY_ATTEMPT_STARTED',
        'SURVEY_ATTEMPT_RESUMED',
        'SURVEY_ATTEMPT_ABANDONED',
        'SURVEY_SUBMITTED',
        'QUESTION_SHOWN',
        'QUESTION_FOCUSED',
        'QUESTION_BLURRED',
        'ANSWER_SELECTED',
        'ANSWER_ENTERED',
        'ANSWER_CHANGED',
        'ANSWER_CLEARED',
        'QUESTION_SKIPPED',
        'QUESTION_RETURNED',
        'PAGE_HIDDEN',
        'PAGE_VISIBLE',
        'ATTENTION_CHECK_PASSED',
        'ATTENTION_CHECK_FAILED',
        'TIME_BARRIER_TRIGGERED',
      ];

      for (const type of allowed) {
        expect(integrityEventTypeEnum.safeParse(type).success).toBe(true);
      }
    });

    it('should reject unknown event types', () => {
      expect(integrityEventTypeEnum.safeParse('KEYSTROKE_LOGGER').success).toBe(false);
      expect(integrityEventTypeEnum.safeParse('CLIPBOARD_COPY').success).toBe(false);
    });
  });

  describe('telemetryEventItemSchema', () => {
    it('should validate a valid telemetry event item', () => {
      const validEvent: TelemetryEventItem = {
        clientEventId,
        eventType: 'QUESTION_SHOWN',
        attemptId,
        formVersionId,
        responseId,
        questionId: 'block-q1',
        sequence: 1,
        occurredAt: new Date().toISOString(),
        metadata: {
          dwellTimeMs: 1500,
          viewport: 'desktop',
        },
      };

      const result = telemetryEventItemSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('should validate an event without responseId (e.g. before internal response creation or guest)', () => {
      const validEvent = {
        clientEventId,
        eventType: 'QUESTION_FOCUSED',
        attemptId,
        formVersionId,
        occurredAt: new Date().toISOString(),
      };

      const result = telemetryEventItemSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      const invalidEvent = {
        clientEventId: 'not-a-uuid',
        eventType: 'QUESTION_SHOWN',
        attemptId,
        formVersionId,
        occurredAt: new Date().toISOString(),
      };

      const result = telemetryEventItemSchema.safeParse(invalidEvent);
      expect(result.success).toBe(false);
    });

    it('should enforce privacy guardrails by rejecting prohibited metadata keys (keystroke, clipboard, rawInput)', () => {
      const privacyViolationEvent = {
        clientEventId,
        eventType: 'ANSWER_ENTERED',
        attemptId,
        formVersionId,
        occurredAt: new Date().toISOString(),
        metadata: {
          keystrokes: 'User typed text here',
        },
      };

      const result = telemetryEventItemSchema.safeParse(privacyViolationEvent);
      expect(result.success).toBe(false);
    });

    it('should reject clipboard tracking in metadata', () => {
      const privacyViolationEvent = {
        clientEventId,
        eventType: 'ANSWER_CHANGED',
        attemptId,
        formVersionId,
        occurredAt: new Date().toISOString(),
        metadata: {
          clipboardText: 'pasted text',
        },
      };

      const result = telemetryEventItemSchema.safeParse(privacyViolationEvent);
      expect(result.success).toBe(false);
    });
  });

  describe('batchTelemetryEventsInputSchema', () => {
    it('should validate a valid batch of events', () => {
      const payload: BatchTelemetryEventsInput = {
        events: [
          {
            clientEventId,
            eventType: 'QUESTION_SHOWN',
            attemptId,
            formVersionId,
            occurredAt: new Date().toISOString(),
          },
        ],
        consentNoticeVersion: 'v1.0',
      };

      const result = batchTelemetryEventsInputSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('should reject an empty events array', () => {
      const emptyPayload = {
        events: [],
      };

      const result = batchTelemetryEventsInputSchema.safeParse(emptyPayload);
      expect(result.success).toBe(false);
    });

    it('should reject batches exceeding 100 events', () => {
      const tooManyEvents = Array.from({ length: 101 }, (_, idx) => ({
        clientEventId: `11111111-1111-4111-8111-${String(idx).padStart(12, '0')}`,
        eventType: 'QUESTION_SHOWN' as const,
        attemptId,
        formVersionId,
        occurredAt: new Date().toISOString(),
      }));

      const result = batchTelemetryEventsInputSchema.safeParse({ events: tooManyEvents });
      expect(result.success).toBe(false);
    });

    it('accepts consentNoticeVersion as a label or a positive integer (IntegrityConsent.noticeVersion)', () => {
      const events = [
        {
          clientEventId,
          eventType: 'QUESTION_SHOWN' as const,
          attemptId,
          formVersionId,
          occurredAt: new Date().toISOString(),
        },
      ];
      for (const consentNoticeVersion of ['v1.0', 1, 42]) {
        const result = batchTelemetryEventsInputSchema.safeParse({
          events,
          consentNoticeVersion,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.consentNoticeVersion).toBe(consentNoticeVersion);
        }
      }
      for (const consentNoticeVersion of ['', 'x'.repeat(51), 0, -1, 1.5]) {
        expect(
          batchTelemetryEventsInputSchema.safeParse({
            events,
            consentNoticeVersion,
          }).success,
        ).toBe(false);
      }
    });
  });
});

describe('Epic 5 review P14 — telemetry schema hardening', () => {
  const base = {
    clientEventId: '11111111-1111-4111-8111-111111111111',
    eventType: 'QUESTION_SHOWN',
    attemptId: '22222222-2222-4222-8222-222222222222',
    formVersionId: '33333333-3333-4333-8333-333333333333',
    occurredAt: '2026-09-26T10:00:00.000Z',
  };

  it('rejects forbidden keys nested in objects and arrays', () => {
    expect(
      telemetryEventItemSchema.safeParse({
        ...base,
        metadata: { device: { details: { keystrokes: 'abc' } } },
      }).success,
    ).toBe(false);
    expect(
      telemetryEventItemSchema.safeParse({
        ...base,
        metadata: { items: [{ clipboardText: 'x' }] },
      }).success,
    ).toBe(false);
  });

  it('rejects metadata nested deeper than 4 levels', () => {
    expect(
      telemetryEventItemSchema.safeParse({
        ...base,
        metadata: { a: { b: { c: { d: { e: 1 } } } } },
      }).success,
    ).toBe(false);
    expect(
      telemetryEventItemSchema.safeParse({
        ...base,
        metadata: { a: { b: { c: 1 } } },
      }).success,
    ).toBe(true);
  });

  it('bounds sequence to the int4 range', () => {
    expect(
      telemetryEventItemSchema.safeParse({ ...base, sequence: 2_147_483_647 })
        .success,
    ).toBe(true);
    expect(
      telemetryEventItemSchema.safeParse({ ...base, sequence: 2_147_483_648 })
        .success,
    ).toBe(false);
  });

  it('requires an ISO date-time occurredAt', () => {
    expect(
      telemetryEventItemSchema.safeParse({
        ...base,
        occurredAt: '2026-09-26T10:00:00+07:00',
      }).success,
    ).toBe(true);
    expect(
      telemetryEventItemSchema.safeParse({ ...base, occurredAt: 'March 3' })
        .success,
    ).toBe(false);
    expect(
      telemetryEventItemSchema.safeParse({ ...base, occurredAt: '1700000000' })
        .success,
    ).toBe(false);
  });
});
