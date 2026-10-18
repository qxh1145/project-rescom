import {
  Actor,
  Harness,
  bootHarness,
  databaseUrl,
  probeDatabase,
  requireDb,
} from './fixtures/financial-pg-harness';
import { randomUUID } from 'crypto';
import { EnvService } from '../src/common/config/env.service';
import { CompletionCodeService } from '../src/modules/forms/infrastructure/completion-code.service';
import {
  MISSING_CODE_REPORT_STATS_PORT,
  MissingCodeReportStatsPort,
} from '../src/modules/participation/application/ports/missing-code-report-stats.port';

const dbAvailable = probeDatabase();
const liveIt = dbAvailable ? it : it.skip;

describe('Missing-Code Report Resolution on PostgreSQL (Story 14.1)', () => {
  let h: Harness;
  let admin: Actor;
  let otherAdmin: Actor;
  let publisher: Actor;
  let respondent: Actor;

  if (!dbAvailable) {
    if (requireDb) {
      it('reaches FINANCIAL_TEST_DATABASE_URL', () => {
        throw new Error(
          `FINANCIAL_TEST_DATABASE_URL is set (or CI) but ${databaseUrl} is unreachable.`,
        );
      });
    } else {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping 14.1 pg tests.`,
      );
    }
  }

  beforeAll(async () => {
    if (!dbAvailable) return;
    h = await bootHarness();
    admin = await h.user('ADMIN');
    otherAdmin = await h.user('ADMIN');
    publisher = await h.user('PUBLISHER');
    respondent = await h.user('RESPONDENT');
  }, 180_000);

  afterAll(async () => {
    if (h) await h.close();
  });

  async function createExternalSurveyWithEscrow(
    pub: Actor,
    rewardPerResponse = 50,
    expectedCompletions = 10,
    status: 'PUBLISHED' | 'CLOSED' = 'PUBLISHED',
  ) {
    const totalEscrow = rewardPerResponse * expectedCompletions;
    await h.fund(pub.id, totalEscrow);

    // Create form & version
    const form = await h.prisma.form.create({
      data: {
        publisherId: pub.id,
        type: 'EXTERNAL',
        status,
        title: `External Survey ${randomUUID().slice(0, 8)}`,
        rewardPerResponse,
        expectedCompletions,
        versions: {
          create: {
            versionNumber: 1,
            isPublished: true,
            schemaJson: [],
            externalUrl: 'https://docs.google.com/forms/d/e/test/viewform',
          },
        },
      },
      include: { versions: true },
    });

    const version = form.versions[0];

    // Lock funds in escrow for the publisher
    if (totalEscrow > 0) {
      const system = await h.ledger.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
      const available = await h.ledger.getOrCreateAccount(
        pub.id,
        'USER_AVAILABLE',
      );
      await h.ledger.transfer({
        fromAccountId: system.id,
        toAccountId: available.id,
        amount: totalEscrow,
        idempotencyKey: `seed:${version.id}`,
        description: 'Seed for escrow',
      });
      await h.ledger.reserveEscrow({
        userId: pub.id,
        formVersionId: version.id,
        amount: totalEscrow,
        formTitle: form.title,
      });
    }

    return { form, version };
  }

  async function createReportedAttempt(
    surveyId: string,
    formVersionId: string,
    resp: Actor | null,
    status:
      'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED' | 'LOCKED' = 'IN_PROGRESS',
  ) {
    return h.prisma.surveyAttempt.create({
      data: {
        surveyId,
        formVersionId,
        respondentId: resp ? resp.id : null,
        status,
        isGuest: resp === null,
        missingCodeReportedAt: new Date(),
        missingCodeReason: 'Did not receive code after submitting Google Form',
      },
    });
  }

  const auditKey = (attemptId: string) =>
    `admin-audit:missing-code:${attemptId}`;

  async function auditRows(attemptId: string) {
    return h.prisma.outboxEvent.findMany({
      where: { idempotencyKey: auditKey(attemptId) },
    });
  }

  async function externalJournals(attemptId: string) {
    return h.prisma.ledgerJournal.findMany({
      where: { idempotencyKey: `external-completion:${attemptId}` },
    });
  }

  /** Sum of the Respondent's PENDING ledger entries (what has been credited to them). */
  async function pendingBalance(userId: string) {
    const sum = await h.prisma.ledgerEntry.aggregate({
      _sum: { amount: true },
      where: { account: { userId, accountClass: 'PENDING' } },
    });
    return sum._sum.amount ?? 0;
  }

  const resolve = (
    attemptId: string,
    by: Actor,
    outcome: 'CREDIT_RESPONDENT' | 'DISMISSED',
    note: string,
  ) =>
    h.send('post', `/admin/missing-code-reports/${attemptId}/resolve`, by, {
      outcome,
      note,
    });

  liveIt(
    '1. full credit flow on an open survey: report -> resolve CREDIT -> verify COMPLETED, PENDING journal, and Outbox events',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);

      const res = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Admin verified survey completion manually via screenshot.',
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        attemptId: attempt.id,
        outcome: 'CREDIT_RESPONDENT',
        attemptStatus: 'COMPLETED',
        rewardPoints: 50,
        replayed: false,
      });

      // Verify DB attempt row
      const updated = await h.prisma.surveyAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(updated.status).toBe('COMPLETED');
      expect(updated.missingCodeResolvedAt).not.toBeNull();
      expect(updated.missingCodeResolution).toBe('CREDIT_RESPONDENT');
      expect(updated.missingCodeResolutionNote).toBe(
        'Admin verified survey completion manually via screenshot.',
      );
      expect(updated.missingCodeResolvedById).toBe(admin.id);

      // Verify PENDING ledger journal
      const journals = await h.prisma.ledgerJournal.findMany({
        where: {
          idempotencyKey: `external-completion:${attempt.id}`,
        },
        include: { entries: { include: { account: true } } },
      });
      expect(journals).toHaveLength(1);
      const journal = journals[0];
      expect(journal.entries).toHaveLength(2);
      const escrowEntry = journal.entries.find(
        (e) => e.account.accountClass === 'ESCROW',
      );
      const pendingEntry = journal.entries.find(
        (e) => e.account.accountClass === 'PENDING',
      );
      expect(escrowEntry?.amount).toBe(-50);
      expect(escrowEntry?.account.userId).toBe(pub.id);
      expect(pendingEntry?.amount).toBe(50);
      expect(pendingEntry?.account.userId).toBe(resp.id);

      // Verify Outbox rows: audit and notification
      const outboxEvents = await h.prisma.outboxEvent.findMany({
        where: {
          aggregateId: attempt.id,
        },
      });
      expect(outboxEvents).toHaveLength(2);
      const auditEvent = outboxEvents.find(
        (e) => e.eventType === 'AdminMissingCodeReportResolved',
      );
      const resolvedEvent = outboxEvents.find(
        (e) => e.eventType === 'ParticipationMissingCodeReportResolved',
      );
      expect(auditEvent).toBeDefined();
      expect(resolvedEvent).toBeDefined();
      expect(auditEvent?.idempotencyKey).toBe(
        `admin-audit:missing-code:${attempt.id}`,
      );
      expect(resolvedEvent?.idempotencyKey).toBe(
        `missing-code-resolved:${attempt.id}`,
      );
    },
    60_000,
  );

  liveIt(
    '2. attempt already completed: 409 SURVEY_ALREADY_COMPLETED',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(
        form.id,
        version.id,
        resp,
        'COMPLETED',
      );

      const res = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Trying to credit an already completed attempt.',
        },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SURVEY_ALREADY_COMPLETED');
    },
    60_000,
  );

  liveIt(
    '3. survey closed: 409 MISSING_CODE_SURVEY_CLOSED',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
        'CLOSED',
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);

      const res = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Trying to credit on a closed survey.',
        },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('MISSING_CODE_SURVEY_CLOSED');
    },
    60_000,
  );

  liveIt(
    '4. survey quota reached: 409 SURVEY_QUOTA_FULL',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        1,
      ); // quota = 1

      // Add one already completed attempt to fill quota
      const otherResp = await h.user('RESPONDENT');
      await h.prisma.surveyAttempt.create({
        data: {
          surveyId: form.id,
          formVersionId: version.id,
          respondentId: otherResp.id,
          status: 'COMPLETED',
          submittedAt: new Date(),
        },
      });

      const attempt = await createReportedAttempt(form.id, version.id, resp);

      const res = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Survey quota is already met.',
        },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SURVEY_QUOTA_FULL');
    },
    60_000,
  );

  liveIt(
    '5. escrow shortfall: 409 SURVEY_REWARD_UNAVAILABLE',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      // Create survey without funding escrow
      const form = await h.prisma.form.create({
        data: {
          publisherId: pub.id,
          type: 'EXTERNAL',
          status: 'PUBLISHED',
          title: `No Escrow Survey ${randomUUID().slice(0, 8)}`,
          rewardPerResponse: 50,
          expectedCompletions: 10,
          versions: {
            create: {
              versionNumber: 1,
              isPublished: true,
              schemaJson: [],
              externalUrl: 'https://docs.google.com/forms/d/e/test/viewform',
            },
          },
        },
        include: { versions: true },
      });
      const attempt = await createReportedAttempt(
        form.id,
        form.versions[0].id,
        resp,
      );

      const res = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Escrow is missing completely.',
        },
      );

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('SURVEY_REWARD_UNAVAILABLE');
    },
    60_000,
  );

  liveIt(
    '6. self-resolve attempt: 403 MISSING_CODE_SELF_RESOLVE_FORBIDDEN',
    async () => {
      const pub = await h.user('PUBLISHER');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      // Admin themselves took the survey
      const attempt = await createReportedAttempt(form.id, version.id, admin);

      const res = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Admin attempting to self-resolve their own attempt.',
        },
      );

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('MISSING_CODE_SELF_RESOLVE_FORBIDDEN');
    },
    60_000,
  );

  liveIt(
    '7 & 8. replay identical returns 200 replayed: true; conflict returns 409 MISSING_CODE_REPORT_ALREADY_RESOLVED',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);

      // First resolution
      const first = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'First valid credit resolution.',
        },
      );
      expect(first.status).toBe(200);
      expect(first.body.data.replayed).toBe(false);

      // Replay identical resolution
      const replay = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        otherAdmin,
        {
          outcome: 'CREDIT_RESPONDENT',
          note: 'Second admin sends same outcome.',
        },
      );
      expect(replay.status).toBe(200);
      expect(replay.body.data.replayed).toBe(true);
      expect(replay.body.data.outcome).toBe('CREDIT_RESPONDENT');

      // Conflicting resolution (DISMISSED after CREDIT)
      const conflict = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'DISMISSED',
          note: 'Attempting to dismiss already credited report.',
        },
      );
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe(
        'MISSING_CODE_REPORT_ALREADY_RESOLVED',
      );
    },
    60_000,
  );

  liveIt(
    '9. concurrent resolves with CREDIT: exactly one succeeds, others get replayed or conflict, exactly one journal posted',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);

      const [res1, res2] = await Promise.all([
        h.send(
          'post',
          `/admin/missing-code-reports/${attempt.id}/resolve`,
          admin,
          {
            outcome: 'CREDIT_RESPONDENT',
            note: 'Concurrent credit resolution attempt 1.',
          },
        ),
        h.send(
          'post',
          `/admin/missing-code-reports/${attempt.id}/resolve`,
          otherAdmin,
          {
            outcome: 'CREDIT_RESPONDENT',
            note: 'Concurrent credit resolution attempt 2.',
          },
        ),
      ]);

      expect([res1.status, res2.status].sort()).toEqual([200, 200]);
      const replayedFlags = [
        res1.body.data.replayed,
        res2.body.data.replayed,
      ].sort();
      expect(replayedFlags).toEqual([false, true]);

      // Exactly one ledger journal posted
      const journals = await h.prisma.ledgerJournal.findMany({
        where: {
          idempotencyKey: `external-completion:${attempt.id}`,
        },
      });
      expect(journals).toHaveLength(1);

      // Exactly one audit row, and the Respondent's PENDING was credited once.
      expect(await auditRows(attempt.id)).toHaveLength(1);
      expect(await pendingBalance(resp.id)).toBe(50);
    },
    60_000,
  );

  liveIt(
    '10. dismissed flow: status unchanged, no journal, outbox audit + notification rows written',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);

      const res = await h.send(
        'post',
        `/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'DISMISSED',
          note: 'Respondent provided no proof of survey submission.',
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        attemptId: attempt.id,
        outcome: 'DISMISSED',
        attemptStatus: 'IN_PROGRESS',
        rewardPoints: null,
        replayed: false,
      });

      // Status remains IN_PROGRESS
      const updated = await h.prisma.surveyAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(updated.status).toBe('IN_PROGRESS');
      expect(updated.missingCodeResolvedAt).not.toBeNull();
      expect(updated.missingCodeResolution).toBe('DISMISSED');

      // No ledger journal
      const journals = await h.prisma.ledgerJournal.findMany({
        where: {
          idempotencyKey: `external-completion:${attempt.id}`,
        },
      });
      expect(journals).toHaveLength(0);

      // Outbox events written
      const outboxEvents = await h.prisma.outboxEvent.findMany({
        where: { aggregateId: attempt.id },
      });
      expect(outboxEvents).toHaveLength(2);
    },
    60_000,
  );

  liveIt(
    '11. route aliases: both /admin/missing-code-reports and /api/admin/missing-code-reports resolve',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);

      // Call via /api/admin/ prefix
      const res = await h.send(
        'post',
        `/api/admin/missing-code-reports/${attempt.id}/resolve`,
        admin,
        {
          outcome: 'DISMISSED',
          note: 'Resolving via api/admin prefix route alias.',
        },
      );

      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe('DISMISSED');
    },
    60_000,
  );

  liveIt(
    '12. CREDIT_RESPONDENT vs DISMISSED race: exactly one resolution wins, journal/audit/PENDING consistent with the winner',
    async () => {
      const wins = { CREDIT_RESPONDENT: 0, DISMISSED: 0 };
      for (let round = 0; round < 6; round++) {
        const pub = await h.user('PUBLISHER');
        const resp = await h.user('RESPONDENT');
        const { form, version } = await createExternalSurveyWithEscrow(
          pub,
          50,
          10,
        );
        const attempt = await createReportedAttempt(form.id, version.id, resp);

        // Alternate which request is issued first so both winners are exercised.
        const sendCredit = () =>
          resolve(
            attempt.id,
            admin,
            'CREDIT_RESPONDENT',
            'Race: credit the respondent.',
          );
        const sendDismiss = () =>
          resolve(
            attempt.id,
            otherAdmin,
            'DISMISSED',
            'Race: dismiss the report.',
          );
        let credit: Awaited<ReturnType<typeof sendCredit>>;
        let dismiss: Awaited<ReturnType<typeof sendDismiss>>;
        if (round % 2 === 0) {
          [credit, dismiss] = await Promise.all([sendCredit(), sendDismiss()]);
        } else {
          [dismiss, credit] = await Promise.all([sendDismiss(), sendCredit()]);
        }

        const statuses = [credit.status, dismiss.status].sort();
        expect(statuses).toEqual([200, 409]);
        const loser = credit.status === 409 ? credit : dismiss;
        expect(loser.body.error.code).toBe(
          'MISSING_CODE_REPORT_ALREADY_RESOLVED',
        );
        const winner =
          credit.status === 200 ? 'CREDIT_RESPONDENT' : 'DISMISSED';
        wins[winner] += 1;

        const row = await h.prisma.surveyAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        });
        expect(row.missingCodeResolution).toBe(winner);
        expect(row.missingCodeResolvedById).toBe(
          winner === 'CREDIT_RESPONDENT' ? admin.id : otherAdmin.id,
        );
        expect(await auditRows(attempt.id)).toHaveLength(1);

        const journals = await externalJournals(attempt.id);
        if (winner === 'CREDIT_RESPONDENT') {
          expect(row.status).toBe('COMPLETED');
          expect(journals).toHaveLength(1);
          expect(await pendingBalance(resp.id)).toBe(50);
        } else {
          expect(row.status).toBe('IN_PROGRESS');
          expect(journals).toHaveLength(0);
          expect(await pendingBalance(resp.id)).toBe(0);
        }
      }
      expect(wins.CREDIT_RESPONDENT + wins.DISMISSED).toBe(6);
    },
    120_000,
  );

  liveIt(
    '13. admin CREDIT_RESPONDENT vs the Respondent late correct code: one external-completion journal, PENDING credited once, attempt COMPLETED',
    async () => {
      const codes = new CompletionCodeService(
        h.app.get(EnvService, { strict: false }),
      );
      const CODE = 'abc123';
      const outcomes = { adminWon: 0, respondentWon: 0 };
      for (let round = 0; round < 6; round++) {
        const pub = await h.user('PUBLISHER');
        const resp = await h.user('RESPONDENT');
        const { form, version } = await createExternalSurveyWithEscrow(
          pub,
          50,
          10,
        );
        await h.prisma.formVersion.update({
          where: { id: version.id },
          data: { completionCode: codes.computeVerifier(version.id, CODE) },
        });
        // Started past the time barrier, still inside the reservation window.
        const attempt = await h.prisma.surveyAttempt.create({
          data: {
            surveyId: form.id,
            formVersionId: version.id,
            respondentId: resp.id,
            status: 'IN_PROGRESS',
            isGuest: false,
            startedAt: new Date(Date.now() - 120_000),
            missingCodeReportedAt: new Date(),
            missingCodeReason: 'Code never shown after the Google Form',
          },
        });

        const [adminRes, verifyRes] = await Promise.all([
          resolve(
            attempt.id,
            admin,
            'CREDIT_RESPONDENT',
            'Race: admin credit vs late code.',
          ),
          h.send('post', `/attempts/${attempt.id}/verify-code`, resp, {
            completionCode: CODE,
          }),
        ]);

        // The Respondent's call always succeeds (fresh claim or replay).
        expect(verifyRes.status).toBe(200);
        if (adminRes.status === 200) {
          expect(adminRes.body.data.replayed).toBe(false);
          outcomes.adminWon += 1;
        } else {
          expect(adminRes.status).toBe(409);
          expect(adminRes.body.error.code).toBe('SURVEY_ALREADY_COMPLETED');
          outcomes.respondentWon += 1;
        }

        const row = await h.prisma.surveyAttempt.findUniqueOrThrow({
          where: { id: attempt.id },
        });
        expect(row.status).toBe('COMPLETED');
        expect(await externalJournals(attempt.id)).toHaveLength(1);
        expect(await pendingBalance(resp.id)).toBe(50);
        // Audit row only when the admin resolution actually landed.
        expect(await auditRows(attempt.id)).toHaveLength(
          adminRes.status === 200 ? 1 : 0,
        );
      }
      expect(outcomes.adminWon + outcomes.respondentWon).toBe(6);
    },
    120_000,
  );

  liveIt(
    '14. a resolved report leaves countUnresolved and listUnresolved of the report stats adapter',
    async () => {
      const stats = h.app.get<MissingCodeReportStatsPort>(
        MISSING_CODE_REPORT_STATS_PORT,
        { strict: false },
      );
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);

      const before = await stats.countUnresolved();
      const listedBefore = await stats.listUnresolved(null, 200);
      expect(listedBefore.map((r) => r.attemptId)).toContain(attempt.id);

      const res = await resolve(
        attempt.id,
        admin,
        'DISMISSED',
        'Resolved, so it leaves the queue.',
      );
      expect(res.status).toBe(200);

      expect(await stats.countUnresolved()).toBe(before - 1);
      const listedAfter = await stats.listUnresolved(null, 200);
      expect(listedAfter.map((r) => r.attemptId)).not.toContain(attempt.id);
    },
    60_000,
  );

  liveIt(
    '16. CREDIT on a cancelled attempt: 409 MISSING_CODE_ATTEMPT_CANCELLED, no journal, report stays open; DISMISSED still succeeds',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(
        form.id,
        version.id,
        resp,
        'ABANDONED',
      );
      await h.prisma.surveyAttempt.update({
        where: { id: attempt.id },
        data: { closedReason: 'CANCELLED' },
      });

      const credit = await resolve(
        attempt.id,
        admin,
        'CREDIT_RESPONDENT',
        'Trying to credit a cancelled attempt.',
      );
      expect(credit.status).toBe(409);
      expect(credit.body.error.code).toBe('MISSING_CODE_ATTEMPT_CANCELLED');
      expect(await externalJournals(attempt.id)).toHaveLength(0);
      expect(await pendingBalance(resp.id)).toBe(0);
      const open = await h.prisma.surveyAttempt.findUniqueOrThrow({
        where: { id: attempt.id },
      });
      expect(open.missingCodeResolvedAt).toBeNull();
      expect(open.status).toBe('ABANDONED');
      expect(await auditRows(attempt.id)).toHaveLength(0);

      const dismiss = await resolve(
        attempt.id,
        admin,
        'DISMISSED',
        'Cancelled by the respondent, so dismissed.',
      );
      expect(dismiss.status).toBe(200);
      expect(dismiss.body.data.outcome).toBe('DISMISSED');
    },
    60_000,
  );

  liveIt(
    '17. listUnresolved flags: attemptCancelled, respondentCompletedForm and both false for a plain reported attempt',
    async () => {
      const stats = h.app.get<MissingCodeReportStatsPort>(
        MISSING_CODE_REPORT_STATS_PORT,
        { strict: false },
      );
      const pub = await h.user('PUBLISHER');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );

      const plainResp = await h.user('RESPONDENT');
      const plain = await createReportedAttempt(form.id, version.id, plainResp);

      const cancelResp = await h.user('RESPONDENT');
      const cancelled = await createReportedAttempt(
        form.id,
        version.id,
        cancelResp,
        'ABANDONED',
      );
      await h.prisma.surveyAttempt.update({
        where: { id: cancelled.id },
        data: { closedReason: 'CANCELLED' },
      });

      const doneResp = await h.user('RESPONDENT');
      const reportedAgain = await createReportedAttempt(
        form.id,
        version.id,
        doneResp,
      );
      await h.prisma.surveyAttempt.create({
        data: {
          surveyId: form.id,
          formVersionId: version.id,
          respondentId: doneResp.id,
          status: 'COMPLETED',
          submittedAt: new Date(),
        },
      });

      // Pre-IR.2a ABANDONED rows keep a NULL closed_reason (no backfill).
      const legacyResp = await h.user('RESPONDENT');
      const legacy = await createReportedAttempt(
        form.id,
        version.id,
        legacyResp,
        'ABANDONED',
      );
      await h.prisma.surveyAttempt.update({
        where: { id: legacy.id },
        data: { closedReason: null },
      });

      const rows = await stats.listUnresolved(null, 200);
      const byId = new Map(rows.map((r) => [r.attemptId, r]));
      expect(byId.get(plain.id)).toMatchObject({
        attemptCancelled: false,
        respondentCompletedForm: false,
      });
      expect(byId.get(legacy.id)?.attemptCancelled).toBe(false);
      expect(byId.get(cancelled.id)).toMatchObject({
        attemptCancelled: true,
        respondentCompletedForm: false,
      });
      expect(byId.get(reportedAgain.id)).toMatchObject({
        attemptCancelled: false,
        respondentCompletedForm: true,
      });
    },
    60_000,
  );

  liveIt(
    '18. respondent re-report after a DISMISSED resolution: 409 MISSING_CODE_REPORT_ALREADY_RESOLVED',
    async () => {
      const pub = await h.user('PUBLISHER');
      const resp = await h.user('RESPONDENT');
      const { form, version } = await createExternalSurveyWithEscrow(
        pub,
        50,
        10,
      );
      const attempt = await createReportedAttempt(form.id, version.id, resp);
      const dismissed = await resolve(
        attempt.id,
        admin,
        'DISMISSED',
        'No proof of survey submission.',
      );
      expect(dismissed.status).toBe(200);

      const rereport = await h.send(
        'post',
        `/attempts/${attempt.id}/report-missing-code`,
        resp,
        { reason: 'I still did not get the code' },
      );
      expect(rereport.status).toBe(409);
      expect(rereport.body.error.code).toBe(
        'MISSING_CODE_REPORT_ALREADY_RESOLVED',
      );
    },
    60_000,
  );

  describe('CHECK survey_attempts_missing_code_resolution_consistent', () => {
    const CONSTRAINT = /survey_attempts_missing_code_resolution_consistent/;

    liveIt(
      '15a. rejects a half-set resolution (only the resolution column)',
      async () => {
        const pub = await h.user('PUBLISHER');
        const resp = await h.user('RESPONDENT');
        const { form, version } = await createExternalSurveyWithEscrow(
          pub,
          50,
          10,
        );
        const attempt = await createReportedAttempt(form.id, version.id, resp);

        await expect(
          h.prisma.$executeRawUnsafe(
            `UPDATE survey_attempts SET missing_code_resolution = 'DISMISSED'::"MissingCodeResolution" WHERE id = $1::uuid`,
            attempt.id,
          ),
        ).rejects.toThrow(CONSTRAINT);
      },
      60_000,
    );

    liveIt(
      '15b. rejects three of the four columns (resolver missing)',
      async () => {
        const pub = await h.user('PUBLISHER');
        const resp = await h.user('RESPONDENT');
        const { form, version } = await createExternalSurveyWithEscrow(
          pub,
          50,
          10,
        );
        const attempt = await createReportedAttempt(form.id, version.id, resp);

        await expect(
          h.prisma.$executeRawUnsafe(
            `UPDATE survey_attempts
               SET missing_code_resolved_at = now(),
                   missing_code_resolution = 'DISMISSED'::"MissingCodeResolution",
                   missing_code_resolution_note = 'Only three columns are set.'
             WHERE id = $1::uuid`,
            attempt.id,
          ),
        ).rejects.toThrow(CONSTRAINT);
      },
      60_000,
    );

    liveIt(
      '15c. rejects a full resolution when missing_code_reported_at IS NULL',
      async () => {
        const pub = await h.user('PUBLISHER');
        const resp = await h.user('RESPONDENT');
        const { form, version } = await createExternalSurveyWithEscrow(
          pub,
          50,
          10,
        );
        const unreported = await h.prisma.surveyAttempt.create({
          data: {
            surveyId: form.id,
            formVersionId: version.id,
            respondentId: resp.id,
            status: 'IN_PROGRESS',
            isGuest: false,
          },
        });

        await expect(
          h.prisma.$executeRawUnsafe(
            `UPDATE survey_attempts
               SET missing_code_resolved_at = now(),
                   missing_code_resolution = 'DISMISSED'::"MissingCodeResolution",
                   missing_code_resolution_note = 'No report exists for this attempt.',
                   missing_code_resolved_by = $2::uuid
             WHERE id = $1::uuid`,
            unreported.id,
            admin.id,
          ),
        ).rejects.toThrow(CONSTRAINT);
      },
      60_000,
    );

    liveIt(
      '15d. accepts a fully-set resolution on a reported attempt',
      async () => {
        const pub = await h.user('PUBLISHER');
        const resp = await h.user('RESPONDENT');
        const { form, version } = await createExternalSurveyWithEscrow(
          pub,
          50,
          10,
        );
        const attempt = await createReportedAttempt(form.id, version.id, resp);

        await expect(
          h.prisma.$executeRawUnsafe(
            `UPDATE survey_attempts
               SET missing_code_resolved_at = now(),
                   missing_code_resolution = 'DISMISSED'::"MissingCodeResolution",
                   missing_code_resolution_note = 'All four columns are set.',
                   missing_code_resolved_by = $2::uuid
             WHERE id = $1::uuid`,
            attempt.id,
            admin.id,
          ),
        ).resolves.toBe(1);
      },
      60_000,
    );
  });
});
