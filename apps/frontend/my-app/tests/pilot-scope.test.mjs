import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Story IR.1: with `NEXT_PUBLIC_PILOT_BUILD=true` every hidden route renders
 * notFound() and no nav config links to one. `PILOT_HIDDEN_ROUTES`
 * (lib/pilot-scope.ts) is the single list the guards and this test share.
 */
process.env.NEXT_PUBLIC_PILOT_BUILD = "true";

const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const { PILOT_BUILD, PILOT_HIDDEN_ROUTES } = await import("../lib/pilot-scope.ts");
const { ADMIN_NAV } = await import("../components/layout/admin/admin-nav.ts");
const { DESKTOP_NAV, MOBILE_NAV } = await import("../components/layout/app/nav-items.ts");
const { DISPUTE_TABS } = await import("../lib/admin/disputes-view.ts");
const scope = await import("../lib/forms/results-scope.ts");
const { ROUTE_ALLOWLIST } = await import("../mocks/route-allowlist.ts");

const read = (file) => readFileSync(path.join(appRoot, file), "utf8");
const routeRegex = (route) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}(/|$)`);

function sourceFiles(dir) {
  return readdirSync(path.join(appRoot, dir)).flatMap((name) => {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(appRoot, rel)).isDirectory()) return sourceFiles(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
}

test("the pilot flag is on and turns the results flags off", () => {
  assert.equal(PILOT_BUILD, true);
  assert.equal(scope.VERSION_DIFF_ENABLED, false);
  assert.equal(scope.SURVEY_QUALITY_ENABLED, false);
  assert.equal(scope.RESPONSE_EXPORT_ENABLED, false);
  assert.equal(scope.PUBLISHER_DISPUTES_ENABLED, false);
  assert.equal(scope.VERSION_DETAIL_ENABLED, true);
});

test("every hidden route guards with PILOT_BUILD and notFound()", () => {
  assert.ok(PILOT_HIDDEN_ROUTES.length > 0);
  for (const { route, guard } of PILOT_HIDDEN_ROUTES) {
    const source = read(`app/${guard}`);
    assert.match(source, /if \(PILOT_BUILD\) notFound\(\);/, `${route} (${guard})`);
    assert.match(source, /from "next\/navigation"/, route);
  }
});

test("nav configs contain no hidden route", () => {
  const hrefs = [...ADMIN_NAV, ...DESKTOP_NAV, ...MOBILE_NAV].flatMap((item) => [item.href, ...(item.match ?? [])]);
  for (const { route } of PILOT_HIDDEN_ROUTES) {
    const re = routeRegex(route);
    assert.deepEqual(hrefs.filter((href) => re.test(href)), [], route);
  }
  assert.deepEqual(
    ADMIN_NAV.filter((item) => item.queue === "disputes" || item.queue === "quality"),
    [],
    "hidden queue badges",
  );
});

test("admin disputes shows only the real missing-code tab", () => {
  assert.deepEqual(DISPUTE_TABS.map((tab) => tab.kind), ["MISSING_CODE"]);
});

test("no pilot-visible screen calls a DEFERRED_KEEP_MOCK service", () => {
  // Service functions behind DEFERRED_KEEP_MOCK routes (mocks/route-allowlist.ts).
  const deferredCalls = [
    "getReliabilitySummary",
    "getEngagementSummary",
    "getLeaderboard",
    "listQualityReviews",
    "decideQualityReview",
    "getFormQuality",
    "submitAttemptDispute",
    "getAiConversation",
    "sendAiMessage",
    "startAiChat",
    "adoptAiConversation",
    "suggestAiBlock",
  ];
  // Not listed: resolveDisputeCase. It needs a dispute case, and cases come from
  // GET /admin/disputes, which listOpenDisputeCases requests only when isHybridMocking.
  assert.equal(Object.keys(ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK).length, 14);
  const hiddenDirs = PILOT_HIDDEN_ROUTES.map(({ guard }) => `app/${path.dirname(guard)}/`);
  const files = [...sourceFiles("app"), ...sourceFiles("components")];
  for (const file of files) {
    if (hiddenDirs.some((dir) => file.startsWith(dir))) continue;
    const source = read(file);
    for (const fn of deferredCalls) {
      if (!new RegExp(`\\b${fn}\\(`).test(source)) continue;
      assert.match(source, /PILOT_BUILD/, `${file} calls ${fn} without a PILOT_BUILD guard`);
    }
  }
});
