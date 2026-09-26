import test from "node:test";
import assert from "node:assert/strict";

test("Decision E6-D2: FR-14 pricing band hints for the builder and the External wizard", async (t) => {
  const { describePricingBand, pricingPublishErrorMessage, durationBandLabel } =
    await import("../app/forms/pricing-band.ts");

  await t.test("free Internal surveys are exempt and never block publishing", () => {
    const hint = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 0,
      estimatedDurationMinutes: null,
    });
    assert.equal(hint.blocksPublish, false);
    assert.equal(hint.tone, "info");
    assert.equal(hint.range, null);
  });

  await t.test("a rewarded survey without a duration blocks publishing", () => {
    for (const type of ["INTERNAL", "EXTERNAL"]) {
      const hint = describePricingBand({
        type,
        rewardPerResponse: 10,
        estimatedDurationMinutes: null,
      });
      assert.equal(hint.blocksPublish, true, type);
      assert.equal(hint.tone, "warning");
      assert.match(hint.message, /thời gian hoàn thành dự kiến/);
    }
  });

  await t.test("rewards above the band maximum or below the minimum block publishing with the band", () => {
    const tooHigh = describePricingBand({
      type: "EXTERNAL",
      rewardPerResponse: 26,
      estimatedDurationMinutes: 12,
    });
    assert.equal(tooHigh.blocksPublish, true);
    assert.equal(tooHigh.tone, "error");
    assert.deepEqual(
      [tooHigh.range.min, tooHigh.range.max, tooHigh.range.suggested],
      [15, 25, 15],
    );
    assert.match(tooHigh.message, /từ 15 đến 25 điểm/);
    assert.match(tooHigh.message, /10–15 phút/);

    const tooLow = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 4,
      estimatedDurationMinutes: 3,
    });
    assert.equal(tooLow.blocksPublish, true);
    assert.match(tooLow.message, /dưới 5 phút/);
  });

  await t.test("an in-band reward shows the band without blocking", () => {
    const hint = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 40,
      estimatedDurationMinutes: 30,
    });
    assert.equal(hint.blocksPublish, false);
    assert.equal(hint.tone, "info");
    assert.match(hint.message, /trên 15 phút: 20–40 điểm/);
    assert.equal(durationBandLabel("5–10 min"), "5–10 phút");
  });

  await t.test("maps the backend publish errors to Vietnamese copy", () => {
    assert.match(
      pricingPublishErrorMessage("PRICING_REWARD_OUT_OF_BAND", {
        min: 20,
        max: 40,
        suggested: 20,
      }),
      /từ 20 đến 40 điểm \(gợi ý: 20\)/,
    );
    assert.match(
      pricingPublishErrorMessage("PRICING_REWARD_OUT_OF_BAND", undefined),
      /ngoài khung giá/,
    );
    assert.match(
      pricingPublishErrorMessage("ESTIMATED_DURATION_REQUIRED", undefined),
      /thời gian hoàn thành dự kiến/,
    );
    assert.equal(pricingPublishErrorMessage("FORM_VALIDATION_ERROR", []), null);
  });
});
