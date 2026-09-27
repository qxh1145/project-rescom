import test from "node:test";
import assert from "node:assert/strict";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    clone() {
      return jsonResponse(status, body);
    },
  };
}

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE = {
  id: "22222222-2222-4222-8222-222222222222",
  userId: USER_ID,
  age: 21,
  gender: "FEMALE",
  location: "Đà Nẵng",
  occupation: "Sinh viên đại học",
  fieldOfStudy: "Công nghệ thông tin",
  householdIncome: "Dưới 5 triệu VNĐ/tháng",
  specificInterests: ["Trí tuệ nhân tạo (AI)"],
  createdAt: "2026-09-26T10:00:00.000Z",
  updatedAt: "2026-09-26T10:00:00.000Z",
};

test("Story 7.1: demographics service (VERIFIED /demographics routes)", async (t) => {
  const api = await import("../lib/demographics/demographics-service.ts");
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
    await t.test("reads the profile status", async () => {
      installFetch(() =>
        jsonResponse(200, {
          data: { profile: PROFILE, isComplete: true, missingFields: [] },
        }),
      );

      const status = await api.getDemographics();

      assert.equal(status.isComplete, true);
      assert.equal(calls[0].url, "/api/demographics");
    });

    await t.test("submits the mandatory survey with CSRF and returns the next step", async () => {
      installFetch(() =>
        jsonResponse(200, {
          data: {
            profile: PROFILE,
            isComplete: true,
            missingFields: [],
            nextStep: "MARKETPLACE_ACTIVATION",
          },
        }),
      );
      const input = {
        age: 21,
        gender: "FEMALE",
        location: "Đà Nẵng",
        occupation: "Sinh viên đại học",
        fieldOfStudy: "Công nghệ thông tin",
        householdIncome: "Dưới 5 triệu VNĐ/tháng",
        specificInterests: ["Trí tuệ nhân tạo (AI)"],
      };

      const result = await api.submitDemographicSurvey(input);

      assert.equal(result.nextStep, "MARKETPLACE_ACTIVATION");
      const call = calls.find((c) => c.url === "/api/demographics/survey");
      assert.equal(call.init.method, "POST");
      assert.equal(call.init.body, JSON.stringify(input));
      const headers = new Headers(call.init.headers);
      assert.equal(headers.get("X-CSRF-Token"), "csrf-token");
      assert.equal(headers.get("Content-Type"), "application/json");
    });

    await t.test("updates the profile with PUT", async () => {
      installFetch(() =>
        jsonResponse(200, {
          data: {
            profile: { ...PROFILE, householdIncome: null },
            isComplete: false,
            missingFields: ["householdIncome"],
          },
        }),
      );

      const status = await api.updateDemographics({ householdIncome: null });

      assert.deepEqual(status.missingFields, ["householdIncome"]);
      const call = calls.find((c) => c.url === "/api/demographics");
      assert.equal(call.init.method, "PUT");
    });

    await t.test("surfaces backend error codes and details", async () => {
      installFetch(() =>
        jsonResponse(400, {
          data: null,
          error: {
            code: "VALIDATION_ERROR",
            message: "Select at least one interest",
            details: { specificInterests: { _errors: ["Select at least one interest"] } },
          },
        }),
      );

      await assert.rejects(
        () => api.submitDemographicSurvey({}),
        (error) => {
          assert.equal(error.kind, "http");
          assert.equal(error.status, 400);
          assert.equal(error.code, "VALIDATION_ERROR");
          assert.equal(error.message, "Select at least one interest");
          assert.ok(error.details);
          return true;
        },
      );
    });

    await t.test("rejects malformed success payloads", async () => {
      installFetch(() =>
        jsonResponse(200, { data: { profile: PROFILE, isComplete: "yes" } }),
      );
      await assert.rejects(() => api.getDemographics(), /malformed/i);
    });

    await t.test("maps 401 to an authentication error code", async () => {
      installFetch(() => jsonResponse(401, { error: { code: "AUTH_UNAUTHORIZED", message: "Unauthorized" } }));
      await assert.rejects(
        () => api.getDemographics(),
        (error) => error.code === "AUTH_UNAUTHORIZED",
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
