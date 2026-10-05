import test from "node:test";
import assert from "node:assert/strict";
import { routeKey, backendRoutes } from "./helpers/backend-routes.mjs";
import { CALL_ALLOWLIST, buildMatrix, scanCallsites } from "./helpers/frontend-callsites.mjs";

/**
 * Story IR.5 A1 (AC 1): every API path the frontend calls (`apiRequest`,
 * `apiUrl`, raw `fetch` of `/api/…`, the presigned PUT) is served by a NestJS
 * controller or sits in `CALL_ALLOWLIST` with its reason. Read from source.
 */

const { ROUTE_ALLOWLIST } = await import("../mocks/route-allowlist.ts");

const backend = backendRoutes();
const { calls, unresolved } = scanCallsites();
const key = (call) => (call.path.startsWith("<") ? `${call.method} ${call.path}` : routeKey(call.method, call.path));
const allowlist = new Map(Object.entries(CALL_ALLOWLIST).map(([endpoint, entry]) => {
  const [method, path] = endpoint.split(" ");
  return [path.startsWith("<") ? endpoint : routeKey(method, path), { endpoint, ...entry }];
}));

test("the scan reads known call sites and resolves every path", (t) => {
  for (const known of ["POST /auth/login", "GET /economy/wallet", "POST /storage/uploads/:param/finalize", "POST /responses/:param/integrity-events", "GET /forms/:param/progress"]) {
    assert.ok(calls.some((call) => key(call) === known), `no call site of ${known}: scanner out of date?`);
  }
  t.diagnostic(`${calls.length} call sites, ${new Set(calls.map(key)).size} distinct calls`);
  assert.deepEqual(unresolved, [], `call sites whose path the scan cannot read:\n  ${unresolved.join("\n  ")}`);
});

test("every frontend call is a backend route or an allowlisted one", () => {
  const stray = [...new Set(calls.filter((call) => !backend.has(key(call)) && !allowlist.has(key(call))).map((call) => `${key(call)} (${call.file}:${call.line})`))];
  assert.deepEqual(stray, [], `frontend calls that no controller serves and no allowlist entry covers:\n  ${stray.join("\n  ")}`);
});

test("allowlist entries carry a reason and are neither stale nor served by the backend", () => {
  const called = new Set(calls.map(key));
  for (const [route, entry] of allowlist) {
    assert.ok(["deferred-hidden", "out-of-api"].includes(entry.reason), `${entry.endpoint}: reason "${entry.reason}"`);
    assert.ok(entry.note?.length > 10, `${entry.endpoint}: note`);
    assert.ok(called.has(route), `${entry.endpoint} is allowlisted but no call site uses it: delete the entry`);
    assert.equal(backend.has(route), false, `${entry.endpoint} is served by ${backend.get(route)}: delete the entry`);
  }
});

test("deferred-hidden is exactly the DEFERRED_KEEP_MOCK set of mocks/route-allowlist.ts", () => {
  const hidden = [...allowlist].filter(([, entry]) => entry.reason === "deferred-hidden").map(([route]) => route);
  const deferred = Object.keys(ROUTE_ALLOWLIST.DEFERRED_KEEP_MOCK).map((endpoint) => {
    const [method, path] = endpoint.split(" ");
    return routeKey(method, path);
  });
  assert.deepEqual([...hidden].sort(), [...deferred].sort());
});

test("the matrix has one row per distinct call and no unmatched row", () => {
  const { matrix } = buildMatrix();
  assert.equal(matrix.length, new Set(calls.map(key)).size);
  assert.deepEqual(matrix.filter((row) => row.status === "UNMATCHED").map((row) => row.key), []);
});

test("every matched call is exercised by at least one backend e2e spec (AC 1)", () => {
  const { matrix } = buildMatrix();
  const untested = matrix.filter((row) => row.status === "matched" && row.specs.length === 0).map((row) => row.key);
  assert.deepEqual(untested, [], "matched calls with no backend e2e spec calling the path");
});
