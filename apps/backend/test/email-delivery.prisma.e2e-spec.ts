import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  NOTIFICATION_EMAIL_REQUESTED_EVENT,
  notificationEmailKey,
} from '@rescom/schemas';
import { PrismaService } from '../src/common/database/prisma.service';
import { PrismaUnitOfWork } from '../src/common/database/prisma-unit-of-work';
import { FixedClock } from '../src/common/time/clock';
import { OutboxDispatchJob } from '../src/common/scheduler/outbox/outbox-dispatch.job';
import { OutboxHandlerRegistry } from '../src/common/scheduler/outbox/outbox-handler';
import { PrismaOutboxClaimRepository } from '../src/common/scheduler/outbox/prisma-outbox-claim.repository';
import { JobRunContext } from '../src/common/scheduler/scheduled-job';
import { PrismaUserRepository } from '../src/modules/users/infrastructure/prisma-user.repository';
import { NotificationsService } from '../src/modules/notifications/application/notifications.service';
import {
  EmailDeliveryHandler,
  EmailSendRetryableError,
} from '../src/modules/notifications/application/email-delivery.handler';
import {
  EmailSendResult,
  EmailSenderPort,
  OutboundEmail,
} from '../src/modules/notifications/application/ports/email-sender.port';
import { PrismaNotificationRepository } from '../src/modules/notifications/infrastructure/prisma-notification.repository';
import { PrismaEmailDeliveryRepository } from '../src/modules/notifications/infrastructure/prisma-email-delivery.repository';
import { CaptureEmailSender } from '../src/modules/notifications/infrastructure/capture-email-sender';

/**
 * Story IR.4b B4–B6 on PostgreSQL: queue-on-publish writes the notification
 * and its `NotificationEmailRequested` Outbox row together; through the real
 * IR.2b dispatcher, at most one provider send is accepted per notification
 * under concurrent dispatch, a crash after the `SENDING` claim, a concurrent
 * handler call and a retry.
 *
 * Applies pending migrations to a dedicated database whose name ends in
 * `_test` (default `rescom_phase5_test`). Skipped when the database is
 * unreachable; fails instead when `EMAIL_TEST_DATABASE_URL` is set.
 */
const explicitUrl = process.env.EMAIL_TEST_DATABASE_URL;
const databaseUrl =
  explicitUrl ??
  'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_phase5_test?schema=public';
const backendDir = path.resolve(__dirname, '..');

if (!new URL(databaseUrl).pathname.slice(1).endsWith('_test')) {
  throw new Error(
    'EMAIL_TEST_DATABASE_URL must target a dedicated database ending in _test',
  );
}

function probeDatabase(): boolean {
  try {
    execFileSync(
      process.execPath,
      [
        '-e',
        "const { PrismaClient } = require('@prisma/client');" +
          'const p = new PrismaClient({ datasources: { db: { url: process.env.PROBE_URL } } });' +
          "p.$queryRawUnsafe('SELECT 1').then(() => process.exit(0), () => process.exit(1));",
      ],
      {
        cwd: backendDir,
        env: { ...process.env, PROBE_URL: databaseUrl },
        stdio: 'pipe',
        timeout: 30_000,
      },
    );
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;
jest.setTimeout(60_000);

/** Capture sender that holds each send open a little, widening race windows. */
class SlowCaptureSender implements EmailSenderPort {
  readonly supportsIdempotentResend = false;
  readonly inner = new CaptureEmailSender();

  async send(message: OutboundEmail): Promise<EmailSendResult> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return this.inner.send(message);
  }
}

describe('Email delivery on PostgreSQL (Story IR.4b B6)', () => {
  let prisma: PrismaService;
  let clock: FixedClock;
  let sender: SlowCaptureSender;
  let handler: EmailDeliveryHandler;
  let notifications: NotificationsService;
  const silent = { log() {}, warn() {}, error() {}, debug() {} };

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches EMAIL_TEST_DATABASE_URL', () => {
        throw new Error(
          `EMAIL_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live email delivery tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    const prismaCli = require.resolve('prisma/build/index.js', {
      paths: [backendDir],
    });
    execFileSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      {
        cwd: backendDir,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: 'pipe',
      },
    );
    prisma = new PrismaService({ datasources: { db: { url: databaseUrl } } });
    await prisma.$connect();
  }, 180_000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  beforeEach(async () => {
    if (!dbAvailable) return;
    // Only this suite's event type; earlier runs must not leak into counts.
    await prisma.outboxEvent.deleteMany({
      where: { eventType: NOTIFICATION_EMAIL_REQUESTED_EVENT },
    });
    clock = new FixedClock(Date.now() + 1_000);
    sender = new SlowCaptureSender();
    handler = new EmailDeliveryHandler(
      new PrismaEmailDeliveryRepository(prisma),
      sender,
      new PrismaUserRepository(prisma),
      {
        appBaseUrl: 'http://localhost:3000',
        supportEmail: null,
        sendTimeoutMs: 1_000,
      },
      undefined,
      () => clock.now(),
    );
    notifications = new NotificationsService(
      new PrismaNotificationRepository(prisma),
      undefined,
      undefined,
      { emailRequests: true },
    );
  });

  function dispatcher(): OutboxDispatchJob {
    const registry = new OutboxHandlerRegistry();
    registry.register(handler);
    return new OutboxDispatchJob(
      registry,
      new PrismaOutboxClaimRepository(prisma),
      new PrismaUnitOfWork(prisma),
      clock,
      { intervalMs: 15_000, maxAttempts: 8, random: () => 0.5 },
    );
  }

  function context(owner: string): JobRunContext {
    return {
      runId: randomUUID(),
      now: clock.now(),
      owner,
      fencingToken: '1',
      shouldContinue: async () => true,
      logger: silent,
    };
  }

  async function userWithRejectedTopUp(): Promise<{
    userId: string;
    notificationId: string;
    key: string;
  }> {
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        email: `email-${userId}@example.com`,
        passwordHash: 'hash',
        role: 'PUBLISHER',
      },
    });
    const result = await notifications.publish({
      userId,
      type: 'TOPUP_REJECTED',
      message: 'Your top-up request was rejected.',
      dedupeKey: `topup-rejection:${userId}`,
    });
    expect(result).toBe('CREATED');
    const notification = await prisma.notification.findFirstOrThrow({
      where: { userId },
    });
    return {
      userId,
      notificationId: notification.id,
      key: notificationEmailKey(notification.id),
    };
  }

  liveIt(
    'publish writes the notification and one identifiers-only Outbox row; a duplicate writes none',
    async () => {
      const { userId, notificationId, key } = await userWithRejectedTopUp();
      await expect(
        notifications.publish({
          userId,
          type: 'TOPUP_REJECTED',
          message: 'Your top-up request was rejected.',
          dedupeKey: `topup-rejection:${userId}`,
        }),
      ).resolves.toBe('DUPLICATE');

      const events = await prisma.outboxEvent.findMany({
        where: { aggregateId: notificationId },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        idempotencyKey: key,
        eventType: 'NotificationEmailRequested',
        producer: 'notifications-service',
        aggregateType: 'Notification',
        status: 'PENDING',
      });
      expect(events[0].payload).toEqual({
        schemaVersion: 1,
        notificationId,
        userId,
        type: 'TOPUP_REJECTED',
      });
      expect(JSON.stringify(events[0].payload)).not.toContain('@');
    },
  );

  liveIt(
    'two concurrent dispatcher runs send exactly once and record one SENT row',
    async () => {
      const { notificationId, key } = await userWithRejectedTopUp();

      const summaries = await Promise.all([
        dispatcher().run(context('worker-a')),
        dispatcher().run(context('worker-b')),
      ]);

      expect(summaries.reduce((sum, s) => sum + s.counts.claimed, 0)).toBe(1);
      expect(sender.inner.sent()).toHaveLength(1);
      const rows = await prisma.emailDelivery.findMany({
        where: { notificationId },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        idempotencyKey: key,
        status: 'SENT',
        attempts: 1,
        lastErrorCode: null,
      });
      expect(rows[0].providerMessageId).toBeTruthy();
      const event = await prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      expect(event.status).toBe('PROCESSED');
      await expect(
        prisma.processedHandler.count({
          where: {
            eventId: event.id,
            handlerName: 'notifications.email-delivery',
          },
        }),
      ).resolves.toBe(1);
    },
  );

  liveIt(
    'two concurrent handler calls for one event still send exactly once',
    async () => {
      const { key } = await userWithRejectedTopUp();
      const row = await prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      const envelope = {
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        eventType: row.eventType,
        schemaVersion: row.schemaVersion,
        producer: row.producer,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        aggregateVersion: row.aggregateVersion,
        orderingStream: null,
        streamSequence: null,
        correlationId: null,
        causationId: null,
        payload: row.payload,
        attempts: 1,
        createdAt: row.createdAt,
      };

      const results = await Promise.allSettled([
        handler.handle(envelope),
        handler.handle(envelope),
      ]);
      // The loser sees the other send in flight and asks to be retried (M3).
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(result.reason).toBeInstanceOf(EmailSendRetryableError);
        }
      }
      await handler.handle({ ...envelope, attempts: 2 });

      expect(sender.inner.sent()).toHaveLength(1);
      const delivery = await prisma.emailDelivery.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      expect(delivery.status).toBe('SENT');
    },
  );

  liveIt(
    'a SENDING row is retried while it may be in flight, then UNCONFIRMED once abandoned; never resent',
    async () => {
      const { userId, notificationId, key } = await userWithRejectedTopUp();
      await prisma.emailDelivery.create({
        data: {
          idempotencyKey: key,
          notificationId,
          userId,
          notificationType: 'TOPUP_REJECTED',
          status: 'SENDING',
          attempts: 1,
          sendingStartedAt: clock.now(),
        },
      });

      const inFlight = await dispatcher().run(context('worker-after-crash'));
      expect(inFlight.counts.retried).toBe(1);
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({
          where: { idempotencyKey: key },
        }),
      ).resolves.toMatchObject({ status: 'SENDING' });

      // Past 3 × the send deadline: the attempt was abandoned (crash).
      clock.advance(60 * 60_000);
      await dispatcher().run(context('worker-later'));

      expect(sender.inner.sent()).toHaveLength(0);
      const delivery = await prisma.emailDelivery.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      expect(delivery).toMatchObject({
        status: 'UNCONFIRMED',
        attempts: 1,
        lastErrorCode: 'AMBIGUOUS:INTERRUPTED_SEND',
      });
      const event = await prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      expect(event.status).toBe('PROCESSED');
    },
  );

  liveIt(
    'a retryable failure is retried by the dispatcher after its backoff and sent once',
    async () => {
      const { key } = await userWithRejectedTopUp();
      sender.inner.failNext({
        outcome: 'RETRYABLE',
        code: 'CONNECTION_FAILED',
      });

      const first = await dispatcher().run(context('worker-1'));
      expect(first.counts.retried).toBe(1);
      let event = await prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      expect(event.status).toBe('FAILED');
      expect(event.lastError).toBe(
        'notifications.email-delivery: EmailSendRetryableError:CONNECTION_FAILED',
      );
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({
          where: { idempotencyKey: key },
        }),
      ).resolves.toMatchObject({
        status: 'FAILED',
        lastErrorCode: 'RETRYABLE:CONNECTION_FAILED',
      });

      // Not due yet: nothing happens.
      await dispatcher().run(context('worker-2'));
      expect(sender.inner.sent()).toHaveLength(0);

      clock.advance(31_000);
      await dispatcher().run(context('worker-3'));
      expect(sender.inner.sent()).toHaveLength(1);
      event = await prisma.outboxEvent.findUniqueOrThrow({
        where: { idempotencyKey: key },
      });
      expect(event.status).toBe('PROCESSED');
      await expect(
        prisma.emailDelivery.findUniqueOrThrow({
          where: { idempotencyKey: key },
        }),
      ).resolves.toMatchObject({ status: 'SENT', attempts: 2 });
    },
  );
});
