import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * Live check that `prisma migrate deploy` on an empty database yields every
 * object the application relies on, including the ones earlier migrations
 * only created behind a `to_regclass` guard. Drops and recreates the target
 * database schema (`prisma migrate reset`), so it only runs against a
 * dedicated database whose name ends in `_test`.
 */
describe('Prisma migration chain on PostgreSQL', () => {
  const databaseUrl =
    process.env.MIGRATION_TEST_DATABASE_URL ??
    'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_migration_test?schema=public';
  const backendDir = path.resolve(__dirname, '..');
  const prismaCli = require.resolve('prisma/build/index.js', {
    paths: [backendDir],
  });
  let prisma: PrismaClient;
  let dbAvailable = false;

  function runPrisma(args: string[]): void {
    execFileSync(process.execPath, [prismaCli, ...args], {
      cwd: backendDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    });
  }

  beforeAll(async () => {
    const databaseName = new URL(databaseUrl).pathname.slice(1);
    if (!databaseName.endsWith('_test')) {
      throw new Error(
        'MIGRATION_TEST_DATABASE_URL must target a dedicated database ending in _test',
      );
    }

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await prisma.$connect();
      dbAvailable = true;
    } catch {
      console.warn(
        `Postgres DB at ${databaseUrl} is unreachable. Skipping live migration tests.`,
      );
      return;
    }

    await prisma.$disconnect();
    runPrisma([
      'migrate',
      'reset',
      '--force',
      '--skip-generate',
      '--skip-seed',
      '--schema',
      'prisma/schema.prisma',
    ]);
    await prisma.$connect();
  }, 180_000);

  afterAll(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  async function indexDef(name: string): Promise<string | undefined> {
    const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND indexname = ${name}`;
    return rows[0]?.indexdef;
  }

  async function constraintDef(name: string): Promise<string | undefined> {
    const rows = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = ${name}`;
    return rows[0]?.def;
  }

  it('creates PayOS sequence, constraints and one-processing index (13.1)', async () => {
    if (!dbAvailable) return;
    const sequence = await prisma.$queryRaw<Array<{ start_value: bigint }>>`
      SELECT start_value FROM pg_sequences WHERE schemaname = current_schema()
        AND sequencename = 'top_up_order_code_seq'`;
    expect(sequence[0]?.start_value).toBe(BigInt(1000000000));
    await expect(
      indexDef('top_up_requests_one_processing_per_user'),
    ).resolves.toMatch(/UNIQUE INDEX .* WHERE .*'PROCESSING'/);
    await expect(
      constraintDef('top_up_requests_payos_amount_check'),
    ).resolves.toContain('amount_vnd');
    await expect(
      constraintDef('top_up_requests_channel_shape_check'),
    ).resolves.toContain('order_code');
    await expect(
      constraintDef('top_up_requests_channel_status_check'),
    ).resolves.toContain('PROCESSING');
  });

  it('creates top-up refund requests table and constraints (13.10)', async () => {
    if (!dbAvailable) return;
    const ledgerClasses = await enumValues('LedgerAccountClass');
    expect(ledgerClasses).toContain('REFUND_HOLD');
    const refundStatuses = await enumValues('TopUpRefundStatus');
    expect(refundStatuses).toEqual([
      'REQUESTED',
      'WITHDRAWN',
      'REFUNDED',
      'REJECTED',
    ]);
    const refundCols = await columnsOf('top_up_refund_requests');
    expect(refundCols.has('top_up_id')).toBe(true);
    expect(refundCols.has('destination_verified')).toBe(true);
    await expect(
      constraintDef('top_up_refund_requests_note_check'),
    ).resolves.toContain('btrim');
    await expect(
      constraintDef('top_up_refund_requests_eligibility_check'),
    ).resolves.toContain('hold_journal_id');
    await expect(
      constraintDef('top_up_refund_requests_withdrawn_check'),
    ).resolves.toContain('withdrawn_at');
    await expect(
      constraintDef('top_up_refund_requests_release_check'),
    ).resolves.toContain('release_journal_id');
    await expect(
      constraintDef('ledger_accounts_owner_class_check'),
    ).resolves.toContain('REFUND_HOLD');
  });

  it('creates every table previously built only by db push', async () => {
    if (!dbAvailable) return;
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema()`;
    const tables = rows.map((row) => row.table_name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'forms',
        'form_versions',
        'responses',
        'survey_attempts',
        'fraud_logs',
        'outbox_events',
        'processed_handlers',
        'demographic_profiles',
        'gamification_stats',
        'integrity_consents',
        'integrity_events',
        'integrity_assessments',
        'respondent_reputations',
        'integrity_incidents',
        'integrity_reviews',
        'scoring_policies',
      ]),
    );
  });

  it('creates the partial unique indexes on survey_attempts', async () => {
    if (!dbAvailable) return;
    await expect(
      indexDef('survey_attempts_one_active_per_account'),
    ).resolves.toMatch(/UNIQUE INDEX .* WHERE .*'IN_PROGRESS'/);
    await expect(
      indexDef('survey_attempts_one_completion_per_account'),
    ).resolves.toMatch(/UNIQUE INDEX .* WHERE .*'COMPLETED'/);
  });

  it('creates the Rewards catalog schema, indexes and append-only triggers (12.7)', async () => {
    if (!dbAvailable) return;
    await expect(indexDef('voucher_codes_unissued_idx')).resolves.toMatch(
      /WHERE .*redemption_id IS NULL/,
    );
    await expect(
      indexDef('redemptions_voucher_id_created_at_idx'),
    ).resolves.toMatch(/voucher_id, created_at DESC/);
    const triggers = await prisma.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
        'voucher_price_versions_append_only', 'voucher_price_versions_no_truncate',
        'redemptions_append_only', 'redemptions_no_truncate')`;
    expect(triggers).toHaveLength(4);
    const brands = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM voucher_brands`;
    expect(Number(brands[0].n)).toBeGreaterThanOrEqual(6);
  });

  it('creates the Rewards redemption transaction schema and settings (12.8)', async () => {
    if (!dbAvailable) return;
    const fraudLogTypes = await enumValues('FraudLogType');
    expect(fraudLogTypes).toContain('FLASH_AFTER_TOPUP');

    const redemptionsCols = await columnsOf('redemptions');
    expect(redemptionsCols.get('balance_after')).toBe('YES');
    expect(redemptionsCols.get('failure_details')).toBe('YES');

    const settingsRows = await prisma.$queryRaw<
      { id: number; daily_points_limit: number }[]
    >`
      SELECT id, daily_points_limit FROM rewards_settings WHERE id = 1`;
    expect(settingsRows).toHaveLength(1);
    expect(settingsRows[0].daily_points_limit).toBe(500);

    await expect(
      indexDef('redemptions_quote_id_succeeded_key'),
    ).resolves.toMatch(/UNIQUE INDEX .* WHERE .*status = 'SUCCEEDED'/);
    await expect(
      indexDef('redemptions_user_id_created_at_idx'),
    ).resolves.toMatch(/user_id, created_at DESC/);
  });

  it('creates the Rewards flash sale lifecycle schema and claims (12.9)', async () => {
    if (!dbAvailable) return;
    const flashSalesCols = await columnsOf('flash_sales');
    expect(flashSalesCols.get('reserved_at')).toBe('YES');

    await expect(
      constraintDef('flash_sales_reserved_at_check'),
    ).resolves.toMatch(/CHECK/);

    await expect(indexDef('flash_sales_starts_at_due_idx')).resolves.toMatch(
      /WHERE .*reserved_at IS NULL\)? AND \(?settled_at IS NULL/,
    );
    await expect(indexDef('flash_sales_ends_at_due_idx')).resolves.toMatch(
      /WHERE .*reserved_at IS NOT NULL\)? AND \(?settled_at IS NULL/,
    );

    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = current_schema() AND table_name = 'flash_item_claims'`;
    expect(rows).toHaveLength(1);

    await expect(constraintDef('flash_item_claims_pkey')).resolves.toMatch(
      /PRIMARY KEY \(flash_sale_item_id, user_id\)/,
    );
  });

  it('creates the ledger account index with NULLS NOT DISTINCT', async () => {
    if (!dbAvailable) return;
    await expect(
      indexDef('ledger_accounts_user_id_account_class_currency_key'),
    ).resolves.toMatch(/UNIQUE INDEX .*NULLS NOT DISTINCT/);
  });

  it('creates the constraints earlier migrations guarded', async () => {
    if (!dbAvailable) return;
    await expect(
      constraintDef('forms_estimated_duration_minutes_range'),
    ).resolves.toMatch(/CHECK/);
    for (const foreignKey of [
      'survey_moderation_decisions_form_id_fkey',
      'survey_moderation_decisions_form_version_id_fkey',
      'survey_feedback_attempt_id_fkey',
      'survey_feedback_response_id_fkey',
      'survey_feedback_form_id_fkey',
      'survey_feedback_form_version_id_fkey',
      'completion_code_limit_resets_form_version_id_fkey',
    ]) {
      await expect(constraintDef(foreignKey)).resolves.toMatch(/FOREIGN KEY/);
    }
    await expect(indexDef('fraud_logs_dedupe_key_key')).resolves.toBeDefined();
  });

  async function columnsOf(table: string): Promise<Map<string, string>> {
    const rows = await prisma.$queryRaw<
      Array<{ column_name: string; is_nullable: string }>
    >`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ${table}`;
    return new Map(rows.map((row) => [row.column_name, row.is_nullable]));
  }

  async function enumValues(typeName: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ label: string }>>`
      SELECT e.enumlabel AS label FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${typeName}
      ORDER BY e.enumsortorder`;
    return rows.map((row) => row.label);
  }

  it('creates the IR.2b scheduler schema (IR.2b Task 1.8)', async () => {
    if (!dbAvailable) return;
    const leases = await columnsOf('scheduler_job_leases');
    for (const column of [
      'job_name',
      'lease_owner',
      'fencing_token',
      'lease_expires_at',
      'next_run_at',
      'last_status',
      'last_summary',
      'consecutive_failures',
    ]) {
      expect({ column, found: leases.has(column) }).toEqual({
        column,
        found: true,
      });
    }
    const forms = await columnsOf('forms');
    expect(forms.get('deadline_at')).toBe('YES');
    expect(forms.get('topic')).toBe('YES');
    const attempts = await columnsOf('survey_attempts');
    expect(attempts.get('closed_reason')).toBe('YES');
    expect(attempts.get('closed_at')).toBe('YES');
    await expect(
      indexDef('survey_attempts_status_started_at_idx'),
    ).resolves.toMatch(/\(status, started_at\)/);
    await expect(indexDef('forms_status_deadline_at_idx')).resolves.toMatch(
      /\(status, deadline_at\)/,
    );
    await expect(
      indexDef('outbox_events_ordering_stream_stream_sequence_idx'),
    ).resolves.toBeDefined();
    await expect(
      indexDef('outbox_events_event_type_status_idx'),
    ).resolves.toBeDefined();
    await expect(enumValues('FormCloseKind')).resolves.toEqual([
      'OWNER',
      'ADMIN',
      'MODERATION',
      'DEADLINE',
      'QUOTA',
    ]);
  });

  it('creates the IR.4a publisher results indexes, including the partial ones', async () => {
    if (!dbAvailable) return;
    await expect(
      indexDef('survey_attempts_survey_id_status_submitted_at_idx'),
    ).resolves.toMatch(/\(survey_id, status, submitted_at\)/);
    await expect(
      indexDef('responses_version_completed_feed_idx'),
    ).resolves.toMatch(
      /\(form_version_id, submitted_at DESC, id DESC\) WHERE .*SUBMITTED.*VALIDATED/,
    );
    await expect(
      indexDef('responses_form_completed_submitted_idx'),
    ).resolves.toMatch(
      /\(form_id, submitted_at\) WHERE .*SUBMITTED.*VALIDATED/,
    );
  });

  it('creates the IR.4b email delivery schema and notification types', async () => {
    if (!dbAvailable) return;
    const values = await enumValues('NotificationType');
    expect(values.slice(-11)).toEqual([
      'TOPUP_REJECTED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
      'VOUCHER_EXPIRING',
      'CODE_ISSUE_RESOLVED',
      'TOPUP_CANCELLED',
      'TOPUP_AMOUNT_MISMATCH',
      'TOPUP_REFUNDED',
      'TOPUP_REFUND_REQUESTED',
      'TOPUP_REFUND_WITHDRAWN',
      'TOPUP_REFUND_REJECTED',
    ]);
    const deliveries = await columnsOf('email_deliveries');
    expect(deliveries.has('idempotency_key')).toBe(true);
    expect(deliveries.has('notification_id')).toBe(true);
    expect(deliveries.has('recipient')).toBe(false);
    expect(deliveries.has('email')).toBe(false);
    await expect(
      indexDef('email_deliveries_idempotency_key_key'),
    ).resolves.toMatch(/UNIQUE INDEX/);
    await expect(
      indexDef('email_deliveries_notification_id_key'),
    ).resolves.toMatch(/UNIQUE INDEX/);
  });

  it('creates password reset tokens and session revoke reasons (plan 5.4, 5.6)', async () => {
    if (!dbAvailable) return;
    const tokens = await columnsOf('password_reset_tokens');
    expect(tokens.get('token_hash')).toBe('NO');
    expect(tokens.get('used_at')).toBe('YES');
    await expect(
      indexDef('password_reset_tokens_token_hash_key'),
    ).resolves.toMatch(/UNIQUE INDEX/);
    await expect(
      constraintDef('password_reset_tokens_user_id_fkey'),
    ).resolves.toMatch(/FOREIGN KEY .* ON DELETE CASCADE/);
    const sessions = await columnsOf('sessions');
    expect(sessions.get('revoked_at')).toBe('YES');
    expect(sessions.get('revoked_reason')).toBe('YES');
    await expect(enumValues('SessionRevokeReason')).resolves.toEqual([
      'LOGOUT',
      'REPLACED',
      'REFRESH_REUSE',
      'ADMIN_LOCK',
      'ROLE_CHANGED',
      'PASSWORD_RESET',
    ]);
  });

  it('creates the admin keyset read indexes (plan 4.2, 4.3)', async () => {
    if (!dbAvailable) return;
    for (const index of [
      'fraud_logs_created_at_id_idx',
      'fraud_logs_user_id_created_at_idx',
      'ledger_journals_created_at_id_idx',
      'forms_status_updated_at_idx',
      'identity_audit_logs_target_user_id_created_at_idx',
      'survey_attempts_missing_code_reported_idx',
    ]) {
      await expect(indexDef(index)).resolves.toBeDefined();
    }
  });

  it('re-applies the Phase 2–5 migrations idempotently', () => {
    if (!dbAvailable) return;
    for (const name of [
      '20261001120000_scheduler_outbox_dispatcher',
      '20261001120100_form_topic',
      '20261001120200_publisher_results_indexes',
      '20261001120300_email_delivery',
      '20261001120400_password_reset_tokens',
      '20261001120500_session_revoke_reason',
      '20261001120600_admin_read_indexes',
      '20261001120700_admin_overview_indexes',
      '20261001120800_missing_code_report_index',
    ]) {
      expect(() =>
        runPrisma([
          'db',
          'execute',
          '--file',
          `prisma/migrations/${name}/migration.sql`,
          '--schema',
          'prisma/schema.prisma',
        ]),
      ).not.toThrow();
    }
  }, 60_000);

  it('re-applies the reconciliation and post-push invariants idempotently', () => {
    if (!dbAvailable) return;
    for (const file of [
      'prisma/migrations/20260927040000_reconcile_db_push_tables/migration.sql',
      'prisma/sql/post-push-invariants.sql',
    ]) {
      expect(() =>
        runPrisma([
          'db',
          'execute',
          '--file',
          file,
          '--schema',
          'prisma/schema.prisma',
        ]),
      ).not.toThrow();
    }
  }, 60_000);
});

/**
 * Upgrade path for the 12.9 flash sale lifecycle migration: apply every
 * migration before it on a scratch database holding Rewards data, then apply
 * it and check the data and the new invariants. Uses its own database
 * (`*_prior_test`), never the one the suite above resets.
 */
describe('Prisma migration 20261015100000_rewards_flash_sale_lifecycle on existing data', () => {
  const targetMigration = '20261015100000_rewards_flash_sale_lifecycle';
  const baseUrl = new URL(
    process.env.MIGRATION_TEST_DATABASE_URL ??
      'postgresql://rescom_admin:rescom_password@localhost:5433/rescom_migration_test?schema=public',
  );
  const scratchDb = 'rescom_migration_prior_test';
  const adminUrl = new URL(baseUrl.toString());
  adminUrl.pathname = '/postgres';
  const scratchUrl = new URL(baseUrl.toString());
  scratchUrl.pathname = `/${scratchDb}`;
  const backendDir = path.resolve(__dirname, '..');
  const prismaCli = require.resolve('prisma/build/index.js', {
    paths: [backendDir],
  });
  let admin: PrismaClient;
  let scratch: PrismaClient | undefined;
  let tmpDir: string | undefined;
  let dbAvailable = false;

  function deploy(schemaFile: string): void {
    execFileSync(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', schemaFile],
      {
        cwd: backendDir,
        env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
        stdio: 'pipe',
      },
    );
  }

  beforeAll(async () => {
    admin = new PrismaClient({
      datasources: { db: { url: adminUrl.toString() } },
    });
    try {
      await admin.$connect();
      dbAvailable = true;
    } catch {
      console.warn(
        `Postgres at ${adminUrl.host} is unreachable. Skipping flash sale upgrade migration test.`,
      );
      return;
    }
    await admin.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`,
    );
    await admin.$executeRawUnsafe(`CREATE DATABASE ${scratchDb}`);
    scratch = new PrismaClient({
      datasources: { db: { url: scratchUrl.toString() } },
    });
  }, 60_000);

  afterAll(async () => {
    await scratch?.$disconnect();
    if (dbAvailable) {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`,
      );
    }
    await admin?.$disconnect();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('applies on top of populated Rewards tables and keeps data and invariants', async () => {
    if (!dbAvailable || !scratch) return;
    const db = scratch;

    // 1. Everything except the target migration, from a temp copy of prisma/.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rescom-migrations-'));
    const tmpPrisma = path.join(tmpDir, 'prisma');
    fs.cpSync(
      path.join(backendDir, 'prisma', 'migrations'),
      path.join(tmpPrisma, 'migrations'),
      {
        recursive: true,
        filter: (src) => !src.includes(targetMigration),
      },
    );
    fs.copyFileSync(
      path.join(backendDir, 'prisma', 'schema.prisma'),
      path.join(tmpPrisma, 'schema.prisma'),
    );
    deploy(path.join(tmpPrisma, 'schema.prisma'));
    await expect(
      db.$queryRaw`SELECT 1 FROM information_schema.columns WHERE table_name = 'flash_sales' AND column_name = 'reserved_at'`,
    ).resolves.toHaveLength(0);

    // 2. Pre-existing Rewards data (voucher, flash sale + item, redemption).
    const ids = {
      user: '00000000-0000-4000-8000-000000000001',
      voucher: '00000000-0000-4000-8000-000000000002',
      sale: '00000000-0000-4000-8000-000000000003',
      item: '00000000-0000-4000-8000-000000000004',
      redemption: '00000000-0000-4000-8000-000000000005',
    };
    await db.$executeRaw`INSERT INTO users (id, email, updated_at) VALUES (${ids.user}::uuid, 'prior@example.test', now())`;
    await db.$executeRaw`INSERT INTO vouchers (id, title, brand_id, category, value_vnd, base_points, redeem_starts_at, redeem_ends_at, code_expires_at, created_by_id, is_shared_code, shared_code, updated_at)
      VALUES (${ids.voucher}::uuid, 'Prior voucher', 'highlands', 'COFFEE', 50000, 100, now(), now() + interval '1 day', now() + interval '10 days', ${ids.user}::uuid, true, 'SHARED123', now())`;
    await db.$executeRaw`INSERT INTO flash_sales (id, code, title, starts_at, ends_at, rules, created_by_id, updated_at)
      VALUES (${ids.sale}::uuid, 'FS-PRIOR0001', 'Prior sale', now(), now() + interval '1 hour', '{}'::jsonb, ${ids.user}::uuid, now())`;
    await db.$executeRaw`INSERT INTO flash_sale_items (id, flash_sale_id, voucher_id, flash_points, quota, per_user_cap, updated_at)
      VALUES (${ids.item}::uuid, ${ids.sale}::uuid, ${ids.voucher}::uuid, 40, 5, 1, now())`;
    await db.$executeRaw`INSERT INTO redemptions (id, user_id, voucher_id, flash_sale_item_id, idempotency_key, status, price_points, price_source, price_version, journal_id, balance_after, reference)
      VALUES (${ids.redemption}::uuid, ${ids.user}::uuid, ${ids.voucher}::uuid, ${ids.item}::uuid, 'prior-key', 'SUCCEEDED', 40, 'FLASH', 1, '00000000-0000-4000-8000-000000000006'::uuid, 100, 'RDM-PRIOR001')`;

    // 3. Apply the target migration from the real migrations directory.
    expect(() =>
      deploy(path.join(backendDir, 'prisma', 'schema.prisma')),
    ).not.toThrow();

    // 4. Data survives; new column is NULL on old sales; new objects exist.
    const sale = await db.$queryRaw<
      { reserved_at: Date | null; title: string }[]
    >`
      SELECT reserved_at, title FROM flash_sales WHERE id = ${ids.sale}::uuid`;
    expect(sale).toEqual([{ reserved_at: null, title: 'Prior sale' }]);
    const redemption = await db.$queryRaw<{ reference: string }[]>`
      SELECT reference FROM redemptions WHERE id = ${ids.redemption}::uuid`;
    expect(redemption).toEqual([{ reference: 'RDM-PRIOR001' }]);
    const voucher = await db.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM vouchers WHERE id = ${ids.voucher}::uuid`;
    expect(Number(voucher[0].n)).toBe(1);

    await db.$executeRaw`INSERT INTO flash_item_claims (flash_sale_item_id, user_id, redemption_id)
      VALUES (${ids.item}::uuid, ${ids.user}::uuid, ${ids.redemption}::uuid)`;
    await expect(
      db.$executeRaw`UPDATE flash_sales SET reserved_at = starts_at - interval '1 minute' WHERE id = ${ids.sale}::uuid`,
    ).rejects.toThrow(/flash_sales_reserved_at_check/);
    const indexes = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE indexname IN
        ('flash_sales_starts_at_due_idx', 'flash_sales_ends_at_due_idx')`;
    expect(indexes).toHaveLength(2);
  }, 240_000);

  it('applies 20261016100000_rewards_my_vouchers_code_issues cleanly from a 20261015100000 database', async () => {
    if (!dbAvailable) return;

    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'rescom-12-10-migration-'),
    );
    const tmpPrisma = path.join(tmpDir, 'prisma');
    fs.mkdirSync(tmpPrisma, { recursive: true });

    const targetMigration = '20261016100000_rewards_my_vouchers_code_issues';
    const testDbName = 'rescom_migration_12_10_upgrade_test';
    const upgradeUrl = new URL(baseUrl.toString());
    upgradeUrl.pathname = `/${testDbName}`;
    const upgradeDbUrl = upgradeUrl.toString();

    function deploy(schemaPath: string): void {
      execFileSync(
        process.execPath,
        [prismaCli, 'migrate', 'deploy', '--schema', schemaPath],
        {
          cwd: backendDir,
          env: { ...process.env, DATABASE_URL: upgradeDbUrl },
          stdio: 'pipe',
        },
      );
    }

    try {
      await admin.$executeRawUnsafe(
        `DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`,
      );
    } catch {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${testDbName}`);
    }
    await admin.$executeRawUnsafe(`CREATE DATABASE ${testDbName}`);

    const db = new PrismaClient({ datasources: { db: { url: upgradeDbUrl } } });
    await db.$connect();

    try {
      // 1. Deploy all migrations up to 20261015100000 (excluding targetMigration)
      fs.cpSync(
        path.join(backendDir, 'prisma', 'migrations'),
        path.join(tmpPrisma, 'migrations'),
        {
          recursive: true,
          filter: (src) => !src.includes(targetMigration),
        },
      );
      fs.copyFileSync(
        path.join(backendDir, 'prisma', 'schema.prisma'),
        path.join(tmpPrisma, 'schema.prisma'),
      );
      deploy(path.join(tmpPrisma, 'schema.prisma'));

      await expect(
        db.$queryRaw`SELECT 1 FROM information_schema.tables WHERE table_name = 'redemption_usages'`,
      ).resolves.toHaveLength(0);

      // 2. Insert pre-existing user, voucher, and redemption
      const ids = {
        user: '00000000-0000-4000-8000-000000000011',
        voucher: '00000000-0000-4000-8000-000000000012',
        code: '00000000-0000-4000-8000-000000000013',
        redemption: '00000000-0000-4000-8000-000000000014',
      };
      await db.$executeRaw`INSERT INTO users (id, email, updated_at) VALUES (${ids.user}::uuid, 'prior10@example.test', now())`;
      await db.$executeRaw`INSERT INTO vouchers (id, title, brand_id, category, value_vnd, base_points, redeem_starts_at, redeem_ends_at, code_expires_at, created_by_id, is_shared_code, updated_at)
        VALUES (${ids.voucher}::uuid, 'Prior voucher 10', 'highlands', 'COFFEE', 50000, 100, now(), now() + interval '1 day', now() + interval '10 days', ${ids.user}::uuid, false, now())`;
      await db.$executeRaw`INSERT INTO voucher_codes (id, voucher_id, code) VALUES (${ids.code}::uuid, ${ids.voucher}::uuid, 'CODE1234')`;
      await db.$executeRaw`INSERT INTO redemptions (id, user_id, voucher_id, voucher_code_id, idempotency_key, status, price_points, price_source, price_version, journal_id, balance_after, reference)
        VALUES (${ids.redemption}::uuid, ${ids.user}::uuid, ${ids.voucher}::uuid, ${ids.code}::uuid, 'prior10-key', 'SUCCEEDED', 100, 'BASE', 1, '00000000-0000-4000-8000-000000000015'::uuid, 200, 'RDM-PRIOR010')`;

      // 3. Deploy target migration
      expect(() =>
        deploy(path.join(backendDir, 'prisma', 'schema.prisma')),
      ).not.toThrow();

      // 4. Verify new tables and constraints exist and work
      const tables = await db.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables WHERE table_name IN ('redemption_usages', 'redemption_refunds', 'redemption_reminders')`;
      expect(tables).toHaveLength(3);

      // Verify undo_until check
      await expect(
        db.$executeRaw`INSERT INTO redemption_usages (redemption_id, used_at, undo_until)
          VALUES (${ids.redemption}::uuid, now(), now() + interval '1 hour')`,
      ).rejects.toThrow(/redemption_usages_undo_until_check/);

      // Verify append-only trigger on redemption_refunds
      const reportId = '00000000-0000-4000-8000-000000000016';
      await db.$executeRaw`INSERT INTO code_issue_reports (id, redemption_id, reason, status)
        VALUES (${reportId}::uuid, ${ids.redemption}::uuid, 'CODE_INVALID', 'OPEN')`;
      const refundId = '00000000-0000-4000-8000-000000000017';
      await db.$executeRaw`INSERT INTO redemption_refunds (id, redemption_id, report_id, journal_id, reference, points)
        VALUES (${refundId}::uuid, ${ids.redemption}::uuid, ${reportId}::uuid, '00000000-0000-4000-8000-000000000018'::uuid, 'RFD-2026-AAAA', 100)`;

      await expect(
        db.$executeRaw`UPDATE redemption_refunds SET points = 200 WHERE id = ${refundId}::uuid`,
      ).rejects.toThrow(/rewards history is append-only/);

      await expect(
        db.$executeRaw`DELETE FROM redemption_refunds WHERE id = ${refundId}::uuid`,
      ).rejects.toThrow(/rewards history is append-only/);
    } finally {
      await db.$disconnect();
      try {
        await admin.$executeRawUnsafe(
          `DROP DATABASE IF EXISTS ${testDbName} WITH (FORCE)`,
        );
      } catch {
        await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${testDbName}`);
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }, 240_000);
});
