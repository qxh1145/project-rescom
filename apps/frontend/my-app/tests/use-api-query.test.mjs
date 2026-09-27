import test from "node:test";
import assert from "node:assert/strict";

const { queryView, settleWithError } = await import("../lib/api/use-api-query.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const boom = new ApiError({ kind: "network", message: "offline" });

test("a failed reload keeps the same key's data", () => {
  const next = settleWithError({ requestId: "a#0", data: [1], error: null }, "a#1", boom);
  assert.deepEqual(next, { requestId: "a#1", data: [1], error: boom });
});

test("a failure for another key drops the previous key's data", () => {
  const next = settleWithError({ requestId: "a#0", data: [1], error: null }, "b#0", boom);
  assert.deepEqual(next, { requestId: "b#0", data: undefined, error: boom });
  // A key that merely starts like another one is still another key.
  assert.equal(settleWithError({ requestId: "a#0", data: [1], error: null }, "ab#0", boom).data, undefined);
  assert.equal(settleWithError({ requestId: "", data: undefined, error: null }, "a#0", boom).data, undefined);
});

test("queryView exposes only the current key's data and error", () => {
  const settledA = { requestId: "a#0", data: "A", error: boom };
  assert.deepEqual(queryView("a", "a#0", settledA), { data: "A", error: boom, loading: false });
  // Reloading the same key: keep data, hide the old error.
  assert.deepEqual(queryView("a", "a#1", settledA), { data: "A", error: null, loading: true });
  // Switched to key b: nothing from a leaks.
  assert.deepEqual(queryView("b", "b#0", settledA), { data: undefined, error: null, loading: true });
  // key: null → idle, no data, no error.
  assert.deepEqual(queryView(null, "", settledA), { data: undefined, error: null, loading: false });
});
