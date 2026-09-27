/** Lowercase without Vietnamese diacritics: "Đà Nẵng" → "da nang". */
export function foldVietnamese(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * Options matching every word of `query`, accents optional ("ha noi" finds
 * "Hà Nội"). An empty query returns `fallback` (the popular options).
 */
export function searchOptions(
  catalog: readonly string[],
  query: string,
  fallback: readonly string[],
  limit = 8,
): string[] {
  const words = foldVietnamese(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...fallback];
  return catalog.filter((option) => {
    const folded = foldVietnamese(option);
    return words.every((word) => folded.includes(word));
  }).slice(0, limit);
}
