import { z } from "zod";

/**
 * Plan 2.2: the survey topic ("Chủ đề", Figma 9a). Stable ASCII values shared
 * by the wizard, the backend (`forms.topic`) and the Explore feed; the
 * Vietnamese labels live in the frontend, keyed by these values. Adding a
 * topic needs no migration (`forms.topic` is free text validated here).
 */
export const FORM_TOPICS = [
  "MARKETING",
  "BUSINESS",
  "IT",
  "ENGINEERING",
  "SOCIAL_SCIENCES",
  "DESIGN",
  "HEALTH",
  "STUDENT_LIFE",
  "OTHER",
] as const;

export const formTopicEnum = z.enum(FORM_TOPICS);
export type FormTopic = z.infer<typeof formTopicEnum>;

/**
 * What the Explore search matches a topic by (besides its value): the
 * frontend label first, then common synonyms. Compared after
 * `normalizeSearchText`, so "cntt", "Công nghệ" and "cong nghe" all hit IT.
 * The frontend test pins every label to its first entry.
 */
export const FORM_TOPIC_SEARCH_TERMS: Record<FormTopic, readonly string[]> = {
  MARKETING: ["Marketing & Truyền thông", "marketing", "truyền thông", "quảng cáo"],
  BUSINESS: ["Kinh tế & Quản trị kinh doanh", "kinh tế", "kinh doanh", "quản trị", "QTKD", "tài chính"],
  IT: ["Công nghệ thông tin", "CNTT", "công nghệ", "phần mềm", "lập trình"],
  ENGINEERING: ["Kỹ thuật & Kiến trúc", "kỹ thuật", "kiến trúc", "xây dựng"],
  SOCIAL_SCIENCES: ["Ngôn ngữ & Khoa học xã hội", "ngôn ngữ", "xã hội", "tâm lý", "giáo dục"],
  DESIGN: ["Thiết kế đồ họa & Mỹ thuật", "thiết kế", "đồ họa", "mỹ thuật"],
  HEALTH: ["Y sinh & Sức khỏe", "y sinh", "sức khỏe", "y tế", "y khoa"],
  STUDENT_LIFE: ["Đời sống sinh viên", "đời sống", "sinh viên"],
  OTHER: ["Khác"],
};

/**
 * Accent- and case-insensitive form of Vietnamese text for search: NFD,
 * combining marks removed, "đ" → "d", lower case, whitespace collapsed.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Explore feed search (plan 2.2): the query matches the title, the
 * description, or the topic (its value or any search term), ignoring case
 * and Vietnamese diacritics. An empty query matches everything.
 */
export function matchesSurveySearch(
  survey: {
    title: string;
    description?: string | null;
    topic?: FormTopic | null;
  },
  query: string,
): boolean {
  const needle = normalizeSearchText(query);
  if (!needle) return true;
  const haystacks = [survey.title, survey.description ?? ""];
  if (survey.topic) {
    haystacks.push(survey.topic.replace(/_/g, " "), ...FORM_TOPIC_SEARCH_TERMS[survey.topic]);
  }
  return haystacks.some((text) => normalizeSearchText(text).includes(needle));
}

/**
 * Story IR.2b Q1 (default): the survey collection deadline (`deadlineAt`),
 * an ISO instant at least 1 hour and at most 180 days ahead when it is set.
 * The schema checks the shape; `checkFormDeadline` the window, against the
 * server clock at create / draft save / publish / reopen.
 */
export const FORM_DEADLINE_MIN_LEAD_MS = 60 * 60 * 1000;
export const FORM_DEADLINE_MAX_LEAD_MS = 180 * 24 * 60 * 60 * 1000;

export const formDeadlineAtSchema = z
  .string()
  .datetime({ message: "deadlineAt must be an ISO-8601 datetime (e.g. 2026-10-15T17:00:00.000Z)" });

export type FormDeadlineProblem = "TOO_SOON" | "TOO_LATE";

export function checkFormDeadline(deadlineAt: Date, now: Date): FormDeadlineProblem | null {
  const lead = deadlineAt.getTime() - now.getTime();
  if (lead < FORM_DEADLINE_MIN_LEAD_MS) return "TOO_SOON";
  if (lead > FORM_DEADLINE_MAX_LEAD_MS) return "TOO_LATE";
  return null;
}
