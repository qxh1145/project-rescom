import { FORM_TOPICS, formTopicEnum, type FormTopic } from "@rescom/schemas";

/**
 * "Chủ đề" (Figma 9a select). Plan 2.2: the values are the shared
 * `FORM_TOPICS` (sent as `topic`, stored in `forms.topic`); the Vietnamese
 * labels live here, keyed by those values (also used by the Khám phá cards).
 */
export const TOPIC_LABELS: Readonly<Record<FormTopic, string>> = {
  MARKETING: "Marketing & Truyền thông",
  BUSINESS: "Kinh tế & Quản trị kinh doanh",
  IT: "Công nghệ thông tin",
  ENGINEERING: "Kỹ thuật & Kiến trúc",
  SOCIAL_SCIENCES: "Ngôn ngữ & Khoa học xã hội",
  DESIGN: "Thiết kế đồ họa & Mỹ thuật",
  HEALTH: "Y sinh & Sức khỏe",
  STUDENT_LIFE: "Đời sống sinh viên",
  OTHER: "Khác",
};

export const TOPIC_OPTIONS: readonly { value: FormTopic; label: string }[] = FORM_TOPICS.map((value) => ({
  value,
  label: TOPIC_LABELS[value],
}));

/** Values the wizard stored before plan 2.2 (localStorage drafts), mapped to the shared ones. */
const LEGACY_TOPIC_VALUES: Readonly<Record<string, FormTopic>> = {
  Marketing: "MARKETING",
  "Kinh tế": "BUSINESS",
  CNTT: "IT",
  "Kỹ thuật": "ENGINEERING",
  "Xã hội": "SOCIAL_SCIENCES",
  "Thiết kế": "DESIGN",
  "Sức khỏe": "HEALTH",
  "Đời sống": "STUDENT_LIFE",
  Khác: "OTHER",
};

/** A stored / received topic as a shared value, or "" when unknown or empty. */
export function normalizeWizardTopic(raw: unknown): FormTopic | "" {
  if (typeof raw !== "string" || !raw) return "";
  const parsed = formTopicEnum.safeParse(raw);
  if (parsed.success) return parsed.data;
  return LEGACY_TOPIC_VALUES[raw] ?? "";
}

/** Label of a topic value (Khám phá cards, summaries); null when unknown. */
export function topicLabel(topic: string | null | undefined): string | null {
  const value = normalizeWizardTopic(topic);
  return value ? TOPIC_LABELS[value] : null;
}
