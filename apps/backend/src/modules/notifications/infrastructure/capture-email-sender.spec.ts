import {
  CAPTURE_MAX_MESSAGES,
  CaptureEmailSender,
} from './capture-email-sender';
import { DisabledEmailSender } from './disabled-email-sender';
import { describeEmailSenderContract } from './email-sender.contract-spec';

describeEmailSenderContract('CaptureEmailSender', () => {
  const sender = new CaptureEmailSender();
  return {
    sender,
    failNext: (kind) =>
      sender.failNext({ outcome: kind, code: `TEST_${kind}` }),
    carried: (key) => sender.sent().some((m) => m.idempotencyKey === key),
    acceptedCount: () => sender.sent().length,
  };
});

describe('CaptureEmailSender helpers', () => {
  it('keeps accepted mail in memory until cleared', async () => {
    const sender = new CaptureEmailSender();
    await sender.send({
      to: 'a@example.com',
      subject: 's',
      text: 't',
      html: '<p>t</p>',
      idempotencyKey: 'k',
    });
    expect(sender.sent()).toHaveLength(1);
    sender.clear();
    expect(sender.sent()).toEqual([]);
  });
});

describe('CaptureEmailSender memory bound (review L5)', () => {
  it('keeps only the latest CAPTURE_MAX_MESSAGES', async () => {
    const sender = new CaptureEmailSender();
    for (let i = 0; i < CAPTURE_MAX_MESSAGES + 5; i++) {
      await sender.send({
        to: 'a@example.com',
        subject: 's',
        text: 't',
        html: 'h',
        idempotencyKey: `k${i}`,
      });
    }
    const sent = sender.sent();
    expect(sent).toHaveLength(CAPTURE_MAX_MESSAGES);
    expect(sent[0].idempotencyKey).toBe('k5');
  });
});

describe('DisabledEmailSender', () => {
  it('skips every send', async () => {
    await expect(new DisabledEmailSender().send()).resolves.toEqual({
      outcome: 'SKIPPED',
    });
  });
});
