import test from "node:test";
import assert from "node:assert/strict";

const { radioGroupKeyTarget } = await import("../components/ui/radio-group-keys.ts");

test("arrows move with wrap-around, Home/End jump", () => {
  assert.equal(radioGroupKeyTarget("ArrowRight", 0, 3), 1);
  assert.equal(radioGroupKeyTarget("ArrowDown", 2, 3), 0);
  assert.equal(radioGroupKeyTarget("ArrowLeft", 0, 3), 2);
  assert.equal(radioGroupKeyTarget("ArrowUp", 1, 3), 0);
  assert.equal(radioGroupKeyTarget("Home", 2, 3), 0);
  assert.equal(radioGroupKeyTarget("End", 0, 3), 2);
});

test("other keys and empty groups are not handled", () => {
  assert.equal(radioGroupKeyTarget("Enter", 0, 3), null);
  assert.equal(radioGroupKeyTarget("Tab", 0, 3), null);
  assert.equal(radioGroupKeyTarget("ArrowRight", 0, 0), null);
});

test("an out-of-range current index starts from the first segment", () => {
  assert.equal(radioGroupKeyTarget("ArrowRight", -1, 3), 1);
  assert.equal(radioGroupKeyTarget("ArrowLeft", 7, 3), 2);
});
