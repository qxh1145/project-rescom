import test from "node:test";
import assert from "node:assert/strict";

test("Wallet API unit tests", async (t) => {
  // Mock global fetch
  const originalFetch = globalThis.fetch;

  try {
    await t.test("successfully parses wallet data on 200 OK", async () => {
      const mockData = {
        balance: {
          available: 150,
          pending: 50,
          escrow: 200,
          frozen: 0,
          integrityHold: 0,
          total: 400,
        },
        transactions: [],
        accounts: [],
      };

      globalThis.fetch = async (url, init) => {
        assert.equal(url, "/api/economy/wallet");
        assert.equal(init?.headers?.Accept, "application/json");
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: mockData }),
        };
      };

      const { fetchWalletDetails } = await import("../app/wallet/wallet-api.ts");
      const result = await fetchWalletDetails();
      assert.deepEqual(result, mockData);
    });

    await t.test("throws user-friendly authentication error on 401", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Unauthorized" } }),
      });

      const { fetchWalletDetails } = await import("../app/wallet/wallet-api.ts");
      await assert.rejects(
        async () => fetchWalletDetails(),
        /Authentication required\. Please log in to view your wallet\./
      );
    });

    await t.test("throws API error message on non-200 responses", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "Internal server error" } }),
      });

      const { fetchWalletDetails } = await import("../app/wallet/wallet-api.ts");
      await assert.rejects(
        async () => fetchWalletDetails(),
        /Internal server error/
      );
    });

    await t.test("throws error on malformed response payload failing schema validation", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { balance: { invalid: true } } }),
      });

      const { fetchWalletDetails } = await import("../app/wallet/wallet-api.ts");
      await assert.rejects(
        async () => fetchWalletDetails(),
        /Received malformed wallet details response from server/
      );
    });
  } finally {
    // Restore fetch safely
    globalThis.fetch = originalFetch;
  }
});
