import { z } from "zod";

/**
 * Plan 2.2: the survey topic ("Chủ đề", Figma 9a). Stable ASCII values shared
 * by the wizard, the backend (`forms.topic`) and the Explore feed; the
 * Vietnamese labels live in the frontend, keyed by these values. Adding a
 * topic needs no migration (`forms.topic` is free text validated here);
 * renaming or removing one needs a data migration (see LEGACY_FORM_TOPICS).
 */
export const FORM_TOPICS = [
  "AI",
  "IT",
  "BUSINESS",
  "FINANCE",
  "MARKETING",
  "EDUCATION",
  "TRAVEL_FOOD",
  "SPORTS",
  "SCHOOL_PSYCHOLOGY",
  "MENTAL_HEALTH",
  "GREEN_LIVING",
  "ARTS_MUSIC",
  "FASHION_BEAUTY",
  "GAMING",
  "ENTERTAINMENT",
  "CAREER",
  "VOLUNTEERING",
  "RESEARCH",
  "OTHER",
] as const;

export const formTopicEnum = z.enum(FORM_TOPICS);
export type FormTopic = z.infer<typeof formTopicEnum>;

/**
 * What the Explore search matches a topic by (besides its value): the
 * frontend label first, then common synonyms. Compared after
 * `normalizeSearchText`, so "cntt", "Công nghệ" and "cong nghe" all hit IT.
 * The frontend test pins every label to its first entry. The labels are the
 * onboarding interests (`INTEREST_OPTIONS`) plus "Khác".
 */
export const FORM_TOPIC_SEARCH_TERMS: Record<FormTopic, readonly string[]> = {
  AI: ["Trí tuệ nhân tạo (AI)", "trí tuệ nhân tạo", "AI", "chatgpt"],
  IT: ["Công nghệ & Lập trình", "công nghệ", "lập trình", "CNTT", "công nghệ thông tin", "phần mềm"],
  BUSINESS: ["Khởi nghiệp & Kinh doanh", "khởi nghiệp", "kinh doanh", "kinh tế", "quản trị", "startup"],
  FINANCE: ["Tài chính & Đầu tư", "tài chính", "đầu tư", "chứng khoán", "ngân hàng"],
  MARKETING: ["Marketing & Mạng xã hội", "marketing", "mạng xã hội", "truyền thông", "quảng cáo"],
  EDUCATION: ["Giáo dục & Kỹ năng học tập", "giáo dục", "học tập", "kỹ năng", "sinh viên"],
  TRAVEL_FOOD: ["Du lịch & Ẩm thực", "du lịch", "ẩm thực", "ăn uống"],
  SPORTS: ["Thể thao & Rèn luyện sức khỏe", "thể thao", "rèn luyện", "tập luyện", "gym"],
  SCHOOL_PSYCHOLOGY: ["Tâm lý học đường", "tâm lý", "học đường", "xã hội"],
  MENTAL_HEALTH: ["Sức khỏe tinh thần", "sức khỏe", "tinh thần", "stress", "y tế"],
  GREEN_LIVING: ["Tiêu dùng xanh & Bảo vệ môi trường", "tiêu dùng xanh", "môi trường", "bền vững"],
  ARTS_MUSIC: ["Nghệ thuật & Âm nhạc", "nghệ thuật", "âm nhạc", "thiết kế", "mỹ thuật"],
  FASHION_BEAUTY: ["Thời trang & Làm đẹp", "thời trang", "làm đẹp", "mỹ phẩm"],
  GAMING: ["Trò chơi điện tử & Thể thao điện tử", "trò chơi", "game", "esports", "thể thao điện tử"],
  ENTERTAINMENT: ["Phim ảnh & Giải trí", "phim", "giải trí", "điện ảnh"],
  CAREER: ["Việc làm & Phát triển sự nghiệp", "việc làm", "sự nghiệp", "tuyển dụng", "thực tập"],
  VOLUNTEERING: ["Tình nguyện & Hoạt động cộng đồng", "tình nguyện", "cộng đồng"],
  RESEARCH: ["Nghiên cứu khoa học", "nghiên cứu", "khoa học", "kỹ thuật"],
  OTHER: ["Khác"],
};

/**
 * Topic values that existed before the interest-based list (2026-10-05),
 * mapped to their closest current topic. Migration
 * 20261005120000_form_topic_interests rewrites stored rows the same way.
 */
export const LEGACY_FORM_TOPICS: Readonly<Record<string, FormTopic>> = {
  HEALTH: "MENTAL_HEALTH",
  STUDENT_LIFE: "EDUCATION",
  DESIGN: "ARTS_MUSIC",
  SOCIAL_SCIENCES: "SCHOOL_PSYCHOLOGY",
  ENGINEERING: "RESEARCH",
};

/**
 * `topic` as read from an API response: a legacy value reads as its
 * replacement and any other unknown value as null, so a topic the reader does
 * not know (frontend and backend deployed at different times) loses only its
 * label instead of failing the whole response. Requests stay strict
 * (`formTopicEnum`).
 */
export const formTopicReadSchema = z
  .preprocess(
    (value) => (typeof value === "string" && Object.hasOwn(LEGACY_FORM_TOPICS, value) ? LEGACY_FORM_TOPICS[value] : value),
    formTopicEnum.nullable().optional(),
  )
  .catch(null);

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
