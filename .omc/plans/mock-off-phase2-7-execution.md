# Execution brief: mock-off Phase 2–7 (2026-10-01)

Source plan: `.omc/plans/mock-off-full-backend.md` (read it first; this file only adds execution rules).
User approved Phases 2–7 on 2026-10-01 ("tiếp tục phase 2-7"). Phase 0–1 are done but UNCOMMITTED: never revert,
stash, reset or "clean up" files you did not create. Do NOT commit. Do NOT edit `apps/frontend/my-app/.env.local`.

## Binding product decisions (override the stories where they conflict)
- Goal: internal team testing. **No screen is hidden.** Deferred PRD features stay on MSW (future `hybrid` mode):
  disputes (3), reliability, admin quality reviews (2), publisher survey quality `GET /forms/:id/quality`, AI (3),
  engagement (2). Do NOT build backend for those, do NOT delete their MSW handlers or pages.
- **Export stays open** (IR.4a AC7.1 is overridden): `RESPONSE_EXPORT_ENABLED = true`, export uses real `/responses` data.
- IR.4a AC7.2/AC7.4 overridden: the Survey Quality tab/page and `/forms/[id]/complaints/*` stay reachable (they are
  mock-served in hybrid). Version diff stays visible if it can be computed client-side from version details.
- IR.4a Q1 (analytics) = BUILD, Q3 (version detail) = BUILD. Other story open questions: use the documented defaults
  and list them in your final report.
- Full survey (2.3): option A — backend auto-closes in the same transaction as the last accepted submission, close kind
  `QUOTA`; leftover escrow is refunded through the normal close path.
- Pause/resume: delete the FE client and MSW handlers (IR.4a AC6). No backend.
- Email for internal testing: local adapter (mailpit via SMTP, or capture/log). No real provider.

## Migration chain (single owner: the "foundation" agent)
Only the foundation agent edits `apps/backend/prisma/schema.prisma` and `prisma/migrations/`. Timestamps must be later
than `20261001110000` (last Phase-1 migration). Planned:
1. `20261001120000_scheduler_outbox_dispatcher` — IR.2b Task 1 + `FormCloseKind` adds `DEADLINE` **and** `QUOTA`.
2. `20261001120100_form_topic` — `forms.topic` (nullable text).
3. `20261001120200_publisher_results_indexes` — IR.4a T6.
4. `20261001120300_email_delivery` — IR.4b B-T2.
5. `20261001120400_password_reset_tokens` — plan 5.4.
6. `20261001120500_session_revoke_reason` — plan 5.6.
7. `20261001120600_admin_read_indexes` — fraud_logs/ledger_journals keyset indexes.
8. `20261001120700_admin_overview_indexes` — forms(status, updated_at), identity_audit_logs(target_user_id, created_at).
If another agent needs a schema/index change, it reports it instead of editing the schema.

## Shared working tree rules (several agents run at the same time)
- Edit only files in your scope. Shared hot files (`common/http/http-exception.filter.ts`, `app.module.ts`,
  `packages/schemas/src/**/index.ts`, `common/config/env.schema.ts`, FE message files) may be edited by several agents:
  make small, local `Edit`s, re-read right before editing, never rewrite the whole file.
- If a test/typecheck fails in code outside your scope, it is probably another agent mid-change: do not fix it;
  re-run later and mention it in your report.
- Do not run `prisma migrate reset`, `db push`, or anything destructive against `rescom_db` (the user's seeded dev
  DB; their own backend :4000 and FE :3000 are running against it). For Postgres e2e use a scratch DB, e.g.
  `postgresql://rescom_admin:rescom_password@localhost:5433/rescom_phase2_check` (create it, `prisma migrate deploy`).
  To test against realistic seeded data, clone with `pg_dump rescom_db | psql <scratch>` inside `rescom_postgres`.
- Rebuild `@rescom/schemas` (`npm run build --workspace @rescom/schemas`) after changing it.
- Follow the general rules of the plan: shared zod schemas in `@rescom/schemas` imported by both FE service and BE
  controller, envelope `{data,error,meta}`, stable error codes, cursor pagination for new lists, MSW handlers kept and
  parsed with the same shared schema (parity), contract tests.
- No `test.skip`/`.only`, no TODO placeholders, no stub tests.

## Final report (every agent)
Files changed, migrations, decisions/defaults applied, test commands + results (exact counts), anything left undone,
anything you noticed outside scope.
