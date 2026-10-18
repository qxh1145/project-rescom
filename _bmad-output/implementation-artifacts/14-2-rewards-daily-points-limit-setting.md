---
baseline_commit: 6f0d5ab92fdee3ef85fd8abbf03fb607ea9997d4
---

# Story 14.2: Rewards Daily Points Limit Setting

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Admin,
I want to change the per-user daily Points redemption limit in the console,
so that I can tune abuse controls without an API call.

## Acceptance Criteria

1. **Given** Rewards is enabled (`NEXT_PUBLIC_REWARDS_ENABLED=true` on the FE, `REWARDS_ENABLED` on the BE), **when** the Admin opens `/admin/vouchers`, **then** a "Giới hạn Điểm đổi mỗi ngày" card shows the current `dailyPointsLimit` from `GET /admin/rewards/settings`, formatted `vi-VN` with the unit "Điểm / người / ngày" (FR-74).
2. Editing accepts integers 1–1,000,000 only (`updateRewardsSettingsSchema`). Empty, non-digit, decimal, `0`, and `1000001` are refused inline under the field with "Nhập số nguyên từ 1 đến 1.000.000." and nothing is sent. "Lưu" is disabled while the value equals the current one.
3. "Lưu" opens a confirm dialog that shows old → new value (e.g. "500 → 800 Điểm") and the text "Áp dụng từ lần đổi tiếp theo; các lượt đổi đã xong không bị ảnh hưởng." Only "Xác nhận" calls `PUT /admin/rewards/settings` with `{ dailyPointsLimit }` (CSRF via `apiRequest`). While the request runs, both dialog buttons are disabled and the dialog cannot be dismissed.
4. On success, the card shows the value returned by the server, leaves edit mode, and shows a success notice. On failure, the dialog stays open with an inline Vietnamese error (mapping in Dev Notes) and the old value stays on the card. Load failure shows "Không tải được giới hạn." with "Thử lại".
5. The card is not rendered when Rewards is disabled: the FE flag off already 404s the page; a `404` from `GET /admin/rewards/settings` (BE flag off) hides the card without an error and leaves the rest of the Voucher page working.
6. An MSW handler pair `GET`/`PUT /admin/rewards/settings` serves the shared `rewardsSettingsSchema` / `updateRewardsSettingsSchema` contract (401 no session, 403 non-Admin, 403 `AUTH_INVALID_CSRF_TOKEN` on PUT without CSRF, 400 `VALIDATION_ERROR` with `details` on invalid body). A contract test proves it. `tests/route-diff.test.mjs` passes with `ROUTE_ALLOWLIST` counts unchanged (`MOCK_ONLY: 3, DEFERRED_KEEP_MOCK: 14`).
7. No backend source change. Backend service tests for `getSettings` / `updateSettings` may be added (test files only).

## Tasks / Subtasks

- [x] Task 1: FE service functions (AC: 1, 3, 5)
  - [x] 1.1 In `apps/frontend/my-app/lib/admin/rewards-vouchers-service.ts` add `getRewardsSettings(signal?)` → `apiRequest("/admin/rewards/settings", { schema: rewardsSettingsSchema, signal })` and `updateRewardsSettings(input: UpdateRewardsSettingsDto, signal?)` → `PUT`, same schema. Both start with `if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");` (an existing test asserts every export of this file has that guard).
- [x] Task 2: Pure view helpers + unit tests (AC: 2, 4, 5)
  - [x] 2.1 In `apps/frontend/my-app/lib/admin/rewards-vouchers-view.ts` add `parseDailyLimitInput(raw: string): { value: number } | { error: string }`: trim; must match `/^\d+$/`; then `updateRewardsSettingsSchema.safeParse({ dailyPointsLimit: Number(raw) })`; error text per AC 2. (Rejects `"1e3"`, `"1.5"`, `"-1"`, `""` that `Number()` would accept or coerce.)
  - [x] 2.2 Add `rewardsSettingsErrorMessage(error: unknown): string` mapping in Dev Notes table.
  - [x] 2.3 Tests in `apps/frontend/my-app/tests/rewards-admin-vouchers-view.test.mjs`: boundaries `1`, `1000000` ok; `0`, `1000001`, `1.5`, `1e3`, `""`, `" 800 "` (trim ok); error mapping for each code + network + unknown.
- [x] Task 3: Mock store + MSW handlers + contract test (AC: 6)
  - [x] 3.1 In `apps/frontend/my-app/mocks/data/rewards.ts` add `export const rewardsSettings = createCollection("rewards-settings", () => ({ dailyPointsLimit: 500 }))` (default matches BE `REWARDS_DAILY_POINTS_LIMIT_DEFAULT`). Do not wire it into mock redemption limits (out of scope).
  - [x] 3.2 In `apps/frontend/my-app/mocks/handlers/rewards-admin.ts` add `http.get(apiUrl("/admin/rewards/settings"), …)` (uses `guarded(request)`) and `http.put(apiUrl("/admin/rewards/settings"), …)` (uses `guarded(request, true)` then `body(request, updateRewardsSettingsSchema)`; update the collection; return `ok({ dailyPointsLimit })`). Add a one-line `// ASSUMED API CONTRACT: backend Story 12.8 task 4.6. 400 VALIDATION_ERROR; 401/403 auth/CSRF; 404 when Rewards is disabled.` comment like its neighbours. Keep each `http.<verb>(apiUrl("…")` on one line (route-diff parses that line).
  - [x] 3.3 Contract test: extend `tests/rewards-admin-vouchers.test.mjs` (reuse the `call` helper pattern of "voucher handlers enforce session, admin role, CSRF and body schema"): no session 401; non-Admin 403 `FORBIDDEN_RESOURCE`; GET body `data` parses with `rewardsSettingsSchema`; PUT without CSRF 403 `AUTH_INVALID_CSRF_TOKEN`; PUT `{ dailyPointsLimit: 0 }`, `1_000_001`, `1.5`, `"800"` → 400 `VALIDATION_ERROR` with `details`; PUT `800` → 200 and a following GET returns 800. Reset the store in `finally`.
  - [x] 3.4 Run `node --test tests/route-diff.test.mjs`: must pass unchanged (backend already serves both routes, so they are not MSW-only and no allowlist edit is needed).
- [x] Task 4: Card UI (AC: 1–5)
  - [x] 4.1 New `apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/DailyPointsLimitCard.tsx` (client). Data via `useApiQuery("admin:rewards:settings", getRewardsSettings)`. If `query.error` is an `ApiError` with `status === 404` → return `null`.
  - [x] 4.2 View mode: title "Giới hạn Điểm đổi mỗi ngày", value `toLocaleString("vi-VN")` + "Điểm / người / ngày", helper "Tổng Điểm một người được dùng để đổi voucher trong một ngày (giờ Việt Nam).", button "Sửa". Loading: skeleton with `aria-label="Đang tải giới hạn"` (same pattern as the voucher table). Load error: `Alert tone="danger"` + "Thử lại" (`query.reload`).
  - [x] 4.3 Edit mode: `TextField` (`inputMode="numeric"`, `id="daily-points-limit"`, label "Giới hạn mới (Điểm)", `error` from `parseDailyLimitInput`), buttons "Huỷ" / "Lưu" (disabled when invalid or equal to current).
  - [x] 4.4 Confirm: reuse `components/ui/Dialog` exactly like `VouchersScreen` (`labelledBy`, `dismissible={!busy}`, `onClose={() => !busy && …}`), content per AC 3, error `Alert` inside the dialog per AC 4.
  - [x] 4.5 Success: `query.setData(result)` (or `reload`), exit edit, show `Alert tone="info"` (only `"danger" | "info"` exist; do not add a tone) "Đã cập nhật giới hạn: {n} Điểm / người / ngày."
  - [x] 4.6 Render `<DailyPointsLimitCard />` in `VouchersScreen.tsx` directly above the 3-tile summary grid. No other change to `VouchersScreen`.
- [x] Task 5: Optional backend test-only coverage (AC: 7)
  - [x] 5.1 If cheap, in `apps/backend/src/modules/rewards/application/rewards-services.spec.ts` add: `getSettings` returns `{ dailyPointsLimit }` parseable by `rewardsSettingsSchema`; `updateSettings` persists the value and appends one `REWARDS_SETTINGS_UPDATED` audit; non-Admin capability → `REWARDS_ADMIN_CAPABILITY_REQUIRED`. Follow the existing fixture (`f.redemptions`, in-memory repos). Skip and note it if the fixture makes this costly.
- [x] Task 6: Verification (AC: all)
  - [x] 6.1 `cd apps/frontend/my-app && npm test` (full suite, includes route-diff, no-direct-mocks, contract tests) — all pass.
  - [x] 6.2 `npm run typecheck` and `npm run lint` in `apps/frontend/my-app`.
  - [x] 6.3 If Task 5 done: `cd apps/backend && npx jest src/modules/rewards/application/rewards-services.spec.ts`.
  - [x] 6.4 Manual (MSW default mode, `NEXT_PUBLIC_REWARDS_ENABLED=true`): open `/admin/vouchers`, edit 500 → 800, confirm, reload page, value persists; try `0` and `abc`.

## Dev Notes

### Scope boundary (read first)

- **FE only** + MSW + tests. Backend `GET/PUT /admin/rewards/settings` already exists (Story 12.8 task 4.6) and is correct. Do **not** touch `apps/backend/src/**`, `packages/schemas/**`, Prisma, or `mocks/route-allowlist.ts`.
- No Figma frame (sprint-change-proposal-2026-10-18 decision D3): build with existing Admin components (`AdminPage`, `Alert`, `Button`, `Dialog`, `TextField`). No new dependency.
- Do not add daily-limit enforcement to the mock redemption flow; it has none today and that is out of scope.
- Do not add a settings nav item or new route. The card lives on `/admin/vouchers`.

### Backend contract (existing, verified in code)

| | |
|---|---|
| Controller | `apps/backend/src/modules/rewards/presentation/admin-rewards-vouchers.controller.ts` — `@Controller(['admin/rewards','api/admin/rewards'])`, guards `RewardsEnabledGuard` (404 `NotFoundException` when BE flag off), `SessionAuthGuard`, `RolesGuard`, `@Roles('ADMIN')` |
| `GET /admin/rewards/settings` | `Cache-Control: no-store`; returns envelope `data: { dailyPointsLimit: number }` (no `updatedAt` today; schema has it optional) |
| `PUT /admin/rewards/settings` | 200, `CsrfGuard` + `JsonOnlyGuard`, body `ZodValidationPipe(updateRewardsSettingsSchema)` → 400 `VALIDATION_ERROR`; returns `data: { dailyPointsLimit }`; writes `REWARDS_SETTINGS_UPDATED` audit in the same UoW |
| Service | `rewards-admin-catalog.service.ts:571-609` — `authorize()` → 403 `REWARDS_ADMIN_CAPABILITY_REQUIRED` if the live capability is not ACTIVE ADMIN |
| Effect | Redeem reads the limit inside the ledger `assertBeforeInsert` hook → a change applies to the **next** redemption only (hence AC 3 wording) |
| Schema | `packages/schemas/src/rewards/rewards-settings.schema.ts`: `rewardsSettingsSchema` (`dailyPointsLimit` int 1..1_000_000, `updatedAt?` datetime), `updateRewardsSettingsSchema`, types `RewardsSettingsDto`, `UpdateRewardsSettingsDto`; exported from `@rescom/schemas` |
| Default | 500 (`rewards_settings` row seeded by migration `20261014110000_rewards_redemption_transaction`) |

### Error → message mapping (`rewardsSettingsErrorMessage`)

| Condition | Message |
|---|---|
| `ApiError` code `VALIDATION_ERROR` | "Giá trị không hợp lệ. Nhập số nguyên từ 1 đến 1.000.000." |
| code `REWARDS_ADMIN_CAPABILITY_REQUIRED` or `FORBIDDEN_RESOURCE` (403) | "Tài khoản không còn quyền Admin để đổi cài đặt này." |
| code `AUTH_INVALID_CSRF_TOKEN` | "Phiên làm việc đã hết hạn. Tải lại trang rồi thử lại." |
| status 404 | "Tính năng Đổi quà đang tắt." |
| `kind === "network"` / anything else | "Không lưu được giới hạn. Thử lại." |

`ApiErrorKind` is `"http" | "network" | "malformed"` (`lib/api/api-error.ts`); `isApiError()` is the type guard.

### Current state of files touched

- `lib/admin/rewards-vouchers-service.ts` (64 lines): one `export function` per route, each guarded by `REWARDS_ENABLED`, `apiRequest(path, { method, body, schema, signal })`. Test `voucher service exports guard pilot build` splits on `export function ` and requires the guard in every one — keep the same shape.
- `lib/admin/rewards-vouchers-view.ts`: pure helpers already unit-tested from `tests/rewards-admin-vouchers-view.test.mjs` (that test sets `process.env.NEXT_PUBLIC_REWARDS_ENABLED = "true"` before dynamic import). Add the two helpers here; keep them pure (no React).
- `app/(signed-in)/(admin)/admin/vouchers/components/VouchersScreen.tsx`: list screen; `AdminPage` wrapper → `space-y-6` column with error alerts, 3 summary tiles, filters, table, `Dialog` for state change. Preserve all of it; only insert the card.
- `app/(signed-in)/(admin)/admin/vouchers/page.tsx`: already `if (!REWARDS_ENABLED) notFound();` — covers AC 5 for the FE flag.
- `mocks/handlers/rewards-admin.ts`: `guarded(request, write)` does `applyScenario("admin")`, mock-admin check (or `HYBRID_ADMIN` in hybrid), CSRF on writes; `body(request, schema)` returns 400 `VALIDATION_ERROR` with `details`; `ok()` / `fail()` from `../envelope`.
- `mocks/data/rewards.ts`: state via `createCollection(key, seed)` from `mocks/db/store.ts` (`get` / `set` / `update(draft => …)`; localStorage-backed, cleared by `resetMockDb` / `resetStore`).
- Hybrid mode (`mocks/handlers/index.ts` `hybridHandlers`) serves only `DEFERRED_KEEP_MOCK` routes, so the new handlers never answer in hybrid; real backend serves them. That is why route-diff counts stay unchanged.

### Guardrails

- Import components from `@/components/ui/*` and services from `@/lib/admin/*`; never import from `mocks/` in app code (`no-direct-mocks.test.mjs` and the voucher-dir scan enforce this).
- Use `apiRequest` (adds CSRF on writes and unwraps the envelope); no raw `fetch`.
- Validate with the shared schema; never hand-code `1_000_000` in the component (it lives in `updateRewardsSettingsSchema`; the message text may contain "1.000.000").
- All UI copy in Vietnamese, as above. Numbers via `toLocaleString("vi-VN")`.
- A11y: input has a label and `aria-invalid`/`aria-describedby` via `TextField`; dialog uses native `<dialog>` from `Dialog`.

### Previous story intelligence (14.1)

- 14.1 kept its new route out of MSW so hybrid passes it through and route-diff stays unchanged; here the route already exists in the backend, so adding MSW handlers is safe for the same reason (route is not MSW-only).
- FE suite was 1003/1003 at 14.1 review; the review patched missing double-submit protection and dialog dismissal while busy — apply both from the start (AC 3).
- 14.1 is merged (PR #57, `6f0d5ab`); this story branches from that commit and touches none of 14.1's files.

### Git intelligence

- Branch: `feat/14-2-rewards-daily-points-limit-setting` from `origin/develop` `6f0d5ab`.
- Recent rewards admin work (Epic 12, PR #33 `7a8cca2`) established the service / view / hooks / MSW / test layout reused here.

### Latest tech information

- No new libraries. Next 16.3, React 19.2, zod 3.25, msw 2.15 already pinned in `apps/frontend/my-app/package.json`. Tests are `node --test tests/*.test.mjs` (`pretest` builds `packages/schemas`).

### Project Structure Notes

- New: `app/(signed-in)/(admin)/admin/vouchers/components/DailyPointsLimitCard.tsx`.
- Modified: `lib/admin/rewards-vouchers-service.ts`, `lib/admin/rewards-vouchers-view.ts`, `app/(signed-in)/(admin)/admin/vouchers/components/VouchersScreen.tsx`, `mocks/data/rewards.ts`, `mocks/handlers/rewards-admin.ts`, `tests/rewards-admin-vouchers.test.mjs`, `tests/rewards-admin-vouchers-view.test.mjs`; optionally `apps/backend/src/modules/rewards/application/rewards-services.spec.ts`.
- A separate hook file is not needed; the card calls `useApiQuery` directly (one caller).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 14.2]
- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-18.md — gap 2, D3]
- [Source: _bmad-output/implementation-artifacts/12-8-quote-redemption-transaction.md — Task 1.7, 4.6, OQ-23 decision]
- [Source: apps/backend/src/modules/rewards/presentation/admin-rewards-vouchers.controller.ts]
- [Source: apps/backend/src/modules/rewards/application/rewards-admin-catalog.service.ts#getSettings]
- [Source: packages/schemas/src/rewards/rewards-settings.schema.ts]
- [Source: apps/frontend/my-app/tests/route-diff.test.mjs]

## Dev Agent Record

### Agent Model Used

claude-opus-5-5 (Claude Code, bmad-dev-story)

### Debug Log References

- Red: 3 new tests failed before implementation (`parseDailyLimitInput`, `rewardsSettingsErrorMessage`, settings handlers).
- First full FE run: 1005/1006; `contract-callsites.test.mjs` "every matched call is exercised by at least one backend e2e spec (AC 1)" failed for `GET/PUT /admin/rewards/settings` (no backend HTTP e2e called them). Fixed by a test-only backend e2e (AC 7).

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created
- Service: `getRewardsSettings` / `updateRewardsSettings` in `rewards-vouchers-service.ts`, both behind `REWARDS_ENABLED`, parsed with `rewardsSettingsSchema`.
- View helpers: `parseDailyLimitInput` (digits only, range from `updateRewardsSettingsSchema`) and `rewardsSettingsErrorMessage` (Dev Notes table).
- `DailyPointsLimitCard` on `/admin/vouchers` above the summary tiles: view / edit / confirm dialog (old → new, "Áp dụng từ lần đổi tiếp theo…"), busy-locked dialog, inline save error, load error + "Thử lại", hidden on 404.
- MSW: `rewardsSettings` collection (default 500) + `GET`/`PUT /admin/rewards/settings` handlers. route-diff unchanged (MSW-only 17 = MOCK_ONLY 3 + DEFERRED_KEEP_MOCK 14).
- Backend test-only (AC 7): service unit test (read, update + one `REWARDS_SETTINGS_UPDATED` audit, suspended Admin → `REWARDS_ADMIN_CAPABILITY_REQUIRED`, nothing persisted) and HTTP e2e in `test/rewards-redemption.e2e-spec.ts` (401, 403 member, 403 no CSRF, 400 for 0 / 1000001 / 1.5 / "800", 200 + `Cache-Control: no-store` on both prefixes). The e2e was required by the `contract-callsites` gate, which the story did not list. No backend source change.
- Verification: FE `npm test` 1006/1006; `npm run typecheck` clean; `npm run lint` 0 errors (3 pre-existing warnings in untouched test files); backend `npx jest` 184 suites / 2744 tests pass; `rewards-redemption.e2e-spec.ts` 7/7; backend eslint + prettier clean on changed specs.
- Manual (next dev, MSW enabled, `NEXT_PUBLIC_REWARDS_ENABLED=true`, mock admin): card shows 500; `abc` shows the inline error with "Lưu" disabled; 500 → 800 confirm dialog matches AC 3; after save the notice shows and the value stays 800 after reload. `0` was covered by unit tests only. Mock state reset afterwards.

### File List

- apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/DailyPointsLimitCard.tsx (new)
- apps/frontend/my-app/app/(signed-in)/(admin)/admin/vouchers/components/VouchersScreen.tsx
- apps/frontend/my-app/lib/admin/rewards-vouchers-service.ts
- apps/frontend/my-app/lib/admin/rewards-vouchers-view.ts
- apps/frontend/my-app/mocks/data/rewards.ts
- apps/frontend/my-app/mocks/handlers/rewards-admin.ts
- apps/frontend/my-app/tests/rewards-admin-vouchers.test.mjs
- apps/frontend/my-app/tests/rewards-admin-vouchers-view.test.mjs
- apps/backend/src/modules/rewards/application/rewards-services.spec.ts
- apps/backend/test/rewards-redemption.e2e-spec.ts
- _bmad-output/implementation-artifacts/14-2-rewards-daily-points-limit-setting.md (new)
- _bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-10-18: Story created (ready-for-dev).
- 2026-10-18: Implemented Admin daily Points limit card, service, view helpers, MSW handlers, FE contract tests, and test-only backend coverage (service unit + HTTP e2e). Status → review.
