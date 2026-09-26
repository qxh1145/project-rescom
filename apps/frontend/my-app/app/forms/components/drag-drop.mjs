/**
 * Converts a drop-zone insertion index (0..blockCount) into the destination
 * index expected after the dragged item has been removed from the list.
 */
export function resolveReorderDestination(blockCount, fromIndex, insertionIndex) {
  if (
    blockCount <= 0 ||
    fromIndex < 0 ||
    fromIndex >= blockCount ||
    insertionIndex < 0 ||
    insertionIndex > blockCount
  ) {
    return fromIndex;
  }
  const adjusted = fromIndex < insertionIndex ? insertionIndex - 1 : insertionIndex;
  return Math.max(0, Math.min(blockCount - 1, adjusted));
}

export function resolveCanvasDrop(
  blockCount,
  insertionIndex,
  reorderFromValue,
  blockTypeValue,
) {
  if (reorderFromValue !== "") {
    const fromIndex = Number.parseInt(reorderFromValue, 10);
    if (!Number.isNaN(fromIndex)) {
      return {
        kind: "reorder",
        fromIndex,
        toIndex: resolveReorderDestination(blockCount, fromIndex, insertionIndex),
      };
    }
  }
  if (blockTypeValue) {
    return { kind: "insert", blockType: blockTypeValue, index: insertionIndex };
  }
  return { kind: "none" };
}
