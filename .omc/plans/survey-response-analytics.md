# Survey Response Analytics — implementation plan (2026-09-27)

Status: APPROVED 2026-09-27 — Recharts, table moves to /responses/individual, SCHEMA_VERSION 2→3.

## 1. What already exists (verified in code)

| Area | Finding |
|---|---|
| Routing | Publisher survey workspace is `/forms/:id/*` (not `/surveys/:id` — that is the respondent side). `FormWorkspace.tsx` renders header + `SurveyTabs` (Tiến độ · Câu trả lời · Chất lượng · Phiên bản). |
| Responses tab | Already built (Figma 10d/10d'): `/forms/:id/responses` = table + side panel, `/forms/:id/responses/:responseId` = one response with prev/next, `?v=` version, `?quality=&q=&page=`. `ResponsesProvider` loads `GET /forms/:id/responses` once for the whole segment. This IS the "Individual" view. |
| Google Forms surveys | `EXTERNAL` surveys have no Responses tab (answers stay in Google). Analytics = INTERNAL only. |
| Data | `lib/forms/results-service.ts` (zod, `apiRequest`) — `ResultQuestion` (id, number, title, type, options, allowOther, scale) + `FormResponse` (anonymous `code`, submittedAt, durationSeconds, answers by question id). `lib/forms/results-view.ts` has answer formatters (`answerText`, `scalePointLabel`, `questionKindLabel`, duration). |
| Question types | `@rescom/schemas` `formBlockTypeEnum`: text, textarea, number, single_choice, multiple_choice, rating, linear_scale, date, file_upload. No dropdown / yes_no types → a 2-option single_choice is the yes/no case. |
| Anonymity | Publishers never see identity — rows carry only `code` (#47AD). Individual view keeps that. |
| Mock | `mocks/handlers/forms-results.ts` (`ownedForm`, `questionsOf`, `pickVersion` — private), data `mocks/data/form-responses.ts` (housing survey: 20 responses, 8 questions: single×4, multi×2, linear_scale, textarea). |
| Charts | No chart library. `OpensChart` / `DropOffChart` are hand-rolled div bars. |
| Theme | Light only (`.dark` is never set). Colors are `@theme` tokens in `app/globals.css`. |
| Loading | `ResultsLoading` = spinner; skeletons exist only locally (`AiDraftSkeleton`, `animate-pulse` in a few screens). No shared `Skeleton` primitive. |
| Peer work | Uncommitted changes from another session in `mocks/handlers/forms-{builder,manage,results}.ts`, `mocks/data/form-activity*.ts`. This plan only adds `export` to 3 helpers in `forms-results.ts`; everything else goes in new files. |

## 2. Routes

```
/forms/:id/responses                  → Tóm tắt (Summary)      [NEW default]
/forms/:id/responses/questions        → Theo câu hỏi (?question=<id>)  [NEW]
/forms/:id/responses/individual       → Từng câu trả lời = today's table + panel (moved)
/forms/:id/responses/:responseId      → unchanged (detail; back link → /individual)
```
Sub-nav (3 links) under the existing tab bar, inside `responses/layout.tsx`; `?v=` is carried across.
Static segments win over `[responseId]` in Next, so the old detail links keep working.

## 3. API contract (ASSUMED API CONTRACT — backend aggregates)

`GET /forms/:id/analytics[?versionNumber=]` → owner/ADMIN only, same errors as `/responses`.

```ts
{
  form: { id, title, type, versionNumber },
  totalResponses: number,
  startedCount: number | null,          // → completion rate (null = unknown → metric hidden)
  averageDurationSeconds: number | null,
  lastResponseAt: string | null,
  questions: Array<{
    questionId, number, title, type, required,
    answeredCount, skippedCount,
    summary:
      | { kind: "choice"; multiple: boolean;
          options: { value, label, count, percentage }[];      // percentage vs answeredCount
          other: { count, percentage, samples: string[] } | null }  // allowOther free text
      | { kind: "scale"; min, max, minLabel, maxLabel;
          buckets: { value, count, percentage }[]; average, median }   // rating + linear_scale
      | { kind: "number"; average, median, min, max;
          buckets: { label, count, percentage }[] }                    // ≤ 8 bins
      | { kind: "text"; samples: { responseId, value, submittedAt }[] }  // latest 5; text/textarea/date
      | { kind: "file"; }                                              // count only
  }>
}
```
- `percentage` = count / answeredCount × 100, 1 decimal, computed server-side. multiple_choice uses the same denominator (respondents who answered) → sum may exceed 100%; never normalised.
- "Xem tất cả" for text answers: Questions tab lists every answer from the already-existing `GET /forms/:id/responses` (no new endpoint).
- Frontend validates with zod in `lib/forms/results-analytics-service.ts`; the aggregation lives only in the mock (`mocks/data/form-analytics.ts`, pure + unit-tested) so a real backend can replace it 1:1.

## 4. Visualization mapping (config, not per-screen code)

`lib/forms/results-analytics.ts`:
```
single_choice  ≤5 options → donut, >5 → horizontal bar   (2 options = yes/no → donut)
multiple_choice            → horizontal bar
rating, linear_scale       → vertical bar + average/median
number                     → vertical bar (bins) + average/median/min/max
text, textarea, date       → answer list
file_upload                → count only
```
Plus: `formatPercent` (≤1 decimal, "34%" not "34,0%", vi-VN), `formatCount` (vi-VN), stable option→color mapping by option index (5–6 token colors, then primary tint for the rest), "Khác" always the neutral color.

## 5. Components

Shared (reusable in dashboard/admin/public later) — `components/analytics/`:
- `QuestionAnalyticsCard.tsx` — props `{ question, summary, answeredCount, variant: "summary" | "detail", footer? }`; picks the visual from the mapping.
- `DonutChart.tsx`, `DistributionBarChart.tsx` (horizontal + vertical) — chart library wrapper (see decision).
- `DistributionTable.tsx` — legend: color dot · label · count · % (always present → count/% readable without hover; `role="table"` for a11y).
- `StatList.tsx` — average / median / min / max chips.
- `TextAnswerList.tsx` — answers + "Xem tất cả N câu trả lời".
- `AnalyticsSkeleton.tsx` — header + card skeletons with fixed chart heights (no layout shift).

Route (`app/(signed-in)/(app)/forms/[id]/responses/`):
- `components/ResponsesSubnav.tsx`, `components/AnalyticsHeader.tsx` ("321 câu trả lời" + Tỷ lệ hoàn thành / Thời gian TB / Gần nhất), `components/SummaryScreen.tsx`, `components/QuestionScreen.tsx` (prev/next + Select of questions + full table; text questions list all answers with search).
- `hooks/analytics-context.tsx` — `useApiQuery(GET /analytics)` shared by Summary + Questions (no refetch when switching).
- Empty state: reuse `ResultsEmpty` + "Sao chép liên kết khảo sát" (`lib/clipboard.ts`); no chart rendered.
- Errors: reuse `ResultsError`; copy in `lib/forms/results-messages.ts`.

Layout: desktop card = chart (left) + legend (right) grid; < md stacks chart → legend. Legend labels wrap (no truncation); bars keep labels in the table, not on the axis, so nothing is clipped at 360px.

## 6. Mock data

| Survey | Responses | Coverage |
|---|---|---|
| "Nhu cầu nhà trọ gần trường" (existing) | 20 | single, multi, linear_scale, textarea, allowOther |
| NEW "Đánh giá trải nghiệm RESCOM" (INTERNAL, CLOSED/đủ mẫu) | 321 | gender single (Nam 126 / Nữ 194 / Khác 1), age single 5 options (109/76/34/48/54), platforms multi (Facebook 245 / TikTok 210 / Instagram 145 / …), rating 5★ (10/15/44/103/149 → 4,1), linear 1–10, yes/no, single with 8 options (→ bar), number, short text, date |
| NEW "Khảo sát mới đăng" (INTERNAL, PUBLISHED) | 0 | empty state |

Rows generated deterministically (exact counts, seeded shuffle) in `mocks/data/form-analytics-seed.ts`; added to the existing collections (`forms`, `form-versions`, `form-responses`). `SCHEMA_VERSION` 2→3 in `mocks/db/store.ts` so stored demo data picks up the new seeds (resets local mock state once).

## 7. Files

New
- `lib/forms/results-analytics-service.ts`, `lib/forms/results-analytics.ts`
- `components/analytics/{QuestionAnalyticsCard,DonutChart,DistributionBarChart,DistributionTable,StatList,TextAnswerList,AnalyticsSkeleton}.tsx`
- `app/(signed-in)/(app)/forms/[id]/responses/{questions,individual}/page.tsx`
- `…/responses/components/{ResponsesSubnav,AnalyticsHeader,SummaryScreen,QuestionScreen}.tsx`, `…/responses/hooks/analytics-context.tsx`
- `mocks/data/form-analytics.ts`, `mocks/data/form-analytics-seed.ts`, `mocks/handlers/forms-analytics.ts`
- `tests/forms-analytics.test.mjs`

Modified
- `…/responses/page.tsx` (→ Summary), `…/responses/layout.tsx` (sub-nav + analytics provider), `ResponsesScreen.tsx` / `ResponsesMobile.tsx` (list base path → `/individual`)
- `lib/forms/results-messages.ts`
- `mocks/handlers/forms-results.ts` (export `ownedForm`, `questionsOf`, `pickVersion` only), `mocks/handlers/index.ts`
- `mocks/data/{forms,form-versions,form-responses}.ts` (seed hooks), `mocks/db/store.ts` (SCHEMA_VERSION)
- `docs/frontend/api-conventions.md` (endpoint row)
- `package.json` (+ recharts, if chosen)

## 8. Data flow

```
Summary/Questions page
  → AnalyticsProvider (responses/layout) → useApiQuery("form-analytics:id:v")
  → getFormAnalytics() → apiRequest GET /forms/:id/analytics (zod-validated)
  → [mock] MSW forms-analytics handler → ownedForm + pickVersion → buildFormAnalytics(questions, rows, snapshot)
  → [later] NestJS aggregation, same DTO
  → QuestionAnalyticsCard × N → chartKindOf(type, optionCount) → Donut / Bar / TextAnswerList / StatList + DistributionTable
Individual page → existing ResponsesProvider → GET /forms/:id/responses (unchanged)
```

## 9. Verification
- `npm run typecheck`, `npm run lint`, `npm test` (new analytics tests: percentages, rounding, checkbox >100%, rating avg/median, empty survey, chart mapping).
- Browser (mock mode): 321 / 20 / 0 surveys × Summary / Questions / Individual, 375px + desktop, `?msw=slow` skeleton, `?msw=api-error`.
- Separate code-review pass before reporting done.

## Out of scope
AI insight, sentiment, keywords, cross-tab, export PDF, filtering on analytics, significance.
