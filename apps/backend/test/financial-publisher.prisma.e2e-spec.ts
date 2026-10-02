import {
  Actor,
  Harness,
  bootHarness,
  databaseUrl,
  explicitUrl,
  internalDraftBody,
  probeDatabase,
} from './fixtures/financial-pg-harness';
import {
  BALANCED_LEDGER,
  ledgerInvariants,
} from './fixtures/ledger-invariants';

/**
 * Story IR.4 on PostgreSQL: Publisher publish + escrow, governed top-up
 * approval and draft autosave, with the real Prisma repositories, Unit of
 * Work, row locks and the Outbox. Every scenario uses fresh users; the
 * ledger invariants (balanced journals, balances == sum of entries, no
 * negative user account, unique keys) are asserted globally at the end.
 *
 * Skipped when the database is unreachable; fails instead when
 * FINANCIAL_TEST_DATABASE_URL is set explicitly.
 */
const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;

describe('Publisher and financial journeys on PostgreSQL (Story IR.4)', () => {
  let h: Harness;

  if (!dbAvailable) {
    if (explicitUrl) {
      it('reaches FINANCIAL_TEST_DATABASE_URL', () => {
        throw new Error(
          `FINANCIAL_TEST_DATABASE_URL is set but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping IR.4 financial tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    h = await bootHarness();
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  async function accountBalance(userId: string, cls: string) {
    const account = await h.prisma.ledgerAccount.findFirst({
      where: { userId, accountClass: cls as never },
    });
    return account?.balance ?? 0;
  }

  async function createDraft(owner: Actor, title: string) {
    const res = await h.send('post', '/forms', owner, internalDraftBody(title));
    expect(res.status).toBe(201);
    return res.body.data as { id: string; updatedAt: string };
  }

  async function createTopUp(owner: Actor, amount = 500) {
    const res = await h.send('post', '/economy/top-ups', owner, { amount });
    expect(res.status).toBe(201);
    return res.body.data.id as string;
  }

  describe('publish + escrow', () => {
    liveIt(
      'raced publish of one internal form creates one escrow journal; the loser gets 409',
      async () => {
        const publisher = await h.user('PUBLISHER');
        await h.fund(publisher.id, 1_000);
        const draft = await createDraft(publisher, 'IR4 race publish');

        const results = await Promise.all([
          h.send('post', `/forms/${draft.id}/publish`, publisher),
          h.send('post', `/forms/${draft.id}/publish`, publisher),
        ]);
        const statuses = results.map((r) => r.status).sort();
        expect(statuses).toEqual([200, 409]);

        const versions = await h.prisma.formVersion.findMany({
          where: { formId: draft.id },
        });
        const journals = await h.prisma.ledgerJournal.findMany({
          where: {
            idempotencyKey: { in: versions.map((v) => `publish:${v.id}`) },
          },
        });
        expect(journals).toHaveLength(1);
        expect(await accountBalance(publisher.id, 'ESCROW')).toBe(400);
        expect(await accountBalance(publisher.id, 'USER_AVAILABLE')).toBe(600);
        const form = await h.prisma.form.findUniqueOrThrow({
          where: { id: draft.id },
        });
        expect(form.status).toBe('MODERATION_QUEUE');
      },
      60_000,
    );

    liveIt(
      'insufficient funds: publish is rejected with 409 INSUFFICIENT_ESCROW_BALANCE and posts no journal',
      async () => {
        const publisher = await h.user('PUBLISHER');
        await h.fund(publisher.id, 100);
        const draft = await createDraft(publisher, 'IR4 poor publisher');

        const res = await h.send(
          'post',
          `/forms/${draft.id}/publish`,
          publisher,
        );
        expect(res.status).toBe(409);
        expect(res.body.error.code).toMatch(/^INSUFFICIENT_/);

        const version = await h.prisma.formVersion.findFirstOrThrow({
          where: { formId: draft.id },
        });
        expect(
          await h.prisma.ledgerJournal.count({
            where: { idempotencyKey: `publish:${version.id}` },
          }),
        ).toBe(0);
        expect(await accountBalance(publisher.id, 'ESCROW')).toBe(0);
        expect(await accountBalance(publisher.id, 'USER_AVAILABLE')).toBe(100);
        const form = await h.prisma.form.findUniqueOrThrow({
          where: { id: draft.id },
        });
        expect(form.status).toBe('DRAFT');
      },
      60_000,
    );
  });

  describe('top-up governance', () => {
    liveIt(
      'two admins approving the same top-up concurrently post one journal, one audit outbox event and one notification',
      async () => {
        const owner = await h.user('RESPONDENT');
        const adminA = await h.user('ADMIN');
        const adminB = await h.user('ADMIN');
        const topUpId = await createTopUp(owner, 500);

        const results = await Promise.all([
          h.send('post', `/admin/top-ups/${topUpId}/approve`, adminA),
          h.send('post', `/admin/top-ups/${topUpId}/approve`, adminB),
        ]);
        expect(results.map((r) => r.status)).toEqual([200, 200]);
        expect(
          results.filter((r) => r.body.data.replayed === false),
        ).toHaveLength(1);

        expect(
          await h.prisma.ledgerJournal.count({
            where: { idempotencyKey: `topup-approval:${topUpId}` },
          }),
        ).toBe(1);
        expect(await accountBalance(owner.id, 'USER_AVAILABLE')).toBe(500);
        expect(
          await h.prisma.outboxEvent.count({
            where: { aggregateId: topUpId, eventType: 'AdminTopUpApproved' },
          }),
        ).toBe(1);
        expect(
          await h.prisma.notification.count({
            where: { userId: owner.id, type: 'TOPUP_SUCCESS' },
          }),
        ).toBe(1);

        // A later retry is a replay: still one of everything.
        const retry = await h.send(
          'post',
          `/admin/top-ups/${topUpId}/approve`,
          adminA,
        );
        expect(retry.status).toBe(200);
        expect(retry.body.data.replayed).toBe(true);
        expect(await accountBalance(owner.id, 'USER_AVAILABLE')).toBe(500);
        expect(
          await h.prisma.notification.count({
            where: { userId: owner.id, type: 'TOPUP_SUCCESS' },
          }),
        ).toBe(1);
      },
      60_000,
    );

    liveIt(
      'reject after approve is 409 TOPUP_ALREADY_REVIEWED and changes nothing',
      async () => {
        const owner = await h.user('RESPONDENT');
        const admin = await h.user('ADMIN');
        const topUpId = await createTopUp(owner, 300);
        await h
          .send('post', `/admin/top-ups/${topUpId}/approve`, admin)
          .expect(200);

        const res = await h.send(
          'post',
          `/admin/top-ups/${topUpId}/reject`,
          admin,
          { reason: 'Too late' },
        );
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('TOPUP_ALREADY_REVIEWED');
        expect(await accountBalance(owner.id, 'USER_AVAILABLE')).toBe(300);
        expect(
          await h.prisma.outboxEvent.count({
            where: { aggregateId: topUpId },
          }),
        ).toBe(1);
        expect(
          await h.prisma.notification.count({
            where: { userId: owner.id },
          }),
        ).toBe(1);
      },
      60_000,
    );

    liveIt(
      'self-approval is forbidden (403) and leaves the request pending',
      async () => {
        const admin = await h.user('ADMIN');
        const topUpId = await createTopUp(admin, 200);

        const res = await h.send(
          'post',
          `/admin/top-ups/${topUpId}/approve`,
          admin,
        );
        expect(res.status).toBe(403);
        const row = await h.prisma.topUpRequest.findUniqueOrThrow({
          where: { id: topUpId },
        });
        expect(row.status).toBe('PENDING');
        expect(await accountBalance(admin.id, 'USER_AVAILABLE')).toBe(0);
      },
      60_000,
    );
  });

  describe('draft autosave idempotency', () => {
    liveIt(
      'the same autosave PATCH sent twice (sequential retry and concurrent) never duplicates versions or forms',
      async () => {
        const publisher = await h.user('PUBLISHER');
        const draft = await createDraft(publisher, 'IR4 autosave');
        const body = {
          clientUpdatedAt: draft.updatedAt,
          title: 'IR4 autosave edited',
        };

        const [a, b] = await Promise.all([
          h.send('patch', `/forms/${draft.id}/draft`, publisher, body),
          h.send('patch', `/forms/${draft.id}/draft`, publisher, body),
        ]);
        expect([a.status, b.status].sort()).toEqual([200, 409]);

        // A later retry with the now-stale token is a safe 409, never a copy.
        const retry = await h.send(
          'patch',
          `/forms/${draft.id}/draft`,
          publisher,
          body,
        );
        expect(retry.status).toBe(409);

        expect(
          await h.prisma.formVersion.count({ where: { formId: draft.id } }),
        ).toBe(1);
        expect(
          await h.prisma.form.count({ where: { publisherId: publisher.id } }),
        ).toBe(1);
        const form = await h.prisma.form.findUniqueOrThrow({
          where: { id: draft.id },
        });
        expect(form.title).toBe('IR4 autosave edited');
      },
      60_000,
    );
  });

  liveIt(
    'ledger invariants hold: balances == sum of entries, every journal zero-sum, no duplicate keys, no negative user account',
    async () => {
      expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
    },
    60_000,
  );
});
