import type { FormBlock } from "./form-blocks.schema";
import { deleteBlock, duplicateBlock } from "./form-manipulation";
import { draftFormDefinitionSchema } from "./form-draft.schema";

const singleChoice: FormBlock = {
  id: "q-single",
  order: 0,
  type: "single_choice",
  title: "Pick the colour blue",
  required: true,
  allowOther: false,
  options: [
    { id: "o1", label: "Red", value: "red" },
    { id: "o2", label: "Blue", value: "blue" },
  ],
  integrity: {
    attentionCheck: {
      isAttentionCheck: true,
      expectedValue: "blue",
      failAction: "FLAG",
    },
    semanticCategory: "ATTENTION_CHECK",
  },
};

const multipleChoice: FormBlock = {
  id: "q-multi",
  order: 1,
  type: "multiple_choice",
  title: "Pick A and C",
  required: true,
  allowOther: false,
  options: [
    { id: "m1", label: "A", value: "a" },
    { id: "m2", label: "B", value: "b" },
    { id: "m3", label: "C", value: "c" },
  ],
  integrity: {
    attentionCheck: {
      isAttentionCheck: true,
      expectedValue: ["a", "c"],
      failAction: "DISQUALIFY",
    },
    consistencyPair: { pairedBlockId: "q-single", rule: "EQUIVALENT" },
  },
};

const rating: FormBlock = {
  id: "q-rating",
  order: 2,
  type: "rating",
  title: "Rate us",
  required: false,
  maxRating: 5,
  ratingShape: "STAR",
  integrity: {
    consistencyPair: { pairedBlockId: "q-single", rule: "OPPOSITE" },
  },
};

function draftWith(blocks: FormBlock[]) {
  return draftFormDefinitionSchema.safeParse({ title: "Draft", blocks });
}

describe("duplicateBlock", () => {
  it("remaps a single_choice attention check to the renamed option value", () => {
    const { newBlock, updatedBlocks } = duplicateBlock([singleChoice], 0);
    if (newBlock.type !== "single_choice") throw new Error("wrong type");
    expect(newBlock.options.map((o) => o.value)).toEqual([
      "red_copy_1",
      "blue_copy_2",
    ]);
    expect(newBlock.integrity?.attentionCheck?.expectedValue).toBe(
      "blue_copy_2",
    );
    expect(newBlock.integrity?.semanticCategory).toBe("ATTENTION_CHECK");
    expect(singleChoice.integrity?.attentionCheck?.expectedValue).toBe("blue");
    expect(draftWith(updatedBlocks).success).toBe(true);
  });

  it("remaps a checkbox attention check array and drops the clone's consistencyPair", () => {
    const { newBlock, updatedBlocks } = duplicateBlock(
      [singleChoice, multipleChoice],
      1,
    );
    expect(newBlock.integrity?.attentionCheck).toEqual({
      isAttentionCheck: true,
      expectedValue: ["a_copy_1", "c_copy_3"],
      failAction: "DISQUALIFY",
    });
    expect(newBlock.integrity?.consistencyPair).toBeUndefined();
    expect(updatedBlocks[1].integrity?.consistencyPair?.pairedBlockId).toBe(
      "q-single",
    );
    expect(draftWith(updatedBlocks).success).toBe(true);
  });

  it("drops the consistencyPair of a non-choice clone too", () => {
    const { newBlock } = duplicateBlock([singleChoice, rating], 1);
    expect(newBlock.integrity).toEqual({});
    expect(newBlock.id).not.toBe(rating.id);
  });
});

describe("deleteBlock", () => {
  it("strips consistencyPairs that pointed at the deleted block", () => {
    const result = deleteBlock([singleChoice, multipleChoice, rating], 0);
    expect(result.map((b) => [b.id, b.order])).toEqual([
      ["q-multi", 0],
      ["q-rating", 1],
    ]);
    expect(result[0].integrity).toEqual({
      attentionCheck: multipleChoice.integrity?.attentionCheck,
    });
    expect(result[1].integrity).toEqual({});
    expect(draftWith(result).success).toBe(true);
  });

  it("keeps consistencyPairs that point at a surviving block", () => {
    const result = deleteBlock([singleChoice, multipleChoice, rating], 2);
    expect(result[1].integrity?.consistencyPair?.pairedBlockId).toBe(
      "q-single",
    );
    expect(multipleChoice.integrity?.consistencyPair).toBeDefined();
  });
});
