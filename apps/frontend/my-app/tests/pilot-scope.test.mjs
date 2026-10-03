import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { routeKey } from "./helpers/backend-routes.mjs";
import { scanCallsites } from "./helpers/frontend-callsites.mjs";
import {
  enclosingFunctions,
  guardedInFunction,
  guardedInStatement,
  readSource,
  sourceFiles,
  stripComments,
  topLevelFunctionBody,
} from "./helpers/source-scan.mjs";

/**
 * Story IR.1: with `NEXT_PUBLIC_PILOT_BUILD=true` every hidden route renders
 * notFound() and no nav config links to one. `PILOT_HIDDEN_ROUTES`
 * (lib/pilot-scope.ts) is the single list the guards and this test share.
 */
process.env.NEXT_PUBLIC_PILOT_BUILD = "true";

const { PILOT_BUILD, PILOT_HIDDEN_ROUTES, assertPilotMockingDisabled } = await import("../lib/pilot-scope.ts");
const { ADMIN_NAV } = await import("../components/layout/admin/admin-nav.ts");
const { DESKTOP_NAV, MOBILE_NAV } = await import("../components/layout/app/nav-items.ts");
const { DISPUTE_TABS } = await import("../lib/admin/disputes-view.ts");
const scope = await import("../lib/forms/results-scope.ts");
const { ROUTE_ALLOWLIST } = await import("../mocks/route-allowlist.ts");

const read = readSource;
const routeRegex = (route) => new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}(/|$)`);

/** Tokens that make code unreachable in a pilot build: `PILOT_BUILD` and every results-scope flag it turns off. */
const GUARD = ["PILOT_BUILD", ...Object.entries(scope).filter(([, value]) => value === false).map(([name]) => name)].join("|");
/** Flags a pilot build forces off (`assertPilotMockingDisabled`): a service that tests one itself never calls its mock route in the pilot. */
const SERVICE_SELF_GATE = /\b(?:isApiMockingEnabled|isHybridMocking)\b/;
const hiddenDirs = PILOT_HIDDEN_ROUTES.map(({ guard }) => `app/${path.dirname(guard)}/`);
const inHiddenDir = (file) => hiddenDirs.some((dir) => file.startsWith(dir));

test("the pilot flag is on and turns the results flags off", () => {
  assert.equal(PILOT_BUILD, true);
  assert.equal(scope.VERSION_DIFF_ENABLED, false);
  assert.equal(scope.SURVEY_QUALITY_ENABLED, false);
  assert.equal(scope.RESPONSE_EXPORT_ENABLED, false);
  assert.equal(scope.PUBLISHER_DISPUTES_ENABLED, false);
  assert.equal(scope.VERSION_DETAIL_ENABLED, true);
});

test("every hidden route guards with PILOT_BUILD and notFound() inside its page/layout function", () => {
  assert.ok(PILOT_HIDDEN_ROUTES.length > 0);
  for (const { route, guard } of PILOT_HIDDEN_ROUTES) {
    const code = stripComments(read(`app/${guard}`));
    const at = code.indexOf("if (PILOT_BUILD) notFound();");
    assert.ok(at >= 0, `${route} (${guard}): no \`if (PILOT_BUILD) notFound();\``);
    assert.ok(enclosingFunctions(code, at).length > 0, `${route} (${guard}): the guard is outside the page/layout function`);
    assert.match(code, /import \{[^}]*\bnotFound\b[^}]*\} from "next\/navigation"/, route);
  }
});

test("the guard helper checks the same function, not the whole file (it is not vacuous)", () => {
  const code = [
    "function a() { if (PILOT_BUILD) return; deferred(); }",
    "function b() { deferred(); }",
    "function c() { const f = useCallback(async () => { if (PILOT_BUILD) return; deferred(); }, []); deferred(); }",
    "function d() { return PILOT_BUILD ? null : useApiQuery(\"k\", (signal) => deferred(signal)); }",
  ].join("\n");
  const guarded = [...code.matchAll(/deferred\(/g)].map((m) => guardedInFunction(code, m.index, "PILOT_BUILD"));
  assert.deepEqual(guarded, [true, false, true, false, true]);
});

test("proxy.ts 404s exactly the hidden routes (IR.5 E1)", () => {
  // Read, not imported: proxy.ts uses the `@/` alias and next/server.
  const matcherBlock = read("proxy.ts").match(/matcher:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
  const matcher = [...matcherBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const normalize = (route) => route.replace(/\[[^\]]+\]|:[^/]+/g, ":p");
  assert.deepEqual(matcher.map(normalize).sort(), PILOT_HIDDEN_ROUTES.map(({ route }) => normalize(route)).sort());
  assert.match(read("proxy.ts"), /if \(!PILOT_BUILD\) return NextResponse\.next\(\);/);
});

test("nav configs contain no hidden route", () => {
  const hrefs = [...ADMIN_NAV, ...DESKTOP_NAV, ...MOBILE_NAV].flatMap((item) => [item.href, ...(item.match ?? [])]);
  for (const { route } of PILOT_HIDDEN_ROUTES) {
    const re = routeRegex(route);
    assert.deepEqual(hrefs.filter((href) => re.test(href)), [], route);
  }
  assert.deepEqual(
    ADMIN_NAV.filter((item) => item.queue === "quality"),
    [],
    "hidden queue badges",
  );
});

test("admin disputes shows only the real missing-code tab", () => {
  assert.deepEqual(DISPUTE_TABS.map((tab) => tab.kind), ["MISSING_CODE"]);
});

test("no pilot-visible code reaches a DEFERRED_KEEP_MOCK service without a PILOT_BUILD guard in the same function", () => {
  // The service functions are derived: every function that calls a DEFERRED_KEEP_MOCK route (mocks/route-allowlist.ts).
  const deferredRoutes = Object.keys(ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK).map((endpoint) => {
    const [method, route] = endpoint.split(" ");
    return routeKey(method, route);
  });
  const { calls } = scanCallsites();
  const services = new Map();
  for (const call of calls) {
    if (!deferredRoutes.includes(routeKey(call.method, call.path))) continue;
    assert.ok(call.fn, `${call.file}:${call.line} ${call.method} ${call.path}: not inside a named function`);
    const code = stripComments(read(call.file));
    const gated = SERVICE_SELF_GATE.test(topLevelFunctionBody(code, call.index) ?? "");
    const id = `${call.file}#${call.fn}`;
    services.set(id, { file: call.file, fn: call.fn, gated, keys: [...(services.get(id)?.keys ?? []), routeKey(call.method, call.path)] });
  }
  const covered = new Set([...services.values()].flatMap((service) => service.keys));
  assert.deepEqual(
    deferredRoutes.filter((route) => !covered.has(route)),
    [],
    "DEFERRED_KEEP_MOCK routes no frontend service function calls",
  );
  assert.ok(services.size >= 12, `only ${services.size} deferred service functions found`);

  // A function that is only reachable through another one stays unguarded itself, but that one must be self-gated.
  const reachableOnlyVia = { resolveDisputeCase: "listOpenDisputeCases" };
  for (const [fn, via] of Object.entries(reachableOnlyVia)) {
    assert.ok(services.has(`lib/admin/disputes-service.ts#${via}`), `${via} is no longer a deferred service`);
    assert.equal(services.get(`lib/admin/disputes-service.ts#${via}`).gated, true, `${via} must gate its mock route on isApiMockingEnabled/isHybridMocking`);
    assert.ok(services.has(`lib/admin/disputes-service.ts#${fn}`), `${fn} is no longer a deferred service`);
  }

  const unguarded = [];
  const files = ["app", "components", "lib"].flatMap(sourceFiles).filter((file) => !inHiddenDir(file));
  for (const { file: serviceFile, fn, gated } of services.values()) {
    if (gated || fn in reachableOnlyVia) continue;
    for (const file of files) {
      if (file === serviceFile) continue;
      // Import lists name the function without calling it.
      const code = stripComments(read(file)).replace(/^import\b[\s\S]*?\bfrom\s+["'][^"']+["'];?/gm, (match) => match.replace(/[^\n]/g, " "));
      for (const use of code.matchAll(new RegExp(`\\b${fn}\\b`, "g"))) {
        if (!guardedInFunction(code, use.index, GUARD)) {
          unguarded.push(`${file}:${code.slice(0, use.index).split("\n").length} uses ${fn} without ${GUARD.split("|")[0]} (or a pilot-off flag) in the same function`);
        }
      }
    }
  }
  assert.deepEqual(unguarded, []);
});

test("no pilot-visible link or navigation targets a hidden route without a guard", () => {
  const targets = PILOT_HIDDEN_ROUTES.map(({ route }) => ({
    route,
    re: new RegExp(`^${route.replace(/\[[^\]]+\]/g, "[^/]+")}(?:[/?#]|$)`),
  }));
  const files = ["app", "components", "lib"]
    .flatMap(sourceFiles)
    .filter((file) => !inHiddenDir(file) && file !== "lib/pilot-scope.ts");
  let seen = 0;
  const unguarded = [];
  for (const file of files) {
    const code = stripComments(read(file));
    for (const literal of code.matchAll(/(["'`])(\/[^"'`\n]*)\1/g)) {
      const path = literal[2].replace(/\$\{[^}]*\}/g, "x");
      const hit = targets.find(({ re }) => re.test(path));
      if (!hit) continue;
      seen += 1;
      const guarded = enclosingFunctions(code, literal.index).length
        ? guardedInFunction(code, literal.index, GUARD)
        : guardedInStatement(code, literal.index, GUARD);
      if (!guarded) unguarded.push(`${file}:${code.slice(0, literal.index).split("\n").length} "${literal[2]}" -> ${hit.route}`);
    }
  }
  assert.ok(seen >= 8, `only ${seen} links to hidden routes found: is the scan still reading hrefs?`);
  assert.deepEqual(unguarded, []);
});

test("a pilot build refuses enabled/hybrid API mocking", () => {
  for (const mode of ["enabled", "hybrid"]) {
    assert.throws(() => assertPilotMockingDisabled(true, mode), /NEXT_PUBLIC_API_MOCKING/, mode);
  }
  assert.doesNotThrow(() => assertPilotMockingDisabled(true, "disabled"));
  assert.doesNotThrow(() => assertPilotMockingDisabled(false, "hybrid"));
});
