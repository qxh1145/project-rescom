import test from "node:test";
import assert from "node:assert/strict";

const { edgeRequestHeaders, EDGE_KEY_HEADER, CLIENT_IP_HEADER } = await import("../lib/api/edge-headers.ts");

test("no edge key: requests pass through untouched (local dev)", () => {
  assert.equal(edgeRequestHeaders(new Headers({ "x-real-ip": "203.0.113.7" }), undefined), null);
  assert.equal(edgeRequestHeaders(new Headers(), "  "), null);
});

test("adds the edge key and Vercel's client IP, dropping forged values", () => {
  const incoming = new Headers({
    "x-real-ip": "203.0.113.7",
    cookie: "a=b",
    [EDGE_KEY_HEADER]: "forged",
    [CLIENT_IP_HEADER]: "1.2.3.4",
  });
  const headers = edgeRequestHeaders(incoming, "secret");
  assert.equal(headers.get(EDGE_KEY_HEADER), "secret");
  assert.equal(headers.get(CLIENT_IP_HEADER), "203.0.113.7");
  assert.equal(headers.get("cookie"), "a=b");
});

test("without x-real-ip a forged client IP is still removed", () => {
  const headers = edgeRequestHeaders(new Headers({ [CLIENT_IP_HEADER]: "1.2.3.4" }), "secret");
  assert.equal(headers.has(CLIENT_IP_HEADER), false);
});

test("drops any client-sent x-rescom-* headers", () => {
  const incoming = new Headers({
    "x-real-ip": "203.0.113.7",
    "x-rescom-spoof": "bad-actor",
    "x-rescom-role": "admin",
    "X-RESCOM-INTERNAL": "true",
  });
  const headers = edgeRequestHeaders(incoming, "secret");
  assert.equal(headers.get(EDGE_KEY_HEADER), "secret");
  assert.equal(headers.get(CLIENT_IP_HEADER), "203.0.113.7");
  assert.equal(headers.has("x-rescom-spoof"), false);
  assert.equal(headers.has("x-rescom-role"), false);
  assert.equal(headers.has("x-rescom-internal"), false);
});
