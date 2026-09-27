/**
 * Unicode text helpers shared by the backend and the frontend mock.
 *
 * JavaScript strings are UTF-16. A "lone" surrogate (a high surrogate not
 * followed by a low one, or a low surrogate not preceded by a high one) is not
 * valid Unicode: PostgreSQL and the Prisma engine reject such a string, so it
 * must never reach persistence (Epic 9 review P8/P9).
 */
function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

/**
 * Rebuilds `value` with every lone surrogate replaced by `replacement`.
 * Implemented as a loop (no regex lookbehind) so every consumer's compile
 * target accepts it.
 */
function mapLoneSurrogates(value: string, replacement: string): string {
  let result = '';
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (isHighSurrogate(codeUnit)) {
      if (
        index + 1 < value.length &&
        isLowSurrogate(value.charCodeAt(index + 1))
      ) {
        result += value[index] + value[index + 1];
        index += 1;
        continue;
      }
      result += replacement;
      changed = true;
      continue;
    }
    if (isLowSurrogate(codeUnit)) {
      result += replacement;
      changed = true;
      continue;
    }
    result += value[index];
  }
  return changed ? result : value;
}

/** Removes every lone surrogate; valid surrogate pairs (emoji) are kept. */
export function removeLoneSurrogates(value: string): string {
  return mapLoneSurrogates(value, '');
}

/** Replaces every lone surrogate with U+FFFD (the replacement character). */
export function replaceLoneSurrogates(value: string): string {
  return mapLoneSurrogates(value, '\uFFFD');
}

/**
 * Truncates `text` to at most `maxLength` UTF-16 code units (what
 * `String.length` and Zod's `.max()` count), ending with `ellipsis` when
 * shortened. The cut never splits a surrogate pair, so an emoji at the
 * boundary is dropped whole instead of leaving a lone surrogate that the
 * database would reject (Epic 9 review P9).
 */
export function truncateText(
  text: string,
  maxLength: number,
  ellipsis = '...',
): string {
  if (text.length <= maxLength) {
    return text;
  }
  let end = Math.max(0, maxLength - ellipsis.length);
  if (
    end > 0 &&
    isHighSurrogate(text.charCodeAt(end - 1)) &&
    isLowSurrogate(text.charCodeAt(end))
  ) {
    end -= 1;
  }
  return `${text.slice(0, end)}${ellipsis}`;
}
