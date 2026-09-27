/**
 * WAI-ARIA radio group keyboard model (unit-tested in
 * `tests/radio-group-keys.test.mjs`): Arrow keys move (and select) with
 * wrap-around, Home/End jump to the ends. Returns the target index, or
 * `null` when the key is not handled.
 */
export function radioGroupKeyTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const from = current >= 0 && current < count ? current : 0;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (from + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (from - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
