/**
 * Story IR.4a AC0: build-time scope of the Publisher results screens. Plain
 * constants (the `PAUSE_SUPPORTED` pattern of `manage-service.ts`), each
 * citing the decision behind it. Mock-off plan, decisions of 2026-10-01
 * (internal team testing, "no screen is hidden"); they override the story's
 * pilot defaults.
 */

/** Q1 = BUILD: `GET /forms/:id/analytics` (Tóm tắt / Theo câu hỏi). */
export const RESULTS_ANALYTICS_ENABLED = true;

/** Q3 = BUILD: `GET /forms/:id/versions/:versionId` ("Xem (chỉ đọc)"). */
export const VERSION_DETAIL_ENABLED = true;

/**
 * "Thay đổi so với vN": computed client-side from two real version details
 * (`diffVersions`), so it stays visible (overrides IR.4a AC5.2).
 */
export const VERSION_DIFF_ENABLED = true;

/**
 * Survey Quality tab/page: stays reachable, served by MSW
 * `GET /forms/:id/quality` in the hybrid mode of gate G (Epic 10 deferred;
 * overrides IR.4a AC7.2). Response rows themselves are never graded (R8).
 */
export const SURVEY_QUALITY_ENABLED = true;

/** Export stays open for internal testing, from the real `/responses` rows (overrides AC7.1, OQ-6). */
export const RESPONSE_EXPORT_ENABLED = true;

/**
 * `/forms/[id]/complaints/*` stays reachable, served by MSW (Story 8.5
 * deferred; overrides AC7.4).
 */
export const PUBLISHER_DISPUTES_ENABLED = true;

/** R5 / Q9: feedback is unvalidated and Story 9.3's minimum-aggregation gate applies. */
export const PUBLISHER_FEEDBACK_SUMMARY_ENABLED = false;
