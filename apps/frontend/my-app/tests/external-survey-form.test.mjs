import test from "node:test";
import assert from "node:assert/strict";

test("Epic 4 review: external survey stepper helpers", async (t) => {
  const {
    validateExternalSurveyUrl,
    effortMinutesToSeconds,
    EXTERNAL_EFFORT_MAX_MINUTES,
  } = await import("../app/forms/components/external-survey-form.ts");
  const { calculateEscrowCost } = await import("@rescom/schemas");

  await t.test("P19: accepts Google Forms links and flags them for the badge", () => {
    for (const url of [
      "https://docs.google.com/forms/d/e/1FAIpQLSc/viewform",
      "https://forms.gle/abc123",
      "  https://forms.google.com/some-form  ",
    ]) {
      const result = validateExternalSurveyUrl(url);
      assert.equal(result.valid, true, url);
      assert.equal(result.isGoogleForm, true, url);
      assert.equal(result.error, null);
    }
  });

  await t.test("P19/E4-DN3: other docs.google.com paths are rejected (not Google Forms)", () => {
    for (const url of [
      "https://docs.google.com/document/d/xyz/edit",
      "https://docs.google.com/forms",
      "https://forms.gle/",
    ]) {
      const result = validateExternalSurveyUrl(url);
      assert.equal(result.valid, false, url);
      assert.equal(result.isGoogleForm, false);
      assert.match(result.error, /chỉ chấp nhận liên kết Google Forms/, url);
    }
  });

  await t.test("E4-DN3: other HTTPS hosts are rejected by the Phase 1 allowlist", () => {
    for (const url of ["https://www.surveymonkey.com/r/abc", "https://example.com/survey"]) {
      const result = validateExternalSurveyUrl(url);
      assert.equal(result.valid, false, url);
      assert.equal(result.url, null);
      assert.match(result.error, /Google Forms/, url);
    }
  });

  await t.test("P6/P19: rejects empty, non-HTTPS, script and over-long URLs", () => {
    const empty = validateExternalSurveyUrl("   ");
    assert.equal(empty.valid, false);
    assert.match(empty.error, /nhập liên kết/);

    const http = validateExternalSurveyUrl("http://docs.google.com/forms/d/xyz");
    assert.equal(http.valid, false);
    assert.match(http.error, /HTTPS/);

    for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>"]) {
      const result = validateExternalSurveyUrl(url);
      assert.equal(result.valid, false, url);
      assert.equal(result.isGoogleForm, false);
    }

    const garbage = validateExternalSurveyUrl("not a url");
    assert.equal(garbage.valid, false);
    assert.match(garbage.error, /không hợp lệ/);

    const long = validateExternalSurveyUrl(`https://forms.gle/${"a".repeat(2000)}`);
    assert.equal(long.valid, false);
    assert.match(long.error, /2000/);

    assert.equal(validateExternalSurveyUrl("HTTPS://forms.gle/abc").valid, true);
  });

  await t.test("P9: converts whole minutes into expectedEffortSeconds within bounds", () => {
    assert.deepEqual(effortMinutesToSeconds(1), { valid: true, seconds: 60, error: null });
    assert.deepEqual(effortMinutesToSeconds(30), { valid: true, seconds: 1800, error: null });
    assert.equal(effortMinutesToSeconds(EXTERNAL_EFFORT_MAX_MINUTES).seconds, 86400);
    for (const bad of [0, -5, 1.5, Number.NaN, EXTERNAL_EFFORT_MAX_MINUTES + 1]) {
      const result = effortMinutesToSeconds(bad);
      assert.equal(result.valid, false, String(bad));
      assert.equal(result.seconds, null);
    }
  });

  await t.test("P10: External Escrow summary has no discount and reserves reward × quota", () => {
    const escrow = calculateEscrowCost({
      type: "EXTERNAL",
      expectedCompletions: 50,
      rewardPerResponse: 12,
    });
    assert.equal(escrow.effectiveRewardPerResponse, 12);
    assert.equal(escrow.discountPercent, 0);
    assert.equal(escrow.discountAmount, 0);
    assert.equal(escrow.effectiveCost, 600);
  });
});

test("Epic 4 review P20: clipboard copy reports real success only", async (t) => {
  const { copyTextToClipboard } = await import("../lib/clipboard.ts");

  await t.test("returns false when the Clipboard API is unavailable", async () => {
    assert.equal(await copyTextToClipboard("123456", undefined), false);
    assert.equal(await copyTextToClipboard("123456", {}), false);
  });

  await t.test("returns false when the write is rejected", async () => {
    const clipboard = {
      writeText: async () => {
        throw new Error("NotAllowedError");
      },
    };
    assert.equal(await copyTextToClipboard("123456", clipboard), false);
  });

  await t.test("returns true and writes the text on success", async () => {
    const written = [];
    const clipboard = {
      writeText: async (text) => {
        written.push(text);
      },
    };
    assert.equal(await copyTextToClipboard("654321", clipboard), true);
    assert.deepEqual(written, ["654321"]);
  });
});
