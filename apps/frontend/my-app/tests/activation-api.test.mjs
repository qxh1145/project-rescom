import test from "node:test";
import assert from "node:assert/strict";

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

const USER_ID = "11111111-1111-4111-8111-111111111111";

function statusDto(activationState, overrides = {}) {
  return {
    userId: USER_ID,
    isGranted: true,
    frozenBalance: activationState === "ACTIVATED" ? 0 : 100,
    isDemographicComplete: true,
    hasCompletedMarketplaceSurvey: activationState !== "SURVEY_REQUIRED",
    isUnlocked: activationState === "ACTIVATED",
    isExpired: false,
    registeredAt: "2026-09-20T08:00:00.000Z",
    expiresAt: "2026-10-20T08:00:00.000Z",
    daysRemaining: 24,
    unlockEligibility: {
      eligible: activationState === "READY_TO_UNLOCK",
      missingSteps: activationState === "SURVEY_REQUIRED" ? ["Complete 1 Marketplace Survey"] : [],
    },
    activationState,
    activatedAt: activationState === "ACTIVATED" ? "2026-09-26T10:00:00.000Z" : null,
    activationSurvey: null,
    isVerifiedMember: activationState === "ACTIVATED" || activationState === "READY_TO_UNLOCK",
    ...overrides,
  };
}

test("Story 7.2: starter-points activation live API client", async (t) => {
  const api = await import("../app/marketplace/activation-api.ts");
  const originalFetch = globalThis.fetch;
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
    await t.test("reads the activation status", async () => {
      installFetch(() => jsonResponse(200, { data: statusDto("SURVEY_REQUIRED") }));

      const status = await api.fetchStarterPointsStatus();

      assert.equal(status.activationState, "SURVEY_REQUIRED");
      assert.equal(calls[0].url, "/api/economy/starter-points/status");
      assert.equal(calls[0].init.method ?? "GET", "GET");
    });

    await t.test("claims the unlock with the CSRF token", async () => {
      installFetch(() =>
        jsonResponse(200, {
          data: { unlocked: true, amount: 100, journalId: "j-1", activationState: "ACTIVATED" },
        }),
      );

      const result = await api.claimStarterPointsUnlock();

      assert.equal(result.unlocked, true);
      const post = calls.find((call) => call.url === "/api/economy/starter-points/unlock");
      assert.ok(post);
      assert.equal(post.init.method, "POST");
      assert.equal(new Headers(post.init.headers).get("X-CSRF-Token"), "csrf-token");
    });

    await t.test("refresh claims only when the step is ready, then re-reads the status", async () => {
      let statusReads = 0;
      installFetch((url) => {
        if (url === "/api/economy/starter-points/status") {
          statusReads += 1;
          return jsonResponse(200, {
            data: statusDto(statusReads === 1 ? "READY_TO_UNLOCK" : "ACTIVATED"),
          });
        }
        return jsonResponse(200, { data: { unlocked: true, amount: 100, activationState: "ACTIVATED" } });
      });

      const status = await api.refreshActivationStatus();

      assert.equal(status.activationState, "ACTIVATED");
      assert.equal(statusReads, 2);
      assert.equal(calls.filter((c) => c.url === "/api/economy/starter-points/unlock").length, 1);
    });

    await t.test("refresh never claims while an External survey is under review", async () => {
      installFetch(() => jsonResponse(200, { data: statusDto("PENDING_CONFIRMATION") }));

      const status = await api.refreshActivationStatus();

      assert.equal(status.activationState, "PENDING_CONFIRMATION");
      assert.equal(calls.some((c) => c.url === "/api/economy/starter-points/unlock"), false);
    });

    await t.test("code review P14: a failed claim keeps the READY_TO_UNLOCK status already read", async () => {
      let statusReads = 0;
      installFetch((url) => {
        if (url === "/api/economy/starter-points/status") {
          statusReads += 1;
          return jsonResponse(200, { data: statusDto("READY_TO_UNLOCK") });
        }
        return jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "boom" } });
      });

      const status = await api.refreshActivationStatus();

      assert.equal(status.activationState, "READY_TO_UNLOCK");
      assert.equal(statusReads, 1);
      assert.equal(calls.filter((c) => c.url === "/api/economy/starter-points/unlock").length, 1);
    });

    await t.test("code review P14: the abort signal reaches the claim and an abort is propagated", async () => {
      const controller = new AbortController();
      installFetch((url, init) => {
        if (url === "/api/economy/starter-points/status") {
          return jsonResponse(200, { data: statusDto("READY_TO_UNLOCK") });
        }
        assert.equal(init.signal, controller.signal);
        controller.abort();
        const abort = new Error("The operation was aborted.");
        abort.name = "AbortError";
        throw abort;
      });

      await assert.rejects(
        api.refreshActivationStatus({ signal: controller.signal }),
        (error) => error.name === "AbortError",
      );
      const claim = calls.find((c) => c.url === "/api/economy/starter-points/unlock");
      assert.equal(claim.init.signal, controller.signal);

      installFetch(() =>
        jsonResponse(200, {
          data: { unlocked: true, amount: 100, journalId: "j-1", activationState: "ACTIVATED" },
        }),
      );
      const signal = new AbortController().signal;
      await api.claimStarterPointsUnlock({ signal });
      assert.equal(
        calls.find((c) => c.url === "/api/economy/starter-points/unlock").init.signal,
        signal,
      );
    });

    await t.test("keeps the backend error code and rejects malformed payloads", async () => {
      installFetch(() =>
        jsonResponse(401, { error: { code: "AUTH_REQUIRED", message: "Authentication required" } }),
      );
      await assert.rejects(api.fetchStarterPointsStatus(), (error) => error.code === "AUTH_REQUIRED");

      installFetch(() => jsonResponse(200, { data: { activationState: "ALMOST" } }));
      await assert.rejects(api.fetchStarterPointsStatus(), /malformed/i);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
