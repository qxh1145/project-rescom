import {
  createDefaultBlock,
  generateBlockId,
  type FormBlock,
  type FormBlockType,
} from "@rescom/schemas";

/**
 * Figma 13 toolbox (63:4256): the question types of `form-blocks.schema`
 * grouped as "Văn bản · Lựa chọn · Thang đo · Nhập liệu · Tệp", plus the
 * "Bố cục → Phần mới" entry (sections, ASSUMED — see `builder-blocks.ts`).
 */
export type ToolboxCategory = "text" | "choice" | "scale" | "input" | "file";

export interface BlockTypeInfo {
  type: FormBlockType;
  label: string;
  category: ToolboxCategory;
  /** `public/icons/<icon>.svg`. */
  icon: string;
  /** Extra search terms for "Tìm loại câu hỏi". */
  keywords: string;
}

export const TOOLBOX_CATEGORIES: readonly { id: ToolboxCategory; label: string }[] = [
  { id: "text", label: "Văn bản" },
  { id: "choice", label: "Lựa chọn" },
  { id: "scale", label: "Thang đo" },
  { id: "input", label: "Nhập liệu" },
  { id: "file", label: "Tệp" },
];

export const BLOCK_TYPES: readonly BlockTypeInfo[] = [
  { type: "text", label: "Trả lời ngắn", category: "text", icon: "text-short", keywords: "text van ban ngan" },
  { type: "textarea", label: "Đoạn văn", category: "text", icon: "text-paragraph", keywords: "textarea doan van dai" },
  { type: "single_choice", label: "Một lựa chọn", category: "choice", icon: "radio-circle", keywords: "radio mot lua chon" },
  { type: "multiple_choice", label: "Nhiều lựa chọn", category: "choice", icon: "checkbox-square", keywords: "checkbox nhieu lua chon" },
  { type: "rating", label: "Đánh giá sao", category: "scale", icon: "star-empty", keywords: "rating sao danh gia" },
  { type: "linear_scale", label: "Thang tuyến tính", category: "scale", icon: "dots-horizontal", keywords: "scale thang tuyen tinh" },
  { type: "number", label: "Số", category: "input", icon: "hash", keywords: "number so" },
  { type: "date", label: "Ngày", category: "input", icon: "calendar", keywords: "date ngay" },
  { type: "file_upload", label: "Tải tệp lên", category: "file", icon: "upload", keywords: "file tep tai len upload" },
];

export const SECTION_TOOL = { label: "Phần mới", icon: "section-split", category: "Bố cục" } as const;

const INFO_BY_TYPE = new Map(BLOCK_TYPES.map((info) => [info.type, info]));

export function blockTypeInfo(type: FormBlockType): BlockTypeInfo {
  const info = INFO_BY_TYPE.get(type);
  if (!info) throw new Error(`Unknown block type: ${type}`);
  return info;
}

/** Accent-insensitive match for "Tìm loại câu hỏi". */
export function foldVietnamese(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

export function searchBlockTypes(query: string): BlockTypeInfo[] {
  const needle = foldVietnamese(query);
  if (!needle) return [...BLOCK_TYPES];
  return BLOCK_TYPES.filter((info) => foldVietnamese(`${info.label} ${info.keywords}`).includes(needle));
}

/**
 * A new block with Vietnamese defaults (the shared `createDefaultBlock` uses
 * English placeholder copy). Choice option values are stable slugs so an
 * attention check's `expectedValue` survives label edits.
 */
export function createBuilderBlock(type: FormBlockType, order: number, id: string = generateBlockId()): FormBlock {
  const base = { id, title: "Câu hỏi chưa có tiêu đề", required: false };
  switch (type) {
    case "text":
      return createDefaultBlock(type, order, { ...base, placeholder: "Câu trả lời ngắn" } as Partial<FormBlock>);
    case "textarea":
      return createDefaultBlock(type, order, { ...base, placeholder: "Người trả lời nhập đoạn văn ở đây" } as Partial<FormBlock>);
    case "number":
      return createDefaultBlock(type, order, { ...base, placeholder: "0" } as Partial<FormBlock>);
    case "single_choice":
    case "multiple_choice":
      return createDefaultBlock(type, order, {
        ...base,
        options: [
          { id: "opt-1", label: "Lựa chọn 1", value: "opt_1" },
          { id: "opt-2", label: "Lựa chọn 2", value: "opt_2" },
        ],
      } as Partial<FormBlock>);
    case "linear_scale":
      return createDefaultBlock(type, order, {
        ...base,
        minLabel: "Hoàn toàn không đồng ý",
        maxLabel: "Hoàn toàn đồng ý",
      } as Partial<FormBlock>);
    default:
      return createDefaultBlock(type, order, base as Partial<FormBlock>);
  }
}
