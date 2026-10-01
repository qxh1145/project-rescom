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

  describe('mock-off Phase 2–5 migrations (IR.2b, IR.4a, IR.4b, plan 2.2/4.x/5.x)', () => {
    const schemaPrisma = fs.readFileSync(
      path.join(prismaDir, 'schema.prisma'),
      'utf8',
    );
    const phaseMigrations = [
      '20261001120000_scheduler_outbox_dispatcher',
      '20261001120100_form_topic',
      '20261001120200_publisher_results_indexes',
      '20261001120300_email_delivery',
      '20261001120400_password_reset_tokens',
      '20261001120500_session_revoke_reason',
      '20261001120600_admin_read_indexes',
      '20261001120700_admin_overview_indexes',
      '20261001120800_missing_code_report_index',
    ];

    it('exist, in order, after the last Phase-1 migration', () => {
      expect(
        migrationNames.filter((name) => name > '20261001110000_user_profiles'),
      ).toEqual(phaseMigrations);
    });

    it.each(phaseMigrations)(
      '%s is expand-only, unguarded and re-runnable',
      (name) => {
        const code = stripComments(readMigration(name));
        expect(code).not.toMatch(/to_regclass/i);
        expect(code).not.toMatch(/\bDROP\b/i);
        expect(code).not.toMatch(/\bRENAME\b/i);
        expect(code).not.toMatch(/SET NOT NULL/i);
        expect(code).not.toMatch(/^\s*(UPDATE|DELETE FROM|INSERT INTO)\s/im);
        expect(code).not.toMatch(/CREATE TABLE "/);
        expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX "/);
        expect(code).not.toMatch(/ADD COLUMN "/);
        expect(code).not.toMatch(/ADD VALUE '/);
        expect(code).not.toMatch(/CREATE SEQUENCE/i);
        for (const match of code.matchAll(
          /ADD COLUMN IF NOT EXISTS "\w+" ([^;]+);/g,
        )) {
          expect(match[1]).not.toMatch(/NOT NULL/);
        }
      },
    );

    it('adds DEADLINE and QUOTA to FormCloseKind without using them', () => {
      const code = stripComments(
        readMigration('20261001120000_scheduler_outbox_dispatcher'),
      );
      expect(code).toContain(
        `ALTER TYPE "FormCloseKind" ADD VALUE IF NOT EXISTS 'DEADLINE';`,
      );
      expect(code).toContain(
        `ALTER TYPE "FormCloseKind" ADD VALUE IF NOT EXISTS 'QUOTA';`,
      );
      expect(code.match(/'DEADLINE'|'QUOTA'/g)).toHaveLength(2);
      expect(schemaPrisma).toMatch(
        /enum FormCloseKind \{\s+OWNER\s+ADMIN\s+MODERATION\s+DEADLINE\s+QUOTA\s+\}/,
      );
    });

    it('appends the IR.4b notification types without using them', () => {
      const code = stripComments(
        readMigration('20261001120300_email_delivery'),
      );
      for (const value of [
        'TOPUP_REJECTED',
        'ACCOUNT_LOCKED',
        'ACCOUNT_UNLOCKED',
      ]) {
        expect(code).toContain(
          `ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS '${value}';`,
        );
        expect(code.split(`'${value}'`)).toHaveLength(2);
      }
    });

    it('does not re-declare the IR.2a close-reason columns', () => {
      const code = stripComments(
        readMigration('20261001120000_scheduler_outbox_dispatcher'),
      );
      expect(code).not.toMatch(/closed_reason|closed_at|AttemptCloseReason/);
    });

    it.each([
      ['scheduler_job_leases', '@@map("scheduler_job_leases")'],
      ['email_deliveries', '@@map("email_deliveries")'],
      ['password_reset_tokens', '@@map("password_reset_tokens")'],
    ])(
      'creates table %s and declares it in schema.prisma',
      (table, mapping) => {
        const sql = phaseMigrations.map(readMigration).join('\n');
        expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}" (`);
        expect(schemaPrisma).toContain(mapping);
      },
    );

    it.each([
      ['forms', 'deadline_at', 'deadlineAt DateTime? @map("deadline_at")'],
      ['forms', 'topic', 'topic String? @map("topic")'],
      ['sessions', 'revoked_at', 'revokedAt DateTime? @map("revoked_at")'],
      [
        'sessions',
        'revoked_reason',
        'revokedReason SessionRevokeReason? @map("revoked_reason")',
      ],
    ])(
      'adds nullable %s.%s and declares it in schema.prisma',
      (table, column, field) => {
        const sql = phaseMigrations.map(readMigration).join('\n');
        expect(sql).toMatch(
          new RegExp(
            `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" [^;]+;`,
          ),
        );
        expect(schemaPrisma.replace(/[ \t]+/g, ' ')).toContain(field);
      },
    );

    it.each([
      ['forms_status_deadline_at_idx', '@@index([status, deadlineAt])'],
      ['survey_attempts_status_started_at_idx', '@@index([status, startedAt])'],
      [
        'survey_attempts_survey_id_status_submitted_at_idx',
        '@@index([surveyId, status, submittedAt])',
      ],
      [
        'outbox_events_ordering_stream_stream_sequence_idx',
        '@@index([orderingStream, streamSequence])',
      ],
      ['outbox_events_event_type_status_idx', '@@index([eventType, status])'],
      [
        'email_deliveries_status_updated_at_idx',
        '@@index([status, updatedAt])',
      ],
      [
        'password_reset_tokens_user_id_created_at_idx',
        '@@index([userId, createdAt])',
      ],
      ['fraud_logs_created_at_id_idx', '@@index([createdAt, id])'],
      ['fraud_logs_user_id_created_at_idx', '@@index([userId, createdAt])'],
      ['ledger_journals_created_at_id_idx', '@@index([createdAt, id])'],
      ['forms_status_updated_at_idx', '@@index([status, updatedAt])'],
      [
        'identity_audit_logs_target_user_id_created_at_idx',
        '@@index([targetUserId, createdAt])',
      ],
    ])(
      'creates index %s and declares it in schema.prisma',
      (index, declaration) => {
        const sql = phaseMigrations.map(readMigration).join('\n');
        expect(sql).toContain(`CREATE INDEX IF NOT EXISTS "${index}"`);
        expect(schemaPrisma).toContain(declaration);
      },
    );

    it('keeps the IR.4a partial indexes out of post-push-invariants.sql and documents them', () => {
      for (const index of [
        'responses_version_completed_feed_idx',
        'responses_form_completed_submitted_idx',
      ]) {
        expect(
          stripComments(
            readMigration('20261001120200_publisher_results_indexes'),
          ),
        ).toMatch(
          new RegExp(
            `CREATE INDEX IF NOT EXISTS "${index}"[^;]+WHERE "status" IN \\('SUBMITTED', 'VALIDATED'\\);`,
          ),
        );
        expect(invariantsSql).not.toContain(index);
        expect(schemaPrisma).toContain(`\`${index}\``);
      }
    });

    it('creates the missing-code report partial index and documents it', () => {
      const index = 'survey_attempts_missing_code_reported_idx';
      expect(
        stripComments(
          readMigration('20261001120800_missing_code_report_index'),
        ),
      ).toMatch(
        new RegExp(
          `CREATE INDEX IF NOT EXISTS "${index}"[^;]+WHERE "missing_code_reported_at" IS NOT NULL;`,
        ),
      );
      expect(invariantsSql).not.toContain(index);
      expect(schemaPrisma).toContain(`\`${index}\``);
    });

    it('stores only the password reset token hash, unique, cascading with the user', () => {
      const code = stripComments(
        readMigration('20261001120400_password_reset_tokens'),
      );
      expect(code).toContain(
        'CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_key"',
      );
      expect(code).toMatch(
        /FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\) ON DELETE CASCADE/,
      );
      expect(code).not.toMatch(/"token"\s/);
    });
  });
});
