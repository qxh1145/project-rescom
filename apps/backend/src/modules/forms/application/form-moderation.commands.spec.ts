import { InMemoryFormRepository } from '../infrastructure/in-memory-form.repository';
import { InMemoryLedgerRepository } from '../../economy/infrastructure/in-memory-ledger.repository';
import { LedgerService } from '../../economy/application/ledger.service';
import { FormsEscrowCoordinator } from './forms-escrow.coordinator';
import { FormModerationCommands } from './form-moderation.commands';
import { FormEntity } from '../domain/form.entity';
import { FormVersionEntity } from '../domain/form-version.entity';
import { FormStatusEnum } from '@rescom/schemas';
import {
  FormValidationException,
  ModerationEscrowNotFundedException,
} from './exceptions/form.exceptions';

describe('Story 8.1: FormModerationCommands (Research commands for moderation)', () => {
  const publisherId = '11111111-1111-4111-8111-111111111111';
  const schema = {
    schemaVersion: 1,
    title: 'Survey',
    blocks: [{ id: 'b-1', type: 'text', order: 0, title: 'Q', required: true }],
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: false,
      allowPublicAccess: true,
      submitButtonText: 'Submit',
    },
    metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
  } as const;

  let formRepo: InMemoryFormRepository;
  let ledgerService: LedgerService;
  let escrow: FormsEscrowCoordinator;
  let commands: FormModerationCommands;
  let sequence = 0;

  async function seed(
    status: FormStatusEnum = 'MODERATION_QUEUE',
    updatedAt = new Date(Date.UTC(2026, 8, 26, 10, sequence)),
  ) {
    sequence += 1;
    const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, '0')}`;
    const versionId = `bbbbbbbb-bbbb-4bbb-8bbb-${String(sequence).padStart(12, '0')}`;
    const form = new FormEntity(
      id,
      publisherId,
      'INTERNAL',
      status,
      `Survey ${sequence}`,
      null,
      10, // 8 effective
      50, // 400 escrow
      updatedAt,
      updatedAt,
    );
    const version = new FormVersionEntity(
      versionId,
      id,
      1,
      schema as never,
      null,
      false,
      null,
      null,
      null,
      updatedAt,
    );
    await formRepo.create(form, version);
    await escrow.coordinatePublish(form, version, publisherId);
    return (await formRepo.findById(id))!;
  }

  beforeEach(async () => {
    sequence = 0;
    formRepo = new InMemoryFormRepository();
    ledgerService = new LedgerService(new InMemoryLedgerRepository());
    escrow = new FormsEscrowCoordinator(formRepo, ledgerService);
    commands = new FormModerationCommands(formRepo, escrow);

    const system = await ledgerService.getOrCreateAccount(
      null,
      'SYSTEM_ISSUANCE',
    );
    const available = await ledgerService.getOrCreateAccount(
      publisherId,
      'USER_AVAILABLE',
    );
    await ledgerService.transfer({
      fromAccountId: system.id,
      toAccountId: available.id,
      amount: 2000,
      idempotencyKey: 'seed-moderation-publisher',
    });
  });

  it('lists queued forms oldest submission first and paginates', async () => {
    const newest = await seed(
      'MODERATION_QUEUE',
      new Date('2026-09-26T12:00:00Z'),
    );
    const oldest = await seed(
      'MODERATION_QUEUE',
      new Date('2026-09-26T08:00:00Z'),
    );
    await seed('PUBLISHED', new Date('2026-09-26T07:00:00Z'));

    const page = await commands.listQueue({ limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.items.map((i) => i.form.id)).toEqual([oldest.form.id]);

    const next = await commands.listQueue({ limit: 1, offset: 1 });
    expect(next.items.map((i) => i.form.id)).toEqual([newest.form.id]);
  });

  it('approves: MODERATION_QUEUE -> PUBLISHED and the pinned version goes live', async () => {
    const snapshot = await seed();
    const approvedAt = new Date('2026-09-26T13:00:00Z');

    const approved = await commands.approvePublication(snapshot, approvedAt);

    expect(approved?.form.status).toBe('PUBLISHED');
    expect(approved?.currentVersion.isPublished).toBe(true);
    expect(approved?.currentVersion.publishedAt).toEqual(approvedAt);
    const stored = await formRepo.findById(snapshot.form.id);
    expect(stored?.form.status).toBe('PUBLISHED');
    // Approval moves no money: the reservation stays in Escrow.
    expect((await ledgerService.getWallet(publisherId)).balance.escrow).toBe(
      400,
    );
  });

  it('rejects: MODERATION_QUEUE -> CLOSED and refunds the full reservation', async () => {
    const snapshot = await seed();

    const result = await commands.rejectPublication(snapshot, new Date());

    expect(result?.record.form.status).toBe('CLOSED');
    // Decision E8-D1: a moderation rejection is final (never reopenable).
    expect(result?.record.form.closeKind).toBe('MODERATION');
    expect(result?.record.form.isReopenableByOwner()).toBe(false);
    expect(result?.record.currentVersion.isPublished).toBe(false);
    expect(result?.refund.refundAmount).toBe(400);
    expect(result?.refund.refundJournalId).not.toBeNull();
    const wallet = await ledgerService.getWallet(publisherId);
    expect(wallet.balance.escrow).toBe(0);
    expect(wallet.balance.available).toBe(2000);
  });

  it('returns null for a form that is not queued', async () => {
    const published = await seed('PUBLISHED');
    expect(await commands.approvePublication(published, new Date())).toBeNull();
    expect(await commands.rejectPublication(published, new Date())).toBeNull();
  });

  it('returns null when the snapshot is stale (e.g. completion code rotated)', async () => {
    const snapshot = await seed();
    await formRepo.update(
      snapshot.form.copyWith({ updatedAt: new Date('2027-01-01T00:00:00Z') }),
    );

    expect(await commands.approvePublication(snapshot, new Date())).toBeNull();
    expect(await commands.rejectPublication(snapshot, new Date())).toBeNull();
    expect((await formRepo.findById(snapshot.form.id))?.form.status).toBe(
      'MODERATION_QUEUE',
    );
    expect((await ledgerService.getWallet(publisherId)).balance.escrow).toBe(
      400,
    );
  });

  it('lets exactly one of a concurrent approve and reject win; the loser never refunds', async () => {
    const snapshot = await seed();

    const [approved, rejected] = await Promise.all([
      commands.approvePublication(snapshot, new Date()),
      commands.rejectPublication(snapshot, new Date()),
    ]);

    expect([approved, rejected].filter((r) => r !== null)).toHaveLength(1);
    const stored = await formRepo.findById(snapshot.form.id);
    const wallet = await ledgerService.getWallet(publisherId);
    if (approved) {
      expect(stored?.form.status).toBe('PUBLISHED');
      expect(wallet.balance.escrow).toBe(400);
    } else {
      expect(stored?.form.status).toBe('CLOSED');
      expect(wallet.balance.escrow).toBe(0);
    }
  });

  it('detects re-submissions of a survey that was already live', async () => {
    const snapshot = await seed();
    expect(commands.hasEarlierLiveVersion(snapshot)).toBe(false);

    const v2 = new FormVersionEntity(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      snapshot.form.id,
      2,
      schema as never,
      null,
      false,
      null,
      null,
      null,
      new Date(),
    );
    await formRepo.update(
      snapshot.form,
      snapshot.currentVersion.copyWith({ isPublished: true }),
    );
    await formRepo.update(snapshot.form, v2);
    const resubmitted = (await formRepo.findById(snapshot.form.id))!;
    expect(resubmitted.currentVersion.id).toBe(v2.id);
    expect(commands.hasEarlierLiveVersion(resubmitted)).toBe(true);
  });

  describe('Epic 8 review P2: approval verifies funding and publishability', () => {
    let rowSequence = 0;

    /** A queued row seeded directly (no publish path, optional reservation). */
    async function seedRow(options: {
      type?: 'INTERNAL' | 'EXTERNAL';
      reward?: number;
      reserve?: number;
      externalUrl?: string | null;
      completionCode?: string | null;
      targetingJson?: unknown;
      schemaJson?: unknown;
    }) {
      rowSequence += 1;
      const suffix = String(rowSequence).padStart(12, '0');
      const now = new Date(Date.UTC(2026, 8, 26, 9, rowSequence));
      const form = new FormEntity(
        `dddddddd-dddd-4ddd-8ddd-${suffix}`,
        publisherId,
        options.type ?? 'INTERNAL',
        'MODERATION_QUEUE',
        `Row ${rowSequence}`,
        null,
        options.reward ?? 10,
        50,
        now,
        now,
      );
      const version = new FormVersionEntity(
        `eeeeeeee-eeee-4eee-8eee-${suffix}`,
        form.id,
        1,
        (options.schemaJson ?? schema) as never,
        (options.targetingJson ?? null) as never,
        false,
        options.externalUrl ?? null,
        options.completionCode ?? null,
        null,
        now,
      );
      await formRepo.create(form, version);
      if (options.reserve) {
        await ledgerService.reserveEscrow({
          userId: publisherId,
          formVersionId: version.id,
          amount: options.reserve,
          formTitle: form.title,
        });
      }
      return (await formRepo.findById(form.id))!;
    }

    it('refuses an unfunded rewarded survey (legacy row without a publish journal) and leaves it queued', async () => {
      const snapshot = await seedRow({ reward: 10 }); // needs 50 x 8 = 400

      await expect(
        commands.approvePublication(snapshot, new Date()),
      ).rejects.toMatchObject({
        constructor: ModerationEscrowNotFundedException,
        code: 'MODERATION_ESCROW_NOT_FUNDED',
        shortfall: 400,
      });
      expect((await formRepo.findById(snapshot.form.id))?.form.status).toBe(
        'MODERATION_QUEUE',
      );
    });

    it('refuses a partly funded survey with the exact shortfall', async () => {
      const snapshot = await seedRow({ reward: 10, reserve: 150 });

      await expect(
        commands.approvePublication(snapshot, new Date()),
      ).rejects.toMatchObject({ shortfall: 250 });
      expect(await commands.getFundingPosition(snapshot)).toEqual({
        required: 400,
        held: 150,
        shortfall: 250,
      });
    });

    it('approves a fully funded row and a free survey (no Escrow needed)', async () => {
      const funded = await seedRow({ reward: 10, reserve: 400 });
      const free = await seedRow({ reward: 0 });

      expect(
        (await commands.approvePublication(funded, new Date()))?.form.status,
      ).toBe('PUBLISHED');
      expect(
        (await commands.approvePublication(free, new Date()))?.form.status,
      ).toBe('PUBLISHED');
      expect(await commands.getFundingPosition(free)).toEqual({
        required: 0,
        held: 0,
        shortfall: 0,
      });
    });

    it('approves a re-submission funded by the carried-over Escrow plus a shortfall-only reservation (Epic 6 P4)', async () => {
      const v1 = await seed();
      const live = await commands.approvePublication(v1, new Date());
      expect(live?.form.status).toBe('PUBLISHED');

      // v2 raises the quota 50 -> 60: only the 10 extra slots (80) are locked.
      const v2 = new FormVersionEntity(
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
        v1.form.id,
        2,
        schema as never,
        null,
        false,
        null,
        null,
        null,
        new Date(),
      );
      const queuedForm = live!.form.copyWith({
        status: 'MODERATION_QUEUE',
        expectedCompletions: 60,
        updatedAt: new Date('2026-09-26T14:00:00Z'),
      });
      await formRepo.update(queuedForm, v2);
      const publish = await escrow.coordinatePublish(
        queuedForm,
        v2,
        publisherId,
      );
      expect(publish.reservedAmount).toBe(80);

      const resubmitted = (await formRepo.findById(v1.form.id))!;
      const approved = await commands.approvePublication(
        resubmitted,
        new Date(),
      );
      expect(approved?.form.status).toBe('PUBLISHED');
      expect(approved?.currentVersion.id).toBe(v2.id);
      expect((await ledgerService.getWallet(publisherId)).balance.escrow).toBe(
        480,
      );
    });

    it('re-runs the publish validations on the stored version (422)', async () => {
      const noCode = await seedRow({
        type: 'EXTERNAL',
        reward: 0,
        externalUrl: 'https://forms.gle/legacy',
      });
      const httpUrl = await seedRow({
        type: 'EXTERNAL',
        reward: 0,
        externalUrl: 'http://forms.gle/legacy',
        completionCode: 'verifier',
      });
      const badTargeting = await seedRow({
        reward: 0,
        targetingJson: { locations: [1] },
      });
      const noBlocks = await seedRow({
        reward: 0,
        schemaJson: { ...schema, blocks: [] },
      });

      await expect(
        commands.approvePublication(noCode, new Date()),
      ).rejects.toMatchObject({
        constructor: FormValidationException,
        code: 'EXTERNAL_COMPLETION_CODE_REQUIRED',
      });
      for (const snapshot of [httpUrl, badTargeting, noBlocks]) {
        await expect(
          commands.approvePublication(snapshot, new Date()),
        ).rejects.toMatchObject({
          constructor: FormValidationException,
          code: 'FORM_VALIDATION_ERROR',
        });
        expect((await formRepo.findById(snapshot.form.id))?.form.status).toBe(
          'MODERATION_QUEUE',
        );
      }
    });
  });

  it('works without an escrow coordinator (no refund)', async () => {
    const snapshot = await seed();
    const bare = new FormModerationCommands(formRepo);

    const result = await bare.rejectPublication(snapshot, new Date());

    expect(result?.refund).toEqual({
      refundJournalId: null,
      refundIdempotencyKey: null,
      refundAmount: 0,
      unusedCompletions: 0,
    });
  });
});
