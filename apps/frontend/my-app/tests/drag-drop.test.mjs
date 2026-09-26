import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCanvasDrop,
  resolveReorderDestination,
} from "../app/forms/components/drag-drop.mjs";

test("moves a block downward without an off-by-one error", () => {
  assert.equal(resolveReorderDestination(4, 0, 3), 2);
});

test("allows dropping a block into the final drop zone", () => {
  assert.equal(resolveReorderDestination(4, 0, 4), 3);
});

test("preserves an upward insertion index", () => {
  assert.equal(resolveReorderDestination(4, 3, 1), 1);
});

test("ignores invalid drag indices", () => {
  assert.equal(resolveReorderDestination(4, -1, 2), -1);
  assert.equal(resolveReorderDestination(4, 1, 5), 1);
});

test("routes a toolbox drop to insertion at the selected drop zone", () => {
  assert.deepEqual(resolveCanvasDrop(3, 1, "", "rating"), {
    kind: "insert",
    blockType: "rating",
    index: 1,
  });
});

test("routes a reorder drop through destination normalization", () => {
  assert.deepEqual(resolveCanvasDrop(4, 4, "0", ""), {
    kind: "reorder",
    fromIndex: 0,
    toIndex: 3,
  });
});
