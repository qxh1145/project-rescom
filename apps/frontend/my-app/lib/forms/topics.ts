import { FORM_TOPICS, FORM_TOPIC_SEARCH_TERMS, LEGACY_FORM_TOPICS, formTopicEnum, type FormTopic } from "@rescom/schemas";

/**
 * "Chủ đề" (Figma 9a select). Plan 2.2: the values are the shared
 * `FORM_TOPICS` (sent as `topic`, stored in `forms.topic`); the Vietnamese
 * labels are the first search term of each topic (the onboarding interests
 * plus "Khác"), keyed by those values (also used by the Khám phá cards).
 */
export const TOPIC_LABELS: Readonly<Record<FormTopic, string>> = Object.fromEntries(
  FORM_TOPICS.map((topic) => [topic, FORM_TOPIC_SEARCH_TERMS[topic][0]]),
) as Record<FormTopic, string>;

export const TOPIC_OPTIONS: readonly { value: FormTopic; label: string }[] = FORM_TOPICS.map((value) => ({
  value,
  label: TOPIC_LABELS[value],
}));

/**
 * Values stored before the current list, mapped to the shared ones: the
 * wizard's pre-plan-2.2 labels (localStorage drafts) and the pre-2026-10-05
 * topic values (`LEGACY_FORM_TOPICS`).
 */
const LEGACY_TOPIC_VALUES: Readonly<Record<string, FormTopic>> = {
  ...LEGACY_FORM_TOPICS,
  Marketing: "MARKETING",
  "Kinh tế": "BUSINESS",
  CNTT: "IT",
  "Kỹ thuật": "RESEARCH",
  "Xã hội": "SCHOOL_PSYCHOLOGY",
  "Thiết kế": "ARTS_MUSIC",
  "Sức khỏe": "MENTAL_HEALTH",
  "Đời sống": "EDUCATION",
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
