import { z } from "zod";
import type { FormBlock } from "./form-blocks.schema";

/**
 * Verifies every attention check's `expectedValue` is an answer the host block
 * can actually accept (a real option value, or an in-range, on-step number).
 * Shared by the published and draft form definition schemas; issues are
 * reported at `blocks.<i>.integrity.attentionCheck.expectedValue`.
 */
export function validateAttentionChecks(
  blocks: FormBlock[],
  ctx: z.RefinementCtx,
): void {
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const attentionCheck = block.integrity?.attentionCheck;
    if (!attentionCheck || !attentionCheck.isAttentionCheck) {
      continue;
    }
    const expected = attentionCheck.expectedValue;
    const addIssue = (message: string) =>
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocks", i, "integrity", "attentionCheck", "expectedValue"],
        message,
      });

    if (block.type === "single_choice") {
      const validValues = new Set(block.options.map((o) => o.value));
      if (typeof expected !== "string" || !validValues.has(expected)) {
        addIssue(
          `Attention check expectedValue "${String(expected)}" does not match any selectable option in block "${block.id}"`,
        );
      }
    } else if (block.type === "multiple_choice") {
      const validValues = new Set(block.options.map((o) => o.value));
      const expectedList = Array.isArray(expected) ? expected : [expected];
      const invalid = expectedList.some(
        (v) => typeof v !== "string" || !validValues.has(v),
      );
      if (invalid) {
        addIssue(
          `Attention check expectedValue contains values not present in block "${block.id}" options`,
        );
      }
    } else if (block.type === "rating") {
      if (
        typeof expected !== "number" ||
        !Number.isInteger(expected) ||
        expected < 1 ||
        expected > block.maxRating
      ) {
        addIssue(
          `Attention check expectedValue must be an integer between 1 and ${block.maxRating} for rating block "${block.id}"`,
        );
      }
    } else if (block.type === "linear_scale") {
      const step = block.step ?? 1;
      if (
        typeof expected !== "number" ||
        expected < block.min ||
        expected > block.max
      ) {
        addIssue(
          `Attention check expectedValue must be within range [${block.min}, ${block.max}] for linear scale block "${block.id}"`,
        );
      } else if ((expected - block.min) % step !== 0) {
        addIssue(
          `Attention check expectedValue must land on a step of ${step} from ${block.min} for linear scale block "${block.id}"`,
        );
      }
    }
  }
}
