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
    assert.match(tooHigh.message, /10 đến 15 phút/);

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
    assert.match(hint.message, /trên 15 phút: 20 đến 40 điểm/);
    assert.equal(durationBandLabel("5–10 min"), "5 đến 10 phút");
  });

  await t.test("follows the backend effective duration when the definition is given (review F5)", () => {
    const blocks = Array.from({ length: 200 }, (_, index) => ({
      id: `b${index}`,
      type: "text",
      title: `Q${index}`,
      order: index,
      required: true,
    }));
    const withoutDefinition = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 5,
      estimatedDurationMinutes: 1,
    });
    assert.equal(withoutDefinition.blocksPublish, false);

    // 200 questions x 2 s = 400 s barrier: effective 7 minutes (10–20 points).
    const barrier = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 5,
      estimatedDurationMinutes: 1,
      definition: {
        blocks,
        metadata: { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 },
      },
    });
    assert.equal(barrier.blocksPublish, true);
    assert.deepEqual([barrier.range.min, barrier.range.max], [10, 20]);

    // A declared effort of 25 minutes picks the "> 15 min" band.
    const effort = describePricingBand({
      type: "EXTERNAL",
      rewardPerResponse: 5,
      estimatedDurationMinutes: 1,
      definition: { metadata: { expectedEffortSeconds: 1500, minTimeBarrierSeconds: 15 } },
    });
    assert.equal(effort.blocksPublish, true);
    assert.equal(effort.range.durationBand, "> 15 min");

    // An External configured minimum above the estimate lengthens it too.
    const externalBarrier = describePricingBand({
      type: "EXTERNAL",
      rewardPerResponse: 10,
      estimatedDurationMinutes: 1,
      definition: { metadata: { expectedEffortSeconds: 360, minTimeBarrierSeconds: 360 } },
    });
    assert.equal(externalBarrier.blocksPublish, false);
    assert.equal(externalBarrier.range.durationBand, "5–10 min");
  });

  await t.test("a frozen reward skips the band minimum but keeps the maximum (review F3)", () => {
    const definition = { metadata: { expectedEffortSeconds: 600 } };
    const firstPublish = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 5,
      estimatedDurationMinutes: 4,
      definition,
    });
    assert.equal(firstPublish.blocksPublish, true);

    const republish = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 5,
      estimatedDurationMinutes: 4,
      definition,
      frozenReward: true,
    });
    assert.equal(republish.blocksPublish, false);

    const aboveMaximum = describePricingBand({
      type: "INTERNAL",
      rewardPerResponse: 500,
      estimatedDurationMinutes: 4,
      definition,
      frozenReward: true,
    });
    assert.equal(aboveMaximum.blocksPublish, true);
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
