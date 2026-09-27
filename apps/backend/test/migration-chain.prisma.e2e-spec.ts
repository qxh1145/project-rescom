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
