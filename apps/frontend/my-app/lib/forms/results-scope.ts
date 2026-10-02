import { PILOT_BUILD } from "../pilot-scope.ts";

/**
 * Story IR.4a AC0: build-time scope of the Publisher results screens. Plain
 * constants (the `PAUSE_SUPPORTED` pattern of `manage-service.ts`), each
 * citing the decision behind it. Mock-off plan, decisions of 2026-10-01
 * (internal team testing, "no screen is hidden"); they override the story's
 * pilot defaults. The four flags below turn off in the pilot build
 * (`NEXT_PUBLIC_PILOT_BUILD`, lib/pilot-scope.ts).
 */

/** Q1 = BUILD: `GET /forms/:id/analytics` (Tóm tắt / Theo câu hỏi). */
export const RESULTS_ANALYTICS_ENABLED = true;

/** Q3 = BUILD: `GET /forms/:id/versions/:versionId` ("Xem (chỉ đọc)"). */
export const VERSION_DETAIL_ENABLED = true;

/**
 * "Thay đổi so với vN": computed client-side from two real version details
 * (`diffVersions`). Visible for internal testing (overrides IR.4a AC5.2);
 * hidden in the pilot build (IR.1).
 */
export const VERSION_DIFF_ENABLED = !PILOT_BUILD;

/**
 * Survey Quality tab/page: hidden in the pilot build (IR.1); otherwise served by MSW
 * `GET /forms/:id/quality` in the hybrid mode of gate G (Epic 10 deferred;
 * overrides IR.4a AC7.2). Response rows themselves are never graded (R8).
 */
export const SURVEY_QUALITY_ENABLED = !PILOT_BUILD;

/** Export: open for internal testing from the real `/responses` rows (overrides AC7.1, OQ-6); hidden in the pilot build. */
export const RESPONSE_EXPORT_ENABLED = !PILOT_BUILD;

/**
 * `/forms/[id]/complaints/*`: hidden in the pilot build; otherwise served by MSW (Story 8.5
 * deferred; overrides AC7.4).
 */
export const PUBLISHER_DISPUTES_ENABLED = !PILOT_BUILD;

/** R5 / Q9: feedback is unvalidated and Story 9.3's minimum-aggregation gate applies. */
export const PUBLISHER_FEEDBACK_SUMMARY_ENABLED = false;
