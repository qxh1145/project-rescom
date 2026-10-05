import { execFileSync } from 'child_process';
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
    expect(values.slice(-3)).toEqual([
      'TOPUP_REJECTED',
      'ACCOUNT_LOCKED',
      'ACCOUNT_UNLOCKED',
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
