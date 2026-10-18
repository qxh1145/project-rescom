import { MissingCodeResolvedNotificationHandler } from './missing-code-resolved-notification.handler';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';
import {
  MISSING_CODE_RESOLVED_EVENT_TYPE,
  NOTIFICATION_MESSAGE_MAX_LENGTH,
} from '@rescom/schemas';
import { OutboxPayloadInvalidError } from '../../../common/scheduler/outbox/outbox-handler';

describe('MissingCodeResolvedNotificationHandler (Story 14.1 AC 6)', () => {
  let handler: MissingCodeResolvedNotificationHandler;
  let mockNotifications: jest.Mocked<NotificationPublisherPort>;

  const attemptId = '11111111-1111-4111-8111-111111111111';
  const respondentId = '22222222-2222-4222-8222-222222222222';
  const publisherId = '33333333-3333-4333-8333-333333333333';
  const idempotencyKey = 'missing-code-resolved:11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    mockNotifications = {
      publish: jest.fn().mockResolvedValue({ id: 'notif-1', isDuplicate: false }),
    };
    handler = new MissingCodeResolvedNotificationHandler(mockNotifications);
  });

  it('throws OutboxPayloadInvalidError on invalid payload', async () => {
    await expect(
      handler.handle({
        id: 'outbox-1',
        idempotencyKey,
        eventType: MISSING_CODE_RESOLVED_EVENT_TYPE,
        schemaVersion: 1,
        payload: { invalid: true },
        createdAt: new Date(),
      } as any),
    ).rejects.toThrow(OutboxPayloadInvalidError);
  });

  it('handles CREDIT_RESPONDENT: notifies both respondent and publisher', async () => {
    await handler.handle({
      id: 'outbox-1',
      idempotencyKey,
      eventType: MISSING_CODE_RESOLVED_EVENT_TYPE,
      schemaVersion: 1,
      payload: {
        schemaVersion: 1,
        attemptId,
        surveyId: 'survey-1',
        surveyTitle: 'Customer Feedback Survey',
        respondentId,
        publisherId,
        outcome: 'CREDIT_RESPONDENT',
        rewardPoints: 50,
        note: 'Verified completion screenshot provided.',
        occurredAt: '2026-10-18T12:00:00.000Z',
      },
      createdAt: new Date(),
    } as any);

    expect(mockNotifications.publish).toHaveBeenCalledTimes(2);

    // Respondent notification
    expect(mockNotifications.publish).toHaveBeenCalledWith({
      userId: respondentId,
      type: 'REWARD_PENDING',
      message:
        'Admin đã xác nhận bạn hoàn thành khảo sát "Customer Feedback Survey". 50 Điểm đang chờ, sẽ chuyển vào Khả dụng sau 48 giờ. Ghi chú: Verified completion screenshot provided.',
      dedupeKey: `${idempotencyKey}:respondent`,
    });

    // Publisher notification (generic, no note, no respondent ID)
    expect(mockNotifications.publish).toHaveBeenCalledWith({
      userId: publisherId,
      type: 'MISSING_CODE_REPORT_RESOLVED',
      message:
        'Admin đã cộng Điểm cho một người trả lời khảo sát "Customer Feedback Survey" vì không tìm thấy mã hoàn thành. Hãy kiểm tra mã hoàn thành trên biểu mẫu bên ngoài.',
      dedupeKey: `${idempotencyKey}:publisher`,
    });
  });

  it('handles DISMISSED: notifies respondent only, not publisher', async () => {
    await handler.handle({
      id: 'outbox-2',
      idempotencyKey,
      eventType: MISSING_CODE_RESOLVED_EVENT_TYPE,
      schemaVersion: 1,
      payload: {
        schemaVersion: 1,
        attemptId,
        surveyId: 'survey-1',
        surveyTitle: 'Customer Feedback Survey',
        respondentId,
        publisherId,
        outcome: 'DISMISSED',
        rewardPoints: null,
        note: 'Respondent did not reach end of survey.',
        occurredAt: '2026-10-18T12:00:00.000Z',
      },
      createdAt: new Date(),
    } as any);

    expect(mockNotifications.publish).toHaveBeenCalledTimes(1);
    expect(mockNotifications.publish).toHaveBeenCalledWith({
      userId: respondentId,
      type: 'MISSING_CODE_REPORT_RESOLVED',
      message:
        'Báo cáo thiếu mã cho khảo sát "Customer Feedback Survey" không được chấp nhận. Lý do: Respondent did not reach end of survey.',
      dedupeKey: `${idempotencyKey}:respondent`,
    });
  });

  it('truncates message if it exceeds NOTIFICATION_MESSAGE_MAX_LENGTH', async () => {
    const longNote = 'A'.repeat(600);

    await handler.handle({
      id: 'outbox-3',
      idempotencyKey,
      eventType: MISSING_CODE_RESOLVED_EVENT_TYPE,
      schemaVersion: 1,
      payload: {
        schemaVersion: 1,
        attemptId,
        surveyId: 'survey-1',
        surveyTitle: 'Short Title',
        respondentId,
        publisherId,
        outcome: 'DISMISSED',
        rewardPoints: null,
        note: longNote,
        occurredAt: '2026-10-18T12:00:00.000Z',
      },
      createdAt: new Date(),
    } as any);

    const publishedCall = mockNotifications.publish.mock.calls[0][0];
    expect(publishedCall.message.length).toBeLessThanOrEqual(NOTIFICATION_MESSAGE_MAX_LENGTH);
    expect(publishedCall.message.endsWith('…')).toBe(true);
  });

  it('skips respondent notification if respondentId is null (guest)', async () => {
    await handler.handle({
      id: 'outbox-4',
      idempotencyKey,
      eventType: MISSING_CODE_RESOLVED_EVENT_TYPE,
      schemaVersion: 1,
      payload: {
        schemaVersion: 1,
        attemptId,
        surveyId: 'survey-1',
        surveyTitle: 'Survey',
        respondentId: null,
        publisherId,
        outcome: 'DISMISSED',
        rewardPoints: null,
        note: 'Guest attempt dismissed.',
        occurredAt: '2026-10-18T12:00:00.000Z',
      },
      createdAt: new Date(),
    } as any);

    expect(mockNotifications.publish).not.toHaveBeenCalled();
  });
});
