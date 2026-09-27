import { createDefaultBlock } from "./form-blocks.schema";
import { formDefinitionSchema } from "./form-definition.schema";
import { draftFormDefinitionSchema } from "./form-draft.schema";

function definitionWith(
  questionCount: number,
  metadata: { expectedEffortSeconds: number; minTimeBarrierSeconds: number },
) {
  return {
    schemaVersion: 1,
    title: "Barrier vs effort",
    blocks: Array.from({ length: questionCount }, (_, i) =>
      createDefaultBlock("text", i, { title: `Question ${i + 1}` }),
    ),
    metadata,
  };
}

describe("formDefinitionSchema: required time barrier vs expected effort (FR-14)", () => {
  it("rejects a definition whose question barrier (questions x 2 s) exceeds expectedEffortSeconds", () => {
    // 40 answerable questions -> 80 s required, but only 60 s declared.
    const result = formDefinitionSchema.safeParse(
      definitionWith(40, { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find(
      (i) => i.path.join(".") === "metadata.expectedEffortSeconds",
    );
    expect(issue?.message).toContain("60");
    expect(issue?.message).toContain("80");
  });

  it("accepts the boundary where the required barrier equals expectedEffortSeconds", () => {
    expect(
      formDefinitionSchema.safeParse(
        definitionWith(30, { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 }),
      ).success,
    ).toBe(true);
  });

  it("reports a publisher minimum above the effort on minTimeBarrierSeconds only", () => {
    const result = formDefinitionSchema.safeParse(
      definitionWith(1, { expectedEffortSeconds: 30, minTimeBarrierSeconds: 45 }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("metadata.minTimeBarrierSeconds");
    expect(paths).not.toContain("metadata.expectedEffortSeconds");
  });
});

describe("form definition sections", () => {
  const metadata = { expectedEffortSeconds: 60, minTimeBarrierSeconds: 15 };

  it("stores sections in draft and published definitions", () => {
    const definition = definitionWith(2, metadata);
    const sections = [
      { id: "section-1", title: "Thông tin chung", blockIds: [definition.blocks[0].id] },
      { id: "section-2", title: "Trải nghiệm", blockIds: [definition.blocks[1].id] },
    ];

    expect(draftFormDefinitionSchema.safeParse({ ...definition, sections }).success).toBe(true);
    expect(formDefinitionSchema.safeParse({ ...definition, sections }).success).toBe(true);
  });

  it("rejects unknown, repeated and unassigned block ids", () => {
    const definition = definitionWith(2, metadata);
    const first = definition.blocks[0].id;
    const invalid = {
      ...definition,
      sections: [
        { id: "section-1", title: "Một", blockIds: [first, "missing"] },
        { id: "section-2", title: "Hai", blockIds: [first] },
      ],
    };
    const result = draftFormDefinitionSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual(
      expect.arrayContaining(["sections.0.blockIds.1", "sections.1.blockIds.0", "sections"]),
    );
  });
});
