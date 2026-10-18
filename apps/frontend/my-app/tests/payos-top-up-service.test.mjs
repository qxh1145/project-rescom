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
  refundDeadline: null,
  refund: {
    canRequest: false,
    unavailableReason: "NOT_SUCCESSFUL",
    destination: null,
    request: null,
  },
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

  await t.test("requestPayosRefund sends POST with CSRF and validates response", async () => {
    const refundResult = {
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "REQUESTED",
        eligibility: "ELIGIBLE",
        ineligibleReason: null,
        reason: "WRONG_AMOUNT",
        points: 250,
        amountVnd: 50000,
        destination: {
          bankId: "970436",
          bankName: "Vietcombank",
          holderName: "TRAN THI A",
          accountNumber: "0123456789",
          last4: "6789",
          verified: true,
        },
        submittedAt: "2026-10-16T10:00:00.000Z",
        withdrawnAt: null,
      },
      replayed: false,
    };

    installFetch(() => jsonResponse(200, { data: refundResult }));

    const res = await service.requestPayosRefund(TOP_UP_ID, {
      reason: "WRONG_AMOUNT",
      note: "Chuyển nhầm số tiền",
    });

    assert.deepEqual(res, refundResult);
    const call = calls.find((c) =>
      c.url.endsWith(`/economy/top-ups/payos/${TOP_UP_ID}/refund-request`),
    );
    assert.ok(call);
    assert.equal(call.init.method, "POST");
    assert.equal(
      call.init.body,
      JSON.stringify({ reason: "WRONG_AMOUNT", note: "Chuyển nhầm số tiền" }),
    );
    assert.equal(call.init.headers["X-CSRF-Token"], "csrf-token");
  });

  await t.test("withdrawPayosRefund sends POST with CSRF and validates response", async () => {
    const withdrawResult = {
      request: {
        id: "44444444-4444-4444-8444-444444444444",
        status: "WITHDRAWN",
        eligibility: "ELIGIBLE",
        ineligibleReason: null,
        reason: "WRONG_AMOUNT",
        points: 250,
        amountVnd: 50000,
        destination: {
          bankId: "970436",
          bankName: "Vietcombank",
          holderName: "TRAN THI A",
          accountNumber: "0123456789",
          last4: "6789",
          verified: true,
        },
        submittedAt: "2026-10-16T10:00:00.000Z",
        withdrawnAt: "2026-10-16T10:10:00.000Z",
      },
      replayed: false,
    };

    installFetch(() => jsonResponse(200, { data: withdrawResult }));

    const res = await service.withdrawPayosRefund(TOP_UP_ID);
    assert.deepEqual(res, withdrawResult);

    const call = calls.find((c) =>
      c.url.endsWith(`/economy/top-ups/payos/${TOP_UP_ID}/refund-request/withdraw`),
    );
    assert.ok(call);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.body, "{}");
    assert.equal(call.init.headers["X-CSRF-Token"], "csrf-token");
  });

  await t.test("payosRefundErrorMessage handles each AC 7 error code", () => {
    // 409 REFUND_ALREADY_RESOLVED
    const resolvedErr = new ApiError({
      status: 409,
      code: "REFUND_ALREADY_RESOLVED",
      message: "Resolved",
    });
    const parsedResolved = messages.payosRefundErrorMessage(resolvedErr);
    assert.equal(parsedResolved.message, "Yêu cầu đã được xử lý");
    assert.equal(parsedResolved.reload, true);

    // 409 TOPUP_REFUND_ALREADY_REQUESTED
    const alreadyErr = new ApiError({
      status: 409,
      code: "TOPUP_REFUND_ALREADY_REQUESTED",
      message: "Already requested",
    });
    const parsedAlready = messages.payosRefundErrorMessage(alreadyErr);
    assert.equal(parsedAlready.message, "Giao dịch này đã có yêu cầu hoàn tiền.");
    assert.equal(parsedAlready.reload, true);

    // 409 TOPUP_REFUND_NOT_ALLOWED per reason
    for (const reason of [
      "DEADLINE_PASSED",
      "LEGACY_MANUAL",
      "NOT_SUCCESSFUL",
      "MISMATCH_CREDITED",
      "WITHDRAWN",
    ]) {
      const err = new ApiError({
        status: 409,
        code: "TOPUP_REFUND_NOT_ALLOWED",
        message: "Not allowed",
        details: { reason },
      });
      const parsed = messages.payosRefundErrorMessage(err);
      assert.ok(parsed.message.length > 0);
      assert.equal(parsed.reload, true);
    }

    // 404 TOPUP_NOT_FOUND and TOPUP_REFUND_NOT_FOUND
    const notFound1 = new ApiError({ status: 404, code: "TOPUP_NOT_FOUND", message: "Not found" });
    assert.equal(messages.payosRefundErrorMessage(notFound1).reload, true);
    const notFound2 = new ApiError({ status: 404, code: "TOPUP_REFUND_NOT_FOUND", message: "Not found" });
    assert.equal(messages.payosRefundErrorMessage(notFound2).reload, true);
    // An unknown 404 (e.g. missing route) is a generic error, not "not found" + reload.
    const unknown404 = new ApiError({ status: 404, code: "NOT_FOUND", message: "Cannot POST /x" });
    const parsedUnknown404 = messages.payosRefundErrorMessage(unknown404);
    assert.equal(parsedUnknown404.reload, false);
    assert.equal(parsedUnknown404.message, "Không thể thực hiện yêu cầu hoàn tiền. Vui lòng thử lại.");

    // 400 VALIDATION_ERROR with field errors
    const valErr = new ApiError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: [
        { path: ["reason"], message: "Reason error" },
        { path: ["note"], message: "Note error" },
      ],
    });
    const parsedVal = messages.payosRefundErrorMessage(valErr);
    assert.equal(parsedVal.reload, false);
    assert.equal(parsedVal.fieldErrors?.reason, "Reason error");
    assert.equal(parsedVal.fieldErrors?.note, "Note error");

    // Network error
    const netErr = new ApiError({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Network error",
      kind: "network",
    });
    const parsedNet = messages.payosRefundErrorMessage(netErr);
    assert.equal(parsedNet.reload, false);
    assert.match(parsedNet.message, /Không kết nối được máy chủ/);
  });
});
