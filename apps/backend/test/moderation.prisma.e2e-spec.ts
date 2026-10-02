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
 * Story IR.4 on PostgreSQL: Survey moderation with two distinct Admins.
 * Concurrent decisions record exactly one result (one decision row, one
 * audit Outbox event, one notification), self-review is forbidden and a
 * rejection refunds the Escrow on the real ledger.
 *
 * Skipped when the database is unreachable; fails instead when
 * FINANCIAL_TEST_DATABASE_URL is set explicitly.
 */
const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;
const REASON = 'Câu hỏi không phù hợp với tiêu chuẩn nội dung của RESCOM.';

describe('Survey moderation on PostgreSQL (Story IR.4)', () => {
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
        `Postgres DB at ${databaseUrl} is unreachable. Skipping IR.4 moderation tests.`,
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

  /** Funds the owner, drafts and publishes into the moderation queue. */
  async function queuedSurvey(owner: Actor, title: string) {
    await h.fund(owner.id, 1_000);
    const draft = await h.send(
      'post',
      '/forms',
      owner,
      internalDraftBody(title),
    );
    expect(draft.status).toBe(201);
    const published = await h.send(
      'post',
      `/forms/${draft.body.data.id}/publish`,
      owner,
    );
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('MODERATION_QUEUE');
    return {
      formId: draft.body.data.id as string,
      formVersionId: published.body.data.currentVersion.id as string,
    };
  }

  const approve = (admin: Actor, formId: string, formVersionId: string) =>
    h.send('post', `/admin/moderation/surveys/${formId}/approve`, admin, {
      formVersionId,
    });
  const reject = (admin: Actor, formId: string, formVersionId: string) =>
    h.send('post', `/admin/moderation/surveys/${formId}/reject`, admin, {
      formVersionId,
      reason: REASON,
    });

  async function sideEffects(formId: string, publisherId: string) {
    const [decisions, audits, notifications] = await Promise.all([
      h.prisma.surveyModerationDecision.count({ where: { formId } }),
      h.prisma.outboxEvent.count({
        where: { aggregateId: formId },
      }),
      h.prisma.notification.count({ where: { userId: publisherId } }),
    ]);
    return { decisions, audits, notifications };
  }

  liveIt(
    'two admins approving one survey concurrently record one decision, one audit event and one notification',
    async () => {
      const owner = await h.user('PUBLISHER');
      const adminA = await h.user('ADMIN');
      const adminB = await h.user('ADMIN');
      const { formId, formVersionId } = await queuedSurvey(
        owner,
        'IR4 approve',
      );

      const results = await Promise.all([
        approve(adminA, formId, formVersionId),
        approve(adminB, formId, formVersionId),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(
        results.filter((r) => r.body.data.replayed === false),
      ).toHaveLength(1);

      expect(await sideEffects(formId, owner.id)).toEqual({
        decisions: 1,
        audits: 1,
        notifications: 1,
      });
      const form = await h.prisma.form.findUniqueOrThrow({
        where: { id: formId },
      });
      expect(form.status).toBe('PUBLISHED');
      expect(await accountBalance(owner.id, 'ESCROW')).toBe(400);
    },
    60_000,
  );

  liveIt(
    'approve racing reject by two admins records one result; the loser gets 409 MODERATION_ALREADY_DECIDED',
    async () => {
      const owner = await h.user('PUBLISHER');
      const adminA = await h.user('ADMIN');
      const adminB = await h.user('ADMIN');
      const { formId, formVersionId } = await queuedSurvey(owner, 'IR4 race');

      const [a, r] = await Promise.all([
        approve(adminA, formId, formVersionId),
        reject(adminB, formId, formVersionId),
      ]);
      expect([a.status, r.status].sort()).toEqual([200, 409]);
      const loser = a.status === 409 ? a : r;
      expect(loser.body.error.code).toBe('MODERATION_ALREADY_DECIDED');

      const decision = await h.prisma.surveyModerationDecision.findFirstOrThrow(
        { where: { formId } },
      );
      expect(decision.outcome).toBe(a.status === 200 ? 'APPROVED' : 'REJECTED');
      expect(await sideEffects(formId, owner.id)).toEqual({
        decisions: 1,
        audits: 1,
        notifications: 1,
      });
    },
    60_000,
  );

  liveIt(
    'reject refunds the Escrow on the real ledger and a repeated reject is a replay with no second refund',
    async () => {
      const owner = await h.user('PUBLISHER');
      const adminA = await h.user('ADMIN');
      const adminB = await h.user('ADMIN');
      const { formId, formVersionId } = await queuedSurvey(owner, 'IR4 reject');
      expect(await accountBalance(owner.id, 'ESCROW')).toBe(400);
      expect(await accountBalance(owner.id, 'USER_AVAILABLE')).toBe(600);

      const res = await reject(adminA, formId, formVersionId);
      expect(res.status).toBe(200);
      expect(res.body.data.replayed).toBe(false);
      expect(await accountBalance(owner.id, 'ESCROW')).toBe(0);
      expect(await accountBalance(owner.id, 'USER_AVAILABLE')).toBe(1_000);

      const replay = await reject(adminB, formId, formVersionId);
      expect(replay.status).toBe(200);
      expect(replay.body.data.replayed).toBe(true);
      expect(await accountBalance(owner.id, 'USER_AVAILABLE')).toBe(1_000);

      const decision = await h.prisma.surveyModerationDecision.findFirstOrThrow(
        { where: { formId } },
      );
      expect(decision).toMatchObject({
        outcome: 'REJECTED',
        adminId: adminA.id,
        refundAmount: 400,
      });
      expect(decision.refundJournalId).not.toBeNull();
      expect(await sideEffects(formId, owner.id)).toEqual({
        decisions: 1,
        audits: 1,
        notifications: 1,
      });
    },
    60_000,
  );

  liveIt(
    'self-review is forbidden: an admin cannot approve or reject their own survey (403) and the survey stays queued',
    async () => {
      const admin = await h.user('ADMIN');
      const { formId, formVersionId } = await queuedSurvey(admin, 'IR4 self');

      const approved = await approve(admin, formId, formVersionId);
      const rejected = await reject(admin, formId, formVersionId);
      expect(approved.status).toBe(403);
      expect(approved.body.error.code).toBe('MODERATION_SELF_REVIEW_FORBIDDEN');
      expect(rejected.status).toBe(403);

      expect(
        await h.prisma.surveyModerationDecision.count({ where: { formId } }),
      ).toBe(0);
      const form = await h.prisma.form.findUniqueOrThrow({
        where: { id: formId },
      });
      expect(form.status).toBe('MODERATION_QUEUE');
      expect(await accountBalance(admin.id, 'ESCROW')).toBe(400);
    },
    60_000,
  );

  liveIt(
    'ledger invariants hold after moderation: balanced journals, no drift, no negative user account',
    async () => {
      expect(await ledgerInvariants(h.prisma)).toEqual(BALANCED_LEDGER);
    },
    60_000,
  );
});
