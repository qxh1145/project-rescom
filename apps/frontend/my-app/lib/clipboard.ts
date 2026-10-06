export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

function defaultClipboard(): ClipboardWriter | undefined {
  if (typeof navigator === "undefined") return undefined;
  return navigator.clipboard ?? undefined;
}

/**
 * Copies `text` and reports whether the write really succeeded.
 *
 * `navigator.clipboard` is undefined outside secure contexts (plain HTTP,
 * some embedded browsers) and `writeText` can reject (permission denied), so
 * callers must only show "Copied" when this resolves to `true`. That matters
 * for one-time completion codes, which are never shown again.
 */
export async function copyTextToClipboard(
  text: string,
  clipboard: ClipboardWriter | undefined = defaultClipboard(),
): Promise<boolean> {
  if (!clipboard || typeof clipboard.writeText !== "function") return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export const CLIPBOARD_COPY_FAILED_MESSAGE =
  "Không thể sao chép tự động: vui lòng chọn và sao chép mã thủ công.";
