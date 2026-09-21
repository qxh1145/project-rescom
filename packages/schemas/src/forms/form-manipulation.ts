import { FormBlock } from "./form-blocks.schema";

export function generateBlockId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `blk-${crypto.randomUUID()}`;
  }
  return `blk-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 9)}`;
}

export function generateOptionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `opt-${crypto.randomUUID().substring(0, 8)}`;
  }
  return `opt-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Re-indexes an array of blocks so each block's order attribute strictly matches its array index.
 */
export function reindexBlocks(blocks: FormBlock[]): FormBlock[] {
  return blocks.map((b, idx) => ({
    ...b,
    order: idx,
  })) as FormBlock[];
}

/**
 * Reorders a block from one index to another, returning a new sequentially reindexed array.
 */
export function reorderBlocks(
  blocks: FormBlock[],
  fromIndex: number,
  toIndex: number,
): FormBlock[] {
  if (
    fromIndex < 0 ||
    fromIndex >= blocks.length ||
    toIndex < 0 ||
    toIndex >= blocks.length ||
    fromIndex === toIndex
  ) {
    return [...blocks];
  }
  const result = [...blocks];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return reindexBlocks(result);
}

/**
 * Moves a block up one position (towards 0), or returns unchanged array if already at top.
 */
export function moveBlockUp(blocks: FormBlock[], index: number): FormBlock[] {
  if (index <= 0 || index >= blocks.length) {
    return [...blocks];
  }
  return reorderBlocks(blocks, index, index - 1);
}

/**
 * Moves a block down one position (towards end), or returns unchanged array if already at bottom.
 */
export function moveBlockDown(blocks: FormBlock[], index: number): FormBlock[] {
  if (index < 0 || index >= blocks.length - 1) {
    return [...blocks];
  }
  return reorderBlocks(blocks, index, index + 1);
}

/**
 * Duplicates a block at the given index:
 * - Generates a new unique block ID.
 * - For choice blocks, generates new unique option IDs and non-colliding values.
 * - Inserts the clone immediately after the target block.
 * - Reindexes the entire array.
 * - Returns the updated array and the index of the newly created block.
 */
export function duplicateBlock(
  blocks: FormBlock[],
  index: number,
): { updatedBlocks: FormBlock[]; newBlockIndex: number; newBlock: FormBlock } {
  if (index < 0 || index >= blocks.length) {
    throw new Error(`Invalid block index for duplication: ${index}`);
  }
  const original = blocks[index];
  const newId = generateBlockId();

  // Deep clone block
  const clone: FormBlock = JSON.parse(JSON.stringify(original));
  clone.id = newId;
  clone.title = `${original.title.slice(0, 493)} (Copy)`;

  // If choice block, generate fresh unique option IDs and values
  if (clone.type === "single_choice" || clone.type === "multiple_choice") {
    clone.options = clone.options.map((opt, optIdx) => ({
      ...opt,
      id: generateOptionId(),
      value: `${opt.value.slice(0, 286)}_copy_${optIdx + 1}`,
    }));
  }

  const result = [...blocks];
  result.splice(index + 1, 0, clone);
  const reindexed = reindexBlocks(result);
  const newBlockIndex = index + 1;

  return {
    updatedBlocks: reindexed,
    newBlockIndex,
    newBlock: reindexed[newBlockIndex],
  };
}

/**
 * Deletes a block at the given index and returns a newly reindexed array.
 */
export function deleteBlock(blocks: FormBlock[], index: number): FormBlock[] {
  if (index < 0 || index >= blocks.length) {
    return [...blocks];
  }
  const result = blocks.filter((_, idx) => idx !== index);
  return reindexBlocks(result);
}

/**
 * Updates a block at a given index, preserving sequential order.
 */
export function updateBlockInList(
  blocks: FormBlock[],
  index: number,
  updated: FormBlock,
): FormBlock[] {
  if (index < 0 || index >= blocks.length) {
    return [...blocks];
  }
  const result = [...blocks];
  result[index] = {
    ...updated,
    order: index,
  };
  return result;
}
