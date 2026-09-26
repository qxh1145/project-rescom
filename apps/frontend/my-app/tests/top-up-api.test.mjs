import test from "node:test";
import assert from "node:assert/strict";

const TOP_UP_ID = "33333333-3333-4333-8333-333333333333";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone() {
      return jsonResponse(status, body);
    },
  };
}

test("Story 6.6: top-up live API client", async (t) => {
  const { buildVietQrPayload } = await import("@rescom/schemas");
  const api = await import("../app/wallet/top-up-api.ts");
  const originalFetch = globalThis.fetch;

  const pending = {
    id: TOP_UP_ID,
    amount: 100,
    amountVnd: 20000,
    status: "PENDING",
    transferReference: "RESCOMABCDEFGH",
    rejectionReason: null,
    createdAt: "2026-09-26T10:00:00.000Z",
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
  const approvedAdminDto = {
    ...pending,
    status: "APPROVED",
    reviewedAt: "2026-09-26T11:00:00.000Z",
    paymentInstructions: null,
    userId: "11111111-1111-4111-8111-111111111111",
    userEmail: "student@fpt.edu.vn",
    adminId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    journalId: "44444444-4444-4444-8444-444444444444",
    correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  };

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

  try {
    await t.test("creates a request with CSRF and validates the response", async () => {
      installFetch(() => jsonResponse(201, { data: pending }));

      const result = await api.createTopUpRequest(100);

      assert.deepEqual(result, pending);
      const call = calls.find((c) => c.url === "/api/economy/top-ups");
      assert.equal(call.init.method, "POST");
      assert.equal(call.init.body, JSON.stringify({ amount: 100 }));
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get("X-CSRF-Token"), "csrf-token");
      assert.equal(headers.get("Content-Type"), "application/json");
    });

    await t.test("surfaces API error codes and details", async () => {
      installFetch(() =>
        jsonResponse(409, {
          error: {
            code: "TOPUP_PENDING_LIMIT_REACHED",
            message: "Too many pending requests",
            details: { maxPendingRequests: 3 },
          },
        }),
      );

      await assert.rejects(api.createTopUpRequest(100), (error) => {
        assert.equal(error.code, "TOPUP_PENDING_LIMIT_REACHED");
        assert.deepEqual(error.details, { maxPendingRequests: 3 });
        assert.equal(error.message, "Too many pending requests");
        return true;
      });
    });

    await t.test("lists own requests with query parameters", async () => {
      const list = { items: [pending], total: 1, limit: 5, offset: 0, hasMore: false };
      installFetch(() => jsonResponse(200, { data: list }));

      const result = await api.listMyTopUpRequests({ limit: 5, status: "PENDING" });

      assert.deepEqual(result, list);
      assert.equal(calls[0].url, "/api/economy/top-ups?limit=5&status=PENDING");
    });

    await t.test("rejects malformed payloads", async () => {
      installFetch(() => jsonResponse(200, { data: { items: "nope" } }));
      await assert.rejects(
        api.listMyTopUpRequests(),
        /malformed top-up response/,
      );
    });

    await t.test("loads the admin review queue", async () => {
      const queue = {
        items: [{ ...approvedAdminDto, status: "PENDING", reviewedAt: null, paymentInstructions: pending.paymentInstructions, adminId: null, journalId: null, correlationId: null }],
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      };
      installFetch(() => jsonResponse(200, { data: queue }));

      const result = await api.listTopUpRequestsForReview();
      assert.equal(result.items[0].userEmail, "student@fpt.edu.vn");
      assert.equal(calls[0].url, "/api/admin/top-ups");
    });

    await t.test("approves with an optional correlation id", async () => {
      const review = { topUp: approvedAdminDto, journalId: approvedAdminDto.journalId, replayed: false };
      installFetch(() => jsonResponse(200, { data: review }));

      const result = await api.approveTopUpRequest(TOP_UP_ID, {
        correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      });

      assert.equal(result.topUp.status, "APPROVED");
      const call = calls.find((c) => c.url.endsWith("/approve"));
      assert.equal(call.url, `/api/admin/top-ups/${TOP_UP_ID}/approve`);
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get("X-Correlation-Id"), "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
      assert.equal(headers.get("X-CSRF-Token"), "csrf-token");
    });

    await t.test("rejects with a reason", async () => {
      const rejected = {
        ...approvedAdminDto,
        status: "REJECTED",
        journalId: null,
        rejectionReason: "Không tìm thấy giao dịch",
      };
      installFetch(() =>
        jsonResponse(200, { data: { topUp: rejected, journalId: null, replayed: false } }),
      );

      const result = await api.rejectTopUpRequest(TOP_UP_ID, "Không tìm thấy giao dịch");

      assert.equal(result.topUp.rejectionReason, "Không tìm thấy giao dịch");
      const call = calls.find((c) => c.url.endsWith("/reject"));
      assert.equal(call.init.body, JSON.stringify({ reason: "Không tìm thấy giao dịch" }));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
