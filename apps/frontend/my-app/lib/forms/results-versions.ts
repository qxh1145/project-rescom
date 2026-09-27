import { formatDayMonth, formatShortDateTime } from "../format/date-time.ts";
import type { FormVersionSummary, VersionBlock } from "./results-service.ts";

/**
 * Pure logic of "Lịch sử phiên bản" (Figma 17a, 63:5939): version states and
 * the "Thay đổi so với v1" list, computed by diffing the blocks of two versions.
 */

export type VersionChangeKind = "ADDED" | "CHANGED" | "REMOVED";

export interface VersionChange {
  kind: VersionChangeKind;
  /** Question number in the version it belongs to (new one for ADDED/CHANGED, old one for REMOVED). */
  questionNumber: number;
  /** Text after the verb: 'câu 9: "…"', 'câu 3: thêm lựa chọn "…"'. */
  detail: string;
}

const byOrder = (blocks: readonly VersionBlock[]) =>
  [...blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

const quoted = (labels: string[]) => labels.map((label) => `"${label}"`).join(", ");

function blockChanges(previous: VersionBlock, next: VersionBlock, previousNumber: number, moved: boolean): string[] {
  const parts: string[] = [];
  if (previous.type !== next.type) parts.push("đổi loại câu hỏi");
  if (previous.title.trim() !== next.title.trim()) parts.push("sửa nội dung câu hỏi");
  const before = (previous.options ?? []).map((option) => option.label);
  const after = (next.options ?? []).map((option) => option.label);
  const added = after.filter((label) => !before.includes(label));
  const removed = before.filter((label) => !after.includes(label));
  if (added.length) parts.push(`thêm lựa chọn ${quoted(added)}`);
  if (removed.length) parts.push(`bỏ lựa chọn ${quoted(removed)}`);
  if (previous.required && !next.required) parts.push("chuyển thành không bắt buộc");
  if (!previous.required && next.required) parts.push("chuyển thành bắt buộc");
  if (moved) parts.push(`chuyển từ vị trí câu ${previousNumber}`);
  return parts;
}

/** Added first, then changed, then removed — each group by question number. */
export function diffVersions(previousBlocks: readonly VersionBlock[], nextBlocks: readonly VersionBlock[]): VersionChange[] {
  const previous = byOrder(previousBlocks);
  const next = byOrder(nextBlocks);
  const previousIndex = new Map(previous.map((block, index) => [block.id, index]));
  const nextIds = new Set(next.map((block) => block.id));
  // Moves = order changes among the questions both versions keep (not shifts caused by an add/remove).
  const keptBefore = previous.filter((block) => nextIds.has(block.id)).map((block) => block.id);
  const keptAfter = next.filter((block) => previousIndex.has(block.id)).map((block) => block.id);

  const added: VersionChange[] = [];
  const changed: VersionChange[] = [];
  next.forEach((block, index) => {
    const number = index + 1;
    const oldIndex = previousIndex.get(block.id);
    if (oldIndex === undefined) {
      added.push({ kind: "ADDED", questionNumber: number, detail: `câu ${number}: "${block.title.trim()}"` });
      return;
    }
    const moved = keptBefore.indexOf(block.id) !== keptAfter.indexOf(block.id);
    const parts = blockChanges(previous[oldIndex], block, oldIndex + 1, moved);
    if (parts.length) changed.push({ kind: "CHANGED", questionNumber: number, detail: `câu ${number}: ${parts.join("; ")}` });
  });
  const removed: VersionChange[] = previous.flatMap((block, index) =>
    nextIds.has(block.id)
      ? []
      : [{ kind: "REMOVED" as const, questionNumber: index + 1, detail: `câu ${index + 1}: "${block.title.trim()}"` }],
  );
  return [...added, ...changed, ...removed];
}

export function changeVerb(kind: VersionChangeKind): string {
  return kind === "ADDED" ? "Thêm" : kind === "CHANGED" ? "Sửa" : "Xoá";
}

/** Newest first (the API answers ascending). */
export function sortVersionsDesc(versions: readonly FormVersionSummary[]): FormVersionSummary[] {
  return [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
}

/** Draft being edited = newest unpublished version above a published one. */
export function draftAndBase(versions: readonly FormVersionSummary[]): {
  draft: FormVersionSummary | null;
  base: FormVersionSummary | null;
} {
  const sorted = sortVersionsDesc(versions);
  const draft = sorted[0] && !sorted[0].isPublished ? sorted[0] : null;
  const base = draft ? (sorted.find((version) => version.isPublished && version.versionNumber < draft.versionNumber) ?? null) : null;
  return { draft, base };
}

/** "Sửa lần cuối 26/09 21:30 · chưa gửi duyệt" */
export function draftCaption(version: FormVersionSummary): string {
  const edited = version.updatedAt ?? version.createdAt;
  const review = version.submittedForReviewAt
    ? `đã gửi duyệt ${formatDayMonth(version.submittedForReviewAt)}`
    : "chưa gửi duyệt";
  return `Sửa lần cuối ${formatShortDateTime(edited)} · ${review}`;
}

/** "Xuất bản 15/09 · thu thập 15/09–22/09" */
export function publishedCaption(version: FormVersionSummary): string {
  const published = version.publishedAt ? `Xuất bản ${formatDayMonth(version.publishedAt)}` : "Đã xuất bản";
  if (!version.collectedFrom) return published;
  const until = version.collectedUntil ? formatDayMonth(version.collectedUntil) : "nay";
  return `${published} · thu thập ${formatDayMonth(version.collectedFrom)}–${until}`;
}

export function qualityStatusLabel(status: FormVersionSummary["qualityStatus"]): string {
  return status === "ENOUGH_DATA" ? "Đủ dữ liệu" : "Chưa đủ dữ liệu";
}
