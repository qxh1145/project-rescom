import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * Story IR.4a AC1.4 (frontend half of the contract test): the golden fixtures
 * of `packages/schemas/src/forms/__fixtures__/publisher-results` parse through
 * the schemas the frontend services use. The backend half is
 * `apps/backend/test/publisher-results.e2e-spec.ts`; the schemas half is
 * `publisher-results.schema.spec.ts`.
 */

const manage = await import("../lib/forms/manage-service.ts");
const results = await import("../lib/forms/results-service.ts");
const analytics = await import("../lib/forms/results-analytics-service.ts");
const scope = await import("../lib/forms/results-scope.ts");
const { publisherResponsesPageSchema } = await import("@rescom/schemas");

const FIXTURES = new URL("../../../../packages/schemas/src/forms/__fixtures__/publisher-results/", import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), "utf8"));

test("golden fixtures parse through the frontend service schemas", () => {
  assert.equal(manage.formProgressSchema.parse(fixture("progress")).completionsSeries.buckets.length, 7);
  // `getFormResponsesPage` parses with the shared schema itself (no local copy).
  for (const name of ["responses-page-1", "responses-page-2", "responses-not-applicable"]) {
    assert.doesNotThrow(() => publisherResponsesPageSchema.parse(fixture(name)), name);
  }
  assert.equal(analytics.formAnalyticsSchema.parse(fixture("analytics")).availability, "AVAILABLE");
  assert.equal(results.formVersionDetailSchema.parse(fixture("version-detail")).schemaJson.blocks.length, 3);
});

test("responses pages walk through collectResponsePages with the fixture cursor", async () => {
  const pages = { "": fixture("responses-page-1") };
  const first = pages[""];
  pages[first.nextCursor] = fixture("responses-page-2");
  const collected = await results.collectResponsePages(async (cursor) => pages[cursor ?? ""]);
  assert.equal(collected.availability, "AVAILABLE");
  assert.equal(collected.responses.length, 3);
  assert.equal(collected.truncated, false);
  const notApplicable = await results.collectResponsePages(async () => fixture("responses-not-applicable"));
  assert.equal(notApplicable.availability, "NOT_APPLICABLE");
});

test("results scope flags have their internal-testing values (decisions of 2026-10-01)", () => {
  assert.deepEqual(
    {
      RESULTS_ANALYTICS_ENABLED: scope.RESULTS_ANALYTICS_ENABLED,
      VERSION_DETAIL_ENABLED: scope.VERSION_DETAIL_ENABLED,
      VERSION_DIFF_ENABLED: scope.VERSION_DIFF_ENABLED,
      SURVEY_QUALITY_ENABLED: scope.SURVEY_QUALITY_ENABLED,
      RESPONSE_EXPORT_ENABLED: scope.RESPONSE_EXPORT_ENABLED,
      PUBLISHER_DISPUTES_ENABLED: scope.PUBLISHER_DISPUTES_ENABLED,
      PUBLISHER_FEEDBACK_SUMMARY_ENABLED: scope.PUBLISHER_FEEDBACK_SUMMARY_ENABLED,
    },
    {
      RESULTS_ANALYTICS_ENABLED: true,
      VERSION_DETAIL_ENABLED: true,
      VERSION_DIFF_ENABLED: true,
      SURVEY_QUALITY_ENABLED: true,
      RESPONSE_EXPORT_ENABLED: true,
      PUBLISHER_DISPUTES_ENABLED: true,
      PUBLISHER_FEEDBACK_SUMMARY_ENABLED: false,
    },
  );
  assert.equal(manage.PAUSE_SUPPORTED, false);
});

test("deferred pages render unless the pilot build hides them (notFound only behind PILOT_BUILD)", () => {
  for (const page of ["export/page.tsx", "quality/page.tsx", "complaints/[attemptId]/page.tsx", "versions/[versionNumber]/page.tsx"]) {
    const source = readFileSync(new URL(`../app/(signed-in)/(app)/forms/[id]/${page}`, import.meta.url), "utf8");
    assert.doesNotMatch(source.replace("if (PILOT_BUILD) notFound();", ""), /notFound\(/, page);
  }
});
