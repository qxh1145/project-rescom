import test from "node:test";
import assert from "node:assert/strict";

const { buildVietQrPayload } = await import("@rescom/schemas");
const service = await import("../lib/wallet/top-up-service.ts");
const rules = await import("../lib/wallet/top-up.ts");
const messages = await import("../lib/wallet/wallet-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const TOP_UP_ID = "33333333-3333-4333-8333-333333333333";

const pending = {
  id: TOP_UP_ID,
  amount: 100,
  amountVnd: 20000,
  status: "PENDING",
  transferReference: "RESCOMABCDEFGH",
  rejectionReason: null,
  createdAt: "2026-09-26T14:45:00.000Z",
  reviewedAt: null,
  paymentInstructions: {
    bankName: "Vietcombank",
    bankBin: "970436",
    accountNumber: "0123456789",
    accountName: "RESCOM DEMO",
    amountVnd: 20000,
    transferContent: "RESCOMABCDEFGH",
    qrPayload: buildVietQrPayload({
      bankBin: "970436",
      accountNumber: "0123456789",
      amountVnd: 20000,
      transferContent: "RESCOMABCDEFGH",
    }),
  },
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("top-up service (Story 6.6, VERIFIED routes)", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  function installFetch(handler) {
    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/auth/csrf") return jsonResponse(200, { data: { csrfToken: "csrf-token" } });
      return handler(String(url), init);
    };
  }

  await t.test("creates a request with CSRF and validates the response", async () => {
    installFetch(() => jsonResponse(201, { data: pending, error: null, meta: {} }));
    const result = await service.createTopUpRequest(100);
    assert.deepEqual(result, pending);
    const call = calls.find((c) => c.url === "/api/economy/top-ups");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, JSON.stringify({ amount: 100 }));
    assert.equal(call.init.headers["X-CSRF-Token"], "csrf-token");
    assert.equal(call.init.headers["Content-Type"], "application/json");
  });

  await t.test("surfaces the pending-limit code, details and Vietnamese copy", async () => {
    installFetch(() =>
      jsonResponse(409, {
        data: null,
        error: { code: "TOPUP_PENDING_LIMIT_REACHED", message: "Too many", details: { maxPendingRequests: 3 } },
        meta: {},
      }),
    );
    await assert.rejects(service.createTopUpRequest(100), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "TOPUP_PENDING_LIMIT_REACHED");
      assert.deepEqual(error.details, { maxPendingRequests: 3 });
      assert.equal(messages.isPendingLimitError(error), true);
      assert.match(messages.createTopUpErrorMessage(error), /3 yêu cầu nạp chờ duyệt/);
      return true;
    });
  });

  await t.test("lists own requests with query parameters", async () => {
    const list = { items: [pending], total: 1, limit: 5, offset: 0, hasMore: false };
    installFetch(() => jsonResponse(200, { data: list, error: null, meta: {} }));
    const result = await service.listMyTopUpRequests({ limit: 5, status: "PENDING" });
    assert.deepEqual(result, list);
    assert.equal(calls[0].url, "/api/economy/top-ups?limit=5&status=PENDING");
  });

  await t.test("rejects malformed payloads", async () => {
    installFetch(() => jsonResponse(200, { data: { items: "nope" }, error: null, meta: {} }));
    await assert.rejects(service.listMyTopUpRequests(), (error) => error instanceof ApiError && error.kind === "malformed");
  });

  await t.test("pages through the list (offset) before declaring a request missing", async () => {
    const other = (n) => ({ ...pending, id: `55555555-5555-4555-8555-${String(n).padStart(12, "0")}` });
    installFetch((url) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset") ?? 0);
      const items = offset === 0 ? [other(1), other(2)] : offset === 2 ? [pending] : [];
      return jsonResponse(200, { data: { items, total: 3, limit: 50, offset, hasMore: offset === 0 }, error: null, meta: {} });
    });
    assert.equal((await service.getMyTopUpRequest(TOP_UP_ID)).id, TOP_UP_ID);
    assert.deepEqual(
      calls.map((call) => call.url),
      ["/api/economy/top-ups?limit=50", "/api/economy/top-ups?limit=50&offset=2"],
    );

    // Never more than TOP_UP_LOOKUP_MAX_PAGES requests.
    installFetch((url) => {
      const offset = Number(new URL(url, "http://x").searchParams.get("offset") ?? 0);
      return jsonResponse(200, { data: { items: [other(offset + 10)], total: 999, limit: 50, offset, hasMore: true }, error: null, meta: {} });
    });
    await assert.rejects(service.getMyTopUpRequest(TOP_UP_ID), (error) => error.code === "TOPUP_NOT_FOUND");
    assert.equal(calls.length, service.TOP_UP_LOOKUP_MAX_PAGES);
  });

  await t.test("finds one request in the newest page, or 404 TOPUP_NOT_FOUND", async () => {
    installFetch(() => jsonResponse(200, { data: { items: [pending], total: 1, limit: 50, offset: 0, hasMore: false }, error: null, meta: {} }));
    assert.equal((await service.getMyTopUpRequest(TOP_UP_ID)).id, TOP_UP_ID);
    assert.equal(calls[0].url, "/api/economy/top-ups?limit=50");
    await assert.rejects(service.getMyTopUpRequest("44444444-4444-4444-8444-444444444444"), (error) => {
      assert.equal(error.code, "TOPUP_NOT_FOUND");
      assert.match(messages.loadTopUpErrorMessage(error), /Không tìm thấy yêu cầu nạp/);
      return true;
    });
  });
});

test("top-up rules (Figma 14a)", async (t) => {
  await t.test("money uses the schema rate and vi-VN grouping", () => {
    assert.equal(rules.topUpVnd(100), 20000);
    assert.equal(rules.formatVnd(rules.topUpVnd(100)), "20.000đ");
    assert.equal(rules.formatVnd(100000), "100.000đ");
    assert.equal(rules.copyableVnd(20000), "20000");
  });

  await t.test("custom amount: integer, ≥ min, ≤ max, multiple of 100", () => {
    assert.deepEqual(rules.checkTopUpPoints("300"), { ok: true, points: 300 });
    assert.deepEqual(rules.checkTopUpPoints(" 1.000 "), { ok: true, points: 1000 });
    assert.deepEqual(rules.checkTopUpPoints("12.500"), { ok: true, points: 12500 });
    // Dots only as thousands separators: "3.00" is not 300.
    for (const input of ["3.00", "1.0000", ".300", "300.", "1..000"]) {
      assert.equal(rules.checkTopUpPoints(input).ok, false, input);
    }
    assert.equal(rules.checkTopUpPoints("abc").ok, false);
    assert.match(rules.checkTopUpPoints("50").message, /Tối thiểu 100 điểm \(20\.000đ\)/);
    assert.match(rules.checkTopUpPoints("250").message, /bội số của 100/);
    assert.match(rules.checkTopUpPoints("60000").message, /Tối đa/);
  });

  await t.test("timeline follows the request status", () => {
    const states = (status) =>
      rules.topUpTimeline({ amount: 100, status, rejectionReason: "Sai nội dung" }, "26/09 · 21:45").map((s) => s.state);
    assert.deepEqual(states("PENDING"), ["done", "current", "todo"]);
    assert.deepEqual(states("APPROVED"), ["done", "done", "done"]);
    assert.deepEqual(states("REJECTED"), ["done", "failed", "todo"]);
    const [, review] = rules.topUpTimeline({ amount: 100, status: "REJECTED", rejectionReason: "Sai nội dung" }, "x");
    assert.equal(review.detail, "Lý do: Sai nội dung");
  });

  await t.test("routes", () => {
    assert.equal(rules.topUpTransferPath(TOP_UP_ID), `/wallet/top-up/${TOP_UP_ID}`);
    assert.equal(rules.topUpStatusPath(TOP_UP_ID), `/wallet/top-up/${TOP_UP_ID}/pending`);
  });
});
