import test from "node:test";
import assert from "node:assert/strict";

const service = await import("../lib/wallet/payos-top-up-service.ts");
const messages = await import("../lib/wallet/payos-top-up-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const TOP_UP_ID = "33333333-3333-4333-8333-333333333333";

const samplePayos = {
  id: TOP_UP_ID,
  orderCode: 12345,
  amountVnd: 50000,
  points: 250,
  status: "PROCESSING",
  checkoutUrl: "https://pay.payos.vn/web/12345",
  expiresAt: "2026-10-15T15:00:00.000Z",
  cancelledAt: null,
  paidAt: null,
  createdAt: "2026-10-15T14:55:00.000Z",
};

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("payos-top-up service API calls and error mappings", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  function installFetch(handler) {
    calls.length = 0;
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/auth/csrf") {
        return jsonResponse(200, { data: { csrfToken: "csrf-token" } });
      }
      return handler(String(url), init);
    };
  }

  await t.test("getPayosAvailability queries /availability", async () => {
    installFetch(() => jsonResponse(200, { data: { payosEnabled: true } }));
    const res = await service.getPayosAvailability();
    assert.deepEqual(res, { payosEnabled: true });
    assert.equal(calls[0].url, "/api/economy/top-ups/payos/availability");
  });

  await t.test("createPayosCheckout sends POST with CSRF and validates payload", async () => {
    installFetch(() =>
      jsonResponse(201, {
        data: { topUp: samplePayos, checkoutUrl: samplePayos.checkoutUrl },
      }),
    );
    const res = await service.createPayosCheckout(50000);
    assert.deepEqual(res.topUp, samplePayos);
    assert.equal(res.checkoutUrl, samplePayos.checkoutUrl);

    const call = calls.find((c) => c.url === "/api/economy/top-ups/payos");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, JSON.stringify({ amountVnd: 50000 }));
    assert.equal(call.init.headers["X-CSRF-Token"], "csrf-token");
  });

  await t.test("createPayosCheckout handles 409 TOPUP_ALREADY_PROCESSING", async () => {
    installFetch(() =>
      jsonResponse(409, {
        error: {
          code: "TOPUP_ALREADY_PROCESSING",
          message: "Already processing",
          details: { topUpId: TOP_UP_ID, checkoutUrl: samplePayos.checkoutUrl },
        },
      }),
    );
    await assert.rejects(
      () => service.createPayosCheckout(50000),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.code, "TOPUP_ALREADY_PROCESSING");
        assert.deepEqual(err.details, {
          topUpId: TOP_UP_ID,
          checkoutUrl: samplePayos.checkoutUrl,
        });
        assert.match(
          messages.payosCheckoutErrorMessage(err),
          /đang có giao dịch đang chờ thanh toán/,
        );
        return true;
      },
    );
  });

  await t.test("createPayosCheckout handles 429 rate limit with retryAfterSeconds", async () => {
    installFetch(() =>
      jsonResponse(429, {
        error: {
          code: "TOPUP_CHECKOUT_RATE_LIMITED",
          message: "Rate limited",
          details: { retryAfterSeconds: 300 },
        },
      }),
    );
    await assert.rejects(
      () => service.createPayosCheckout(50000),
      (err) => {
        assert.ok(err instanceof ApiError);
        assert.equal(err.status, 429);
        assert.match(
          messages.payosCheckoutErrorMessage(err),
          /thao tác quá nhanh.*5 phút/,
        );
        return true;
      },
    );
  });

  await t.test("getPayosTopUp and cancelPayosTopUp", async () => {
    installFetch((url) => {
      if (url.endsWith("/cancel")) {
        return jsonResponse(200, {
          data: { ...samplePayos, status: "CANCELLED" },
        });
      }
      return jsonResponse(200, { data: samplePayos });
    });

    const topUp = await service.getPayosTopUp(TOP_UP_ID);
    assert.equal(topUp.id, TOP_UP_ID);

    const cancelled = await service.cancelPayosTopUp(TOP_UP_ID);
    assert.equal(cancelled.status, "CANCELLED");
  });

  await t.test("listPayosTopUps builds query string and validates list", async () => {
    const listData = {
      items: [samplePayos],
      total: 1,
      limit: 10,
      offset: 0,
      hasMore: false,
    };
    installFetch(() => jsonResponse(200, { data: listData }));

    const res = await service.listPayosTopUps({ limit: 10, offset: 0 });
    assert.deepEqual(res, listData);
    assert.equal(calls[0].url, "/api/economy/top-ups/payos?limit=10&offset=0");
  });
});
