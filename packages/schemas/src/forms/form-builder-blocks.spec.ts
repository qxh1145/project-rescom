/**
 * Story 2.3: Form Builder Blocks & Factory Specification
 *
 * This spec lives in packages/schemas because `createDefaultBlock`,
 * `formBlockTypeEnum`, `formBlockSchema` and `formDefinitionSchema` are all
 * shared-schema logic — they have zero dependency on backend infrastructure,
 * NestJS modules, or HTTP transport. Tests for shared/frontend logic must not
 * live inside apps/backend.
 *
 * Original location (incorrect boundary):
 *   apps/backend/src/modules/forms/presentation/form-builder-blocks.spec.ts
 * Correct location (this file):
 *   packages/schemas/src/forms/form-builder-blocks.spec.ts
 */
import {
  formBlockTypeEnum,
  formBlockSchema,
  createDefaultBlock,
} from "./form-blocks.schema";
import { formDefinitionSchema } from "./form-definition.schema";
import { draftFormDefinitionSchema } from "./form-draft.schema";
import { validateBlockAnswer } from "./form-preview";
import { MAX_ANSWER_STRING_LENGTH } from "./form-answer.schema";

describe("Story 2.3: Form Builder Blocks & Factory Specification", () => {
  const allBlockTypes = formBlockTypeEnum.options;

  it("should have exactly 9 supported block types in formBlockTypeEnum", () => {
    expect(allBlockTypes).toHaveLength(9);
    expect(allBlockTypes).toEqual([
      "text",
      "textarea",
      "number",
      "single_choice",
      "multiple_choice",
      "rating",
      "linear_scale",
      "date",
      "file_upload",
    ]);
  });

  describe("createDefaultBlock factory for all 9 block types", () => {
    allBlockTypes.forEach((type, index) => {
      it('should create a valid default block for type: "' + type + '" satisfying formBlockSchema', () => {
        const block = createDefaultBlock(type, index);

        expect(block.type).toBe(type);
        expect(block.order).toBe(index);
        expect(block.id).toBeDefined();
        expect(typeof block.id).toBe("string");
        expect(block.title).toBeDefined();
        expect(block.title.length).toBeGreaterThan(0);
        expect(block.required).toBe(false);

        const parsed = formBlockSchema.safeParse(block);
        expect(parsed.success).toBe(true);
      });
    });

    it("should create unique IDs when called multiple times", () => {
      const block1 = createDefaultBlock("text", 0);
      const block2 = createDefaultBlock("text", 1);
      expect(block1.id).not.toBe(block2.id);
    });

    it("should allow overriding title and required in createDefaultBlock", () => {
      const customBlock = createDefaultBlock("rating", 4, {
        title: "How satisfied are you with RESCOM?",
        required: true,
      });

      expect(customBlock.type).toBe("rating");
      expect(customBlock.order).toBe(4);
      expect(customBlock.title).toBe("How satisfied are you with RESCOM?");
      expect(customBlock.required).toBe(true);

      const parsed = formBlockSchema.safeParse(customBlock);
      expect(parsed.success).toBe(true);
    });

    it("should instantiate single_choice with at least 2 distinct options", () => {
      const block = createDefaultBlock("single_choice", 0);
      if (block.type === "single_choice") {
        expect(block.options.length).toBeGreaterThanOrEqual(2);
        const ids = block.options.map(function(o) { return o.id; });
        const values = block.options.map(function(o) { return o.value; });
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(values).size).toBe(values.length);
      }
    });

    it("should instantiate multiple_choice with at least 2 distinct options", () => {
      const block = createDefaultBlock("multiple_choice", 0);
      if (block.type === "multiple_choice") {
        expect(block.options.length).toBeGreaterThanOrEqual(2);
        const ids = block.options.map(function(o) { return o.id; });
        const values = block.options.map(function(o) { return o.value; });
        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(values).size).toBe(values.length);
      }
    });

    it("should instantiate linear_scale with valid range and step divisibility", () => {
      const block = createDefaultBlock("linear_scale", 0);
      if (block.type === "linear_scale") {
        expect(block.min).toBe(1);
        expect(block.max).toBe(5);
        expect(block.step).toBe(1);
        expect((block.max - block.min) % block.step).toBe(0);
      }
    });

    it("should instantiate file_upload with valid MIME types and max size", () => {
      const block = createDefaultBlock("file_upload", 0);
      if (block.type === "file_upload") {
        expect(block.maxFileSizeMb).toBeGreaterThan(0);
        expect(block.maxFiles).toBeGreaterThanOrEqual(1);
        expect(block.allowedMimeTypes.length).toBeGreaterThan(0);
        block.allowedMimeTypes.forEach(function(mime) {
          expect(mime).toMatch(/^[-\w.]+\/[-\w.+]+$/);
        });
      }
    });
  });

  describe("Form Builder Canvas Operations & State Synchronization", () => {
    it("should support inserting a block at any index and re-indexing sequentially", () => {
      const initialBlocks = [
        createDefaultBlock("text", 0),
        createDefaultBlock("number", 1),
      ];

      const insertedBlock = createDefaultBlock("rating", 1);
      const updated = initialBlocks.slice();
      updated.splice(1, 0, insertedBlock);
      const reindexed = updated.map(function(b, idx) { return Object.assign({}, b, { order: idx }); });

      expect(reindexed).toHaveLength(3);
      expect(reindexed[0].type).toBe("text");
      expect(reindexed[0].order).toBe(0);
      expect(reindexed[1].type).toBe("rating");
      expect(reindexed[1].order).toBe(1);
      expect(reindexed[2].type).toBe("number");
      expect(reindexed[2].order).toBe(2);

      reindexed.forEach(function(block) {
        expect(formBlockSchema.safeParse(block).success).toBe(true);
      });
    });

    it("should support deleting a block and maintaining valid sequential order", () => {
      const blocks = [
        createDefaultBlock("text", 0),
        createDefaultBlock("single_choice", 1),
        createDefaultBlock("file_upload", 2),
      ];

      const next = blocks.filter(function(_, idx) { return idx !== 1; });
      const reindexed = next.map(function(b, idx) { return Object.assign({}, b, { order: idx }); });

      expect(reindexed).toHaveLength(2);
      expect(reindexed[0].type).toBe("text");
      expect(reindexed[0].order).toBe(0);
      expect(reindexed[1].type).toBe("file_upload");
      expect(reindexed[1].order).toBe(1);

      reindexed.forEach(function(block) {
        expect(formBlockSchema.safeParse(block).success).toBe(true);
      });
    });

    it("should compose a complete multi-block form with all 9 types and validate against formDefinitionSchema", () => {
      const allNineBlocks = allBlockTypes.map(function(type, idx) {
        return createDefaultBlock(type, idx, {
          title: "Sample question " + (idx + 1) + " (" + type + ")",
        });
      });

      const formPayload = {
        schemaVersion: 1,
        title: "Comprehensive 9-Block Survey",
        description: "Testing all block types on builder canvas",
        blocks: allNineBlocks,
        settings: {
          shuffleBlocks: false,
          progressBar: true,
          requireAuth: false,
          submitButtonText: "Complete Survey",
        },
        metadata: {
          expectedEffortSeconds: 120,
          minTimeBarrierSeconds: 30,
        },
      };

      const parsed = formDefinitionSchema.safeParse(formPayload);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.blocks).toHaveLength(9);
      }
    });
  });
});

describe("File upload blocks reject dangerous MIME types", () => {
  const fileBlock = (allowedMimeTypes: string[]) => ({
    ...createDefaultBlock("file_upload", 0),
    allowedMimeTypes,
  });

  it.each(["text/html", "image/svg+xml", "application/x-msdownload", "Application/JavaScript"])(
    "rejects %s in allowedMimeTypes",
    (mime) => {
      const parsed = formBlockSchema.safeParse(fileBlock(["application/pdf", mime]));
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0].path).toEqual(["allowedMimeTypes", 1]);
        expect(parsed.error.issues[0].message).toMatch(/not permitted for security reasons/);
      }
    },
  );

  it("still accepts safe MIME types", () => {
    expect(
      formBlockSchema.safeParse(fileBlock(["application/pdf", "image/png", "text/csv"])).success,
    ).toBe(true);
  });
});

describe("Text answer length caps", () => {
  it("bounds text and textarea maxLength by MAX_ANSWER_STRING_LENGTH", () => {
    for (const type of ["text", "textarea"] as const) {
      const block = createDefaultBlock(type, 0);
      expect(
        formBlockSchema.safeParse({ ...block, maxLength: MAX_ANSWER_STRING_LENGTH }).success,
      ).toBe(true);
      expect(
        formBlockSchema.safeParse({ ...block, maxLength: MAX_ANSWER_STRING_LENGTH + 1 }).success,
      ).toBe(false);
    }
  });

  it("applies the default cap in validateBlockAnswer when maxLength is unset", () => {
    for (const type of ["text", "textarea"] as const) {
      const block = createDefaultBlock(type, 0);
      expect(validateBlockAnswer(block, "x".repeat(MAX_ANSWER_STRING_LENGTH)).isValid).toBe(true);
      expect(validateBlockAnswer(block, "x".repeat(MAX_ANSWER_STRING_LENGTH + 1))).toEqual({
        isValid: false,
        error: `Maximum length is ${MAX_ANSWER_STRING_LENGTH} characters`,
      });
    }
  });
});

describe("Date blocks use strict calendar parsing", () => {
  const dateBlock = (overrides: Record<string, unknown> = {}) => ({
    ...createDefaultBlock("date", 0),
    ...overrides,
  });

  it("rejects impossible minDate/maxDate values", () => {
    expect(formBlockSchema.safeParse(dateBlock({ minDate: "2026-02-29" })).success).toBe(false);
    expect(formBlockSchema.safeParse(dateBlock({ maxDate: "2026-99-99" })).success).toBe(false);
    expect(formBlockSchema.safeParse(dateBlock({ minDate: "2024-02-29" })).success).toBe(true);
  });

  it("compares minDate and maxDate chronologically", () => {
    expect(
      formBlockSchema.safeParse(dateBlock({ minDate: "2026-05-02", maxDate: "2026-05-01" })).success,
    ).toBe(false);
    expect(
      formBlockSchema.safeParse(
        dateBlock({ minDate: "2026-05-01T12:00Z", maxDate: "2026-05-01" }),
      ).success,
    ).toBe(true);
    expect(
      formBlockSchema.safeParse(
        dateBlock({ minDate: "2026-05-01T10:00+07:00", maxDate: "2026-05-01T04:00Z" }),
      ).success,
    ).toBe(true);
  });

  it("validateBlockAnswer rejects rolled-over and trailing-garbage dates", () => {
    const block = createDefaultBlock("date", 0);
    expect(validateBlockAnswer(block, "2026-02-31").isValid).toBe(false);
    expect(validateBlockAnswer(block, "2026-05-01-2026").isValid).toBe(false);
    expect(validateBlockAnswer(block, "2026-99-99").isValid).toBe(false);
    expect(validateBlockAnswer(block, "2024-02-29").isValid).toBe(true);
  });

  it("validateBlockAnswer applies min/max bounds chronologically", () => {
    const block = createDefaultBlock("date", 0, {
      minDate: "2026-05-01",
      maxDate: "2026-05-31",
    } as never);
    expect(validateBlockAnswer(block, "2026-04-30").isValid).toBe(false);
    expect(validateBlockAnswer(block, "2026-05-01").isValid).toBe(true);
    expect(validateBlockAnswer(block, "2026-05-01T00:00Z").isValid).toBe(true);
    expect(validateBlockAnswer(block, "2026-05-01T06:00+07:00").isValid).toBe(false);
    expect(validateBlockAnswer(block, "2026-05-31").isValid).toBe(true);
    expect(validateBlockAnswer(block, "2026-05-31T23:59:59.999Z").isValid).toBe(true);
    expect(validateBlockAnswer(block, "2026-06-01T00:00Z").isValid).toBe(false);
    expect(validateBlockAnswer(block, "2026-06-01").isValid).toBe(false);
  });

  it("validateBlockAnswer treats a date-time maxDate as exact", () => {
    const block = createDefaultBlock("date", 0, { maxDate: "2026-05-31T12:00Z" } as never);
    expect(validateBlockAnswer(block, "2026-05-31T12:00Z").isValid).toBe(true);
    expect(validateBlockAnswer(block, "2026-05-31T12:01Z").isValid).toBe(false);
  });
});

describe("Attention check validation (published and draft)", () => {
  const choiceBlock = (expectedValue: string) => ({
    ...createDefaultBlock("single_choice", 0),
    integrity: {
      attentionCheck: { isAttentionCheck: true, expectedValue, failAction: "FLAG" },
    },
  });
  const scaleBlock = (expectedValue: number, step = 2) => ({
    ...createDefaultBlock("linear_scale", 0),
    min: 1,
    max: 5,
    step,
    integrity: {
      attentionCheck: { isAttentionCheck: true, expectedValue, failAction: "FLAG" },
    },
  });
  const draft = (block: unknown) =>
    draftFormDefinitionSchema.safeParse({ title: "Draft", blocks: [block] });
  const published = (block: unknown) =>
    formDefinitionSchema.safeParse({ title: "Form", blocks: [block] });
  const expectedValuePath = ["blocks", 0, "integrity", "attentionCheck", "expectedValue"];

  it("draft schema rejects an expectedValue that is not an option", () => {
    const result = draft(choiceBlock("not_an_option"));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(expectedValuePath);
    }
    expect(draft(choiceBlock("opt_1")).success).toBe(true);
  });

  it("rejects a linear_scale expectedValue that is off-step in both schemas", () => {
    for (const parse of [draft, published]) {
      const result = parse(scaleBlock(4));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(expectedValuePath);
        expect(result.error.issues[0].message).toMatch(/step of 2/);
      }
      expect(parse(scaleBlock(3)).success).toBe(true);
      expect(parse(scaleBlock(4, 1)).success).toBe(true);
    }
  });

  it("still rejects an out-of-range linear_scale expectedValue", () => {
    expect(draft(scaleBlock(7)).success).toBe(false);
    expect(published(scaleBlock(7)).success).toBe(false);
  });
});
