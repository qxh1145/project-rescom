import { randomUUID } from 'crypto';
import {
  Actor,
  Harness,
  bootHarness,
  databaseUrl,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';
import {
  ADMIN_POINT_CREDIT_OUTBOX_PORT,
  AdminPointCreditOutboxPort,
} from '../src/modules/economy/application/ports/admin-point-credit-outbox.port';

const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;

describe('Admin Direct Point Credit PostgreSQL Integration (Story 14.5)', () => {
  let h: Harness;
  let adminActor: Actor;
  let respondentActor: Actor;

  if (!dbAvailable) {
    if (requireDb) {
      it('reaches FINANCIAL_TEST_DATABASE_URL', () => {
        throw new Error(
          `FINANCIAL_TEST_DATABASE_URL is set (or CI) but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping 14.5 pg tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    h = await bootHarness({ usePrismaAudit: true });
    adminActor = await h.user('ADMIN');
    respondentActor = await h.user('RESPONDENT');
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  liveIt(
    'happy path: credit posts journal, creates 2 entries, outbox event and identity audit row',
    async () => {
      const idempotencyKey = randomUUID();
      const reason = 'Cộng điểm thử nghiệm tích hợp PostgreSQL Story 14.5';
      const amount = 250;

      const res = await h
        .send(
          'post',
          `/admin/users/${respondentActor.id}/point-credits`,
          adminActor,
          {
            amount,
            reason,
            idempotencyKey,
          },
        )
        .expect(200);

      expect(res.body.data).toMatchObject({
        userId: respondentActor.id,
        amount,
        reason,
        replayed: false,
      });
      const journalId = res.body.data.journalId;
      expect(journalId).toBeDefined();

      // Verify LedgerJournal in DB
      const journal = await h.prisma.ledgerJournal.findUnique({
        where: { id: journalId },
        include: { entries: true },
      });
      expect(journal).not.toBeNull();
      expect(journal?.idempotencyKey).toBe(`admin-credit:${idempotencyKey}`);
      expect(journal?.description).toBe(reason);
      expect(journal?.entries).toHaveLength(2);

      const systemEntry = journal?.entries.find((e) => e.amount < 0);
      const userEntry = journal?.entries.find((e) => e.amount > 0);
      expect(systemEntry?.amount).toBe(-amount);
      expect(userEntry?.amount).toBe(amount);

      // Verify Outbox row
      const outboxRow = await h.prisma.outboxEvent.findFirst({
        where: {
          idempotencyKey: `admin-points-credited:${journalId}`,
        },
      });
      expect(outboxRow).not.toBeNull();
      expect(outboxRow?.eventType).toBe('AdminPointsCredited');
      expect(outboxRow?.status).toBe('PENDING');
      expect(outboxRow?.payload).toMatchObject({
        journalId,
        userId: respondentActor.id,
        amount,
        reason,
        actorId: adminActor.id,
      });

      // Verify IdentityAuditLog row
      const auditRow = await h.prisma.identityAuditLog.findFirst({
        where: {
          action: 'ADMIN_POINTS_CREDITED',
          userId: adminActor.id,
          targetUserId: respondentActor.id,
        },
      });
      expect(auditRow).not.toBeNull();
      expect(auditRow?.outcome).toBe('SUCCESS');
      expect(auditRow?.metadata).toMatchObject({
        journalId,
        amount,
        reason,
      });

      // Replay returns 200 with replayed: true and same journalId
      const replayRes = await h
        .send(
          'post',
          `/admin/users/${respondentActor.id}/point-credits`,
          adminActor,
          {
            amount,
            reason,
            idempotencyKey,
          },
        )
        .expect(200);

      expect(replayRes.body.data).toMatchObject({
        journalId,
        userId: respondentActor.id,
        amount,
        replayed: true,
      });

      // Verify zero-sum integrity
      const integrity = await h.ledger.verifyLedgerIntegrity();
      expect(integrity.isZeroSum).toBe(true);
    },
  );

  liveIt(
    'atomicity: outbox failure inside UoW rolls back journal and identity audit log in PostgreSQL',
    async () => {
      const idempotencyKey = randomUUID();
      const reason = 'Thao tác gây lỗi outbox để kiểm tra rollback UoW';
      const amount = 300;

      // Task 5.4: fail the REAL outbox insert with a duplicate outbox key, so a
      // genuine P2002 inside the ambient transaction must roll everything back.
      const prior = await h
        .send(
          'post',
          `/admin/users/${respondentActor.id}/point-credits`,
          adminActor,
          {
            amount: 1,
            reason: 'Khoản cộng trước để tạo khoá outbox trùng',
            idempotencyKey: randomUUID(),
          },
        )
        .expect(200);
      const priorJournalId: string = prior.body.data.journalId;

      const outbox = h.app.get<AdminPointCreditOutboxPort>(
        ADMIN_POINT_CREDIT_OUTBOX_PORT,
      );
      const realEnqueue = outbox.enqueueCredited.bind(outbox);
      const enqueueSpy = jest
        .spyOn(outbox, 'enqueueCredited')
        .mockImplementationOnce((event) =>
          realEnqueue({ ...event, journalId: priorJournalId }),
        );

      try {
        const res = await h.send(
          'post',
          `/admin/users/${respondentActor.id}/point-credits`,
          adminActor,
          {
            amount,
            reason,
            idempotencyKey,
          },
        );

        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(enqueueSpy).toHaveBeenCalledTimes(1);

        // Verify no LedgerJournal persisted
        const journal = await h.prisma.ledgerJournal.findFirst({
          where: { idempotencyKey: `admin-credit:${idempotencyKey}` },
        });
        expect(journal).toBeNull();

        // Verify no outbox event persisted
        const outboxEvents = await h.prisma.outboxEvent.findMany({
          where: {
            eventType: 'AdminPointsCredited',
            payload: {
              path: ['reason'],
              equals: reason,
            },
          },
        });
        expect(outboxEvents).toHaveLength(0);

        // Verify no identity audit log persisted
        const auditLogs = await h.prisma.identityAuditLog.findMany({
          where: {
            action: 'ADMIN_POINTS_CREDITED',
            targetUserId: respondentActor.id,
            metadata: {
              path: ['reason'],
              equals: reason,
            },
          },
        });
        expect(auditLogs).toHaveLength(0);
      } finally {
        enqueueSpy.mockRestore();
      }
    },
  );
});
