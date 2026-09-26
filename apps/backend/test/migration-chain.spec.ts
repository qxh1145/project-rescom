import * as fs from 'fs';
import * as path from 'path';

/**
 * Static guard for the Prisma migration chain (no database needed).
 *
 * Earlier migrations wrapped DDL in `IF to_regclass('public.x') IS NOT NULL`
 * blocks, which silently no-op on a fresh `prisma migrate deploy`. Migration
 * `20260927040000_reconcile_db_push_tables` must re-assert every such object
 * unconditionally, and its invariants section must stay identical to
 * `prisma/sql/post-push-invariants.sql` (applied after `prisma db push`).
 */
describe('Prisma migration chain', () => {
  const prismaDir = path.resolve(__dirname, '../prisma');
  const migrationsDir = path.join(prismaDir, 'migrations');
  const reconcileName = '20260927040000_reconcile_db_push_tables';
  const reconcileSql = readMigration(reconcileName);
  const invariantsSql = fs.readFileSync(
    path.join(prismaDir, 'sql/post-push-invariants.sql'),
    'utf8',
  );
  const beginMarker =
    '-- SECTION 2: invariants (BEGIN post-push-invariants.sql)\n' +
    '-- ===========================================================================\n';
  const endMarker =
    '-- ===========================================================================\n' +
    '-- END post-push-invariants.sql';

  const migrationNames = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  function readMigration(name: string): string {
    return fs.readFileSync(
      path.join(migrationsDir, name, 'migration.sql'),
      'utf8',
    );
  }

  function stripComments(sql: string): string {
    return sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
  }

  function guardedBlocks(sql: string): string[] {
    return (stripComments(sql).match(/DO \$\$[\s\S]*?END \$\$;/g) ?? []).filter(
      (block) => block.includes('to_regclass'),
    );
  }

  function withoutGuardedBlocks(sql: string): string {
    let code = stripComments(sql);
    for (const block of guardedBlocks(sql)) {
      code = code.replace(block, '');
    }
    return code;
  }

  function invariantsSection(): string {
    const start = reconcileSql.indexOf(beginMarker);
    const end = reconcileSql.indexOf(endMarker);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return reconcileSql.slice(start + beginMarker.length, end);
  }

  const guardedMigrations = migrationNames.filter(
    (name) => guardedBlocks(readMigration(name)).length > 0,
  );

  it('orders the reconciliation after every to_regclass-guarded migration', () => {
    expect(guardedMigrations).toEqual([
      '20260926150000_survey_moderation_decisions',
      '20260926180000_bot_protection_evidence',
      '20260926200000_survey_feedback',
      '20260926220000_form_close_count',
      '20260926230000_participation_concurrency_guards',
      '20260926233000_form_estimated_duration_minutes',
      '20260927010000_completion_code_limit_resets',
      '20260927020000_form_close_kind',
    ]);
    for (const name of guardedMigrations) {
      expect(name < reconcileName).toBe(true);
    }
  });

  it('keeps the invariants section identical to post-push-invariants.sql', () => {
    expect(invariantsSection()).toBe(invariantsSql);
  });

  it('has no to_regclass guard in the invariants or the reconciliation', () => {
    expect(stripComments(invariantsSql)).not.toMatch(/to_regclass/i);
    expect(stripComments(reconcileSql)).not.toMatch(/to_regclass/i);
  });

  it('re-asserts every object created inside an earlier guarded block', () => {
    const invariants = withoutGuardedBlocks(invariantsSql);
    const patterns = [
      /ADD CONSTRAINT\s+"(\w+)"/g,
      /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+"(\w+)"/g,
      /ADD COLUMN IF NOT EXISTS\s+"(\w+)"/g,
    ];
    const required = new Set<string>();
    for (const name of guardedMigrations) {
      for (const block of guardedBlocks(readMigration(name))) {
        for (const pattern of patterns) {
          for (const match of block.matchAll(pattern)) required.add(match[1]);
        }
      }
    }

    expect(required.size).toBeGreaterThan(15);
    for (const objectName of required) {
      expect({
        objectName,
        found: invariants.includes(`"${objectName}"`),
      }).toEqual({ objectName, found: true });
    }
  });

  it.each([
    'survey_attempts_one_active_per_account',
    'survey_attempts_one_completion_per_account',
    'forms_estimated_duration_minutes_range',
    'ledger_accounts_user_id_account_class_currency_key',
  ])('creates %s outside any guarded block', (objectName) => {
    expect(withoutGuardedBlocks(reconcileSql)).toContain(`"${objectName}"`);
    expect(withoutGuardedBlocks(invariantsSql)).toContain(`"${objectName}"`);
  });

  it('rebuilds the ledger account index with NULLS NOT DISTINCT', () => {
    const code = stripComments(invariantsSql);
    expect(code).toMatch(
      /indexdef NOT ILIKE '%NULLS NOT DISTINCT%'[\s\S]*DROP INDEX "ledger_accounts_user_id_account_class_currency_key"/,
    );
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "ledger_accounts_user_id_account_class_currency_key"\s+ON "ledger_accounts"\("user_id", "account_class", "currency"\) NULLS NOT DISTINCT;/,
    );
  });

  it('pre-counts duplicate ledger accounts before the rebuild and keeps the index on dirty data', () => {
    for (const sql of [invariantsSql, invariantsSection()]) {
      const code = stripComments(sql);
      expect(code).toMatch(
        /SELECT COUNT\(\*\) INTO duplicate_ledger_accounts\s+FROM \(\s+SELECT 1\s+FROM "ledger_accounts"\s+GROUP BY "user_id", "account_class", "currency"\s+HAVING COUNT\(\*\) > 1\s+\) AS duplicates;/,
      );
      expect(code).toMatch(
        /IF duplicate_ledger_accounts = 0 THEN[\s\S]*DROP INDEX "ledger_accounts_user_id_account_class_currency_key";[\s\S]*NULLS NOT DISTINCT;\s+ELSE\s+RAISE WARNING 'ledger_accounts_user_id_account_class_currency_key not rebuilt[^']*merge each group[^']*', duplicate_ledger_accounts;\s+END IF;/,
      );
    }
  });

  it('creates the sixteen tables that previously came only from db push', () => {
    const code = stripComments(reconcileSql);
    for (const table of [
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
    ]) {
      expect(code).toContain(`CREATE TABLE IF NOT EXISTS "${table}" (`);
    }
    expect(code).not.toMatch(/CREATE TABLE "/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX "/);
  });
});
