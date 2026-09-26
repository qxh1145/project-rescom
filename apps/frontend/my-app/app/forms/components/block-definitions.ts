import {
  type FormBlock,
  type FormBlockType,
  createDefaultBlock,
} from "@rescom/schemas";

export { createDefaultBlock };
export type { FormBlock, FormBlockType };

export interface BlockTypeMetadata {
  type: FormBlockType;
  label: string;
  description: string;
  category: "text" | "choice" | "scale" | "input" | "media";
  icon: string; // SVG path or icon identifier
}

export const BLOCK_CATALOG: BlockTypeMetadata[] = [
  {
    type: "text",
    label: "Short Text",
    description: "Single-line text input for names, short answers",
    category: "text",
    icon: "text",
  },
  {
    type: "textarea",
    label: "Long Text",
    description: "Multi-line text area for paragraphs and open feedback",
    category: "text",
    icon: "textarea",
  },
  {
    type: "number",
    label: "Number",
    description: "Numeric input with optional min/max boundaries",
    category: "input",
    icon: "number",
  },
  {
    type: "single_choice",
    label: "Single Choice",
    description: "Radio selection with mutually exclusive choices",
    category: "choice",
    icon: "radio",
  },
  {
    type: "multiple_choice",
    label: "Multiple Choice",
    description: "Multi-select checkboxes with optional limits",
    category: "choice",
    icon: "checkbox",
  },
  {
    type: "rating",
    label: "Rating Scale",
    description: "Star, heart, or numeric satisfaction scores",
    category: "scale",
    icon: "star",
  },
  {
    type: "linear_scale",
    label: "Linear Scale",
    description: "Likert scale with labeled min/max spectrum",
    category: "scale",
    icon: "scale",
  },
  {
    type: "date",
    label: "Date",
    description: "Calendar date picker with optional time",
    category: "input",
    icon: "calendar",
  },
  {
    type: "file_upload",
    label: "File Upload",
    description: "Attachment dropzone with size & type constraints",
    category: "media",
    icon: "upload",
  },
];

export const BLOCK_METADATA_MAP: Record<FormBlockType, BlockTypeMetadata> =
  BLOCK_CATALOG.reduce(
    (acc, meta) => {
      acc[meta.type] = meta;
      return acc;
    },
    {} as Record<FormBlockType, BlockTypeMetadata>,
  );
