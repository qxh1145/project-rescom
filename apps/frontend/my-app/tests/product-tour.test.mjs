import test from "node:test";
import assert from "node:assert/strict";

const { TOURS, tourById, CONTEXT_INVITES } = await import("../lib/product-tour/tour-definitions.ts");
const {
  resolveStepForPath,
  tourHubView,
  completedCount,
  shouldShowWelcome,
  isTourLocked,
  resumableTour,
  placeCoachmark,
  spotlightRect,
} = await import("../lib/product-tour/tour-logic.ts");

const row = (tourId, status, step = 0) => ({ tourId, status, step, updatedAt: "2026-09-27T10:00:00.000Z" });

test("tours: four desktop tours, short, each ending on a final step", () => {
  assert.deepEqual(TOURS.map((tour) => tour.id), ["FIRST_SURVEY", "FIRST_PUBLISH", "FORM_BUILDER", "TRACK_SURVEY"]);
  for (const tour of TOURS) {
    assert.ok(tour.steps.length >= 3 && tour.steps.length <= 6, tour.id);
    assert.equal(tour.steps.at(-1).kind, "final", tour.id);
    for (const step of tour.steps.slice(0, -1)) assert.notEqual(step.kind, "final", `${tour.id}: ${step.target}`);
    for (const step of tour.steps) {
      if (step.kind === "action") assert.ok(step.hint, `${tour.id}: action step needs a hint`);
    }
  }
});

test("tours: the AI builder button is never a target (Phase 1)", () => {
  const targets = TOURS.flatMap((tour) => tour.steps.map((step) => step.target));
  assert.ok(!targets.some((target) => target.includes("ai")));
});

test("routes: steps match the real app paths", () => {
  const survey = tourById("FIRST_SURVEY");
  assert.ok(survey.steps[0].route.test("/marketplace"));
  assert.ok(survey.steps[3].route.test("/attempts/abc/google-form"));
  assert.ok(!survey.steps[3].route.test("/attempts/abc"));
  const track = tourById("TRACK_SURVEY");
  assert.ok(track.steps[0].route.test("/forms/123"));
  assert.ok(!track.steps[0].route.test("/forms/new"), "the create page is not a progress page");
  assert.ok(!track.steps[0].route.test("/forms/123/builder"));
  const invite = CONTEXT_INVITES.find((item) => item.tourId === "FORM_BUILDER");
  assert.ok(invite.route.test("/forms/123/builder"));
  assert.ok(!invite.route.test("/forms/123/builder/preview"));
});

test("resolveStepForPath: stays, jumps ahead, never back", () => {
  const survey = tourById("FIRST_SURVEY");
  assert.equal(resolveStepForPath(survey, 1, "/marketplace"), 1);
  // Started the Google Forms survey: first step on that screen.
  assert.equal(resolveStepForPath(survey, 3, "/attempts/a1/google-form"), 3);
  // Took an internal survey and went to the wallet: skip the Google Forms steps.
  assert.equal(resolveStepForPath(survey, 3, "/wallet"), 5);
  // Back on Khám phá with the tour further along: keep waiting at step 5.
  assert.equal(resolveStepForPath(survey, 5, "/marketplace"), 5);
  // Consent page in between: no step there, wait.
  assert.equal(resolveStepForPath(survey, 3, "/surveys/s1/start"), 3);
  // Builder invite starting the builder tour from its first step on the builder screen.
  assert.equal(resolveStepForPath(tourById("FORM_BUILDER"), 0, "/forms/f1/builder"), 1);
});

test("hub view: done, doing, todo, dismissed at the start reads as todo", () => {
  const progress = [row("FIRST_SURVEY", "COMPLETED", 5), row("FIRST_PUBLISH", "IN_PROGRESS", 2), row("FORM_BUILDER", "DISMISSED", 0)];
  assert.deepEqual(tourHubView(progress, "FIRST_SURVEY"), { state: "done", step: 0 });
  assert.deepEqual(tourHubView(progress, "FIRST_PUBLISH"), { state: "doing", step: 2 });
  assert.deepEqual(tourHubView(progress, "FORM_BUILDER"), { state: "todo", step: 0 });
  assert.deepEqual(tourHubView(progress, "TRACK_SURVEY"), { state: "todo", step: 0 });
  assert.deepEqual(tourHubView([row("TRACK_SURVEY", "DISMISSED", 1)], "TRACK_SURVEY"), { state: "doing", step: 1 });
  assert.equal(completedCount(progress), 1);
  assert.equal(resumableTour(progress).tourId, "FIRST_PUBLISH");
});

test("welcome and locks", () => {
  assert.equal(shouldShowWelcome([], "/marketplace"), true);
  assert.equal(shouldShowWelcome([], "/wallet"), false);
  assert.equal(shouldShowWelcome([row("FIRST_SURVEY", "DISMISSED")], "/marketplace"), false);
  assert.equal(isTourLocked("FIRST_PUBLISH", 0), true);
  assert.equal(isTourLocked("FIRST_PUBLISH", null), true);
  assert.equal(isTourLocked("FIRST_PUBLISH", 112), false);
  assert.equal(isTourLocked("FORM_BUILDER", 0), false);
});

const viewport = { width: 1440, height: 900 };
const card = { width: 360, height: 220 };

test("placeCoachmark: preferred side when it fits, arrow at the target centre", () => {
  const target = { x: 340, y: 105, width: 1052, height: 150 };
  const position = placeCoachmark(target, card, viewport, "bottom");
  assert.equal(position.placement, "bottom");
  assert.equal(position.y, 105 + 150 + 8 + 18);
  assert.ok(position.x >= 16 && position.x + card.width <= viewport.width - 16);
  assert.ok(position.arrowOffset >= 28 && position.arrowOffset <= card.width - 28);
});

test("placeCoachmark: falls back when the preferred side has no room", () => {
  // Target hugging the right edge: "right" cannot fit, bottom can.
  const target = { x: 1100, y: 140, width: 300, height: 44 };
  assert.equal(placeCoachmark(target, card, viewport, "right").placement, "bottom");
  // Target at the bottom: bottom cannot fit, right can.
  const low = { x: 100, y: 780, width: 200, height: 60 };
  assert.equal(placeCoachmark(low, card, viewport, "bottom").placement, "right");
});

test("placeCoachmark: floats bottom-right without arrow when nothing fits", () => {
  const huge = { x: 0, y: 0, width: 1440, height: 900 };
  const position = placeCoachmark(huge, card, viewport, "left");
  assert.equal(position.placement, "floating");
  assert.equal(position.arrowOffset, null);
  assert.ok(position.x + card.width <= viewport.width);
});

test("spotlightRect: 8px around the target", () => {
  assert.deepEqual(spotlightRect({ x: 10, y: 20, width: 100, height: 40 }), { x: 2, y: 12, width: 116, height: 56 });
});
