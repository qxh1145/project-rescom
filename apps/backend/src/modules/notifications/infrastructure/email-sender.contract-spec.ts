import {
  EmailSenderPort,
  OutboundEmail,
} from '../application/ports/email-sender.port';

/**
 * Story IR.4b B-T8: the one contract every email adapter passes (run by
 * `capture-email-sender.spec.ts` and `smtp-email-sender.spec.ts`). Not a
 * spec file itself (no `.spec.ts` suffix), and excluded from the build.
 */
export interface EmailSenderHarness {
  sender: EmailSenderPort;
  /** Makes the next send fail the way the provider would. */
  failNext(kind: 'RETRYABLE' | 'PERMANENT' | 'AMBIGUOUS'): void;
  /** True when an accepted send carried this idempotency key to the provider. */
  carried(idempotencyKey: string): boolean;
  acceptedCount(): number;
}

function message(idempotencyKey: string): OutboundEmail {
  return {
    to: 'recipient@example.com',
    subject: 'Rescom: thử nghiệm',
    text: 'Nội dung',
    html: '<p>Nội dung</p>',
    idempotencyKey,
  };
}

export function describeEmailSenderContract(
  name: string,
  createHarness: () => EmailSenderHarness,
): void {
  describe(`EmailSenderPort contract: ${name}`, () => {
    let harness: EmailSenderHarness;

    beforeEach(() => {
      harness = createHarness();
    });

    it('accepts a message with a provider message id and carries the idempotency key', async () => {
      const result = await harness.sender.send(
        message('notification-email:11111111-1111-4111-8111-111111111111'),
      );
      expect(result.outcome).toBe('ACCEPTED');
      expect(
        result.outcome === 'ACCEPTED' && result.providerMessageId.length > 0,
      ).toBe(true);
      expect(
        harness.carried(
          'notification-email:11111111-1111-4111-8111-111111111111',
        ),
      ).toBe(true);
      expect(harness.acceptedCount()).toBe(1);
    });

    it.each(['RETRYABLE', 'PERMANENT', 'AMBIGUOUS'] as const)(
      'reports a %s failure as an outcome with a code, without throwing',
      async (kind) => {
        harness.failNext(kind);
        const result = await harness.sender.send(message('key-failure'));
        expect(result.outcome).toBe(kind);
        expect('code' in result && typeof result.code).toBe('string');
        expect(harness.acceptedCount()).toBe(0);
      },
    );

    it('never claims idempotent resend (SMTP-style providers)', () => {
      expect(harness.sender.supportsIdempotentResend).toBe(false);
    });
  });
}
