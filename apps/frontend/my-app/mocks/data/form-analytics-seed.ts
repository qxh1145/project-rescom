import { escrowDrawPerCompletion, formBlockSchema, type FormBlock, type FormBlockInput } from "@rescom/schemas";
import type { MockAnswer, MockFormResponse, MockQualitySnapshot } from "./form-responses";
import type { MockFormVersion } from "./form-versions";
import type { MockPublisherForm } from "./forms";
import type { MockSurvey } from "./surveys";

/**
 * Seed of the survey response analytics (Câu trả lời → Tóm tắt / Theo câu
 * hỏi), owned by the demo publisher and wired into the existing collections
 * (`forms.ts`, `form-versions.ts`, `form-responses.ts`):
 *
 * - "Đánh giá trải nghiệm nền tảng RESCOM" — INTERNAL, closed by its owner
 *   after 321/321 completions, 11 questions covering every chart. Answer
 *   counts are exact (see `COUNTS`); which row gets which answer comes from a
 *   seeded shuffle, so the data is the same on every reset.
 * - "Hiệu quả của việc học nhóm" — INTERNAL, published 3 hours ago,
 *   no responses yet (empty state); respondents see it too (`surveys.ts`).
 *
 * Pure (no storage/MSW): times are relative to `now`, so tests can import it.
 * Choice answers are stored as the option text (value = label), like the
 * housing survey; a free "Khác" answer is stored as its text.
 */

export const ANALYTICS_FORM_IDS = {
  rescomExperience: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f05",
  groupStudy: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f06",
} as const;

/** Published version rows (`form-versions.ts`); the group-study one is also the respondent `formVersionId`. */
const ANALYTICS_VERSION_IDS = {
  rescomExperience: "8d2e4f60-1a2b-4c3d-9e4f-5a6b7c8d9f05",
  groupStudy: "8d2e4f60-1a2b-4c3d-9e4f-5a6b7c8d9f06",
} as const;

const DEMO_PUBLISHER = "minh.le@fpt.edu.vn";
const DEMO_PUBLISHER_NAME = "Lê Nhật Minh";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Asia/Ho_Chi_Minh (no DST). */
const VN_OFFSET = 7 * HOUR;

export const RESCOM_TOTAL = 321;
const RESCOM_STARTED = 356;
const RESCOM_EFFORT_SECONDS = 6 * 60;
const RESCOM_REVIEW_COUNT = 13;

// --- Deterministic randomness ---

type Rng = () => number;

function rngOf(seed: string): Rng {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], seed: string): T[] {
  const rng = rngOf(seed);
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

/** `count` copies of each value, then `null` up to `total`, shuffled. */
function exact(pairs: ReadonlyArray<readonly [MockAnswer, number]>, total: number, seed: string): MockAnswer[] {
  const values: MockAnswer[] = pairs.flatMap(([value, count]) => new Array<MockAnswer>(count).fill(value));
  if (values.length > total) throw new Error(`form-analytics-seed: ${seed} has ${values.length} answers for ${total} rows`);
  while (values.length < total) values.push(null);
  return shuffled(values, seed);
}

/** "2026-09-18T16:48:00+07:00". */
function vnIso(time: number): string {
  return `${new Date(Math.floor(time / 1000) * 1000 + VN_OFFSET).toISOString().slice(0, 19)}+07:00`;
}

// --- Blocks ---

const options = (prefix: string, labels: readonly string[]) =>
  labels.map((label, index) => ({ id: `${prefix}-o${index + 1}`, label, value: label }));

const define = (raw: FormBlockInput[]): FormBlock[] => formBlockSchema.array().parse(raw);

export const RX = {
  gender: ["Nam", "Nữ", "Khác"],
  age: ["Dưới 18", "18–24", "25–34", "35–44", "45+"],
  platforms: ["Facebook", "TikTok", "Instagram", "YouTube", "Zalo"],
  redeemed: ["Có", "Không"],
  channels: [
    "Bạn bè giới thiệu",
    "Facebook",
    "TikTok",
    "Email trường",
    "Poster tại trường",
    "Giảng viên",
    "Tìm kiếm Google",
    "Khác",
  ],
} as const;

export const RESCOM_EXPERIENCE_BLOCKS = define([
  { id: "rx-gender", order: 0, type: "single_choice", title: "Giới tính của bạn là gì?", required: true, options: options("rx-gender", RX.gender) },
  { id: "rx-age", order: 1, type: "single_choice", title: "Bạn thuộc nhóm tuổi nào?", required: true, options: options("rx-age", RX.age) },
  {
    id: "rx-platforms",
    order: 2,
    type: "multiple_choice",
    title: "Bạn sử dụng nền tảng mạng xã hội nào?",
    description: "Chọn tất cả nền tảng bạn dùng ít nhất một lần mỗi tuần.",
    required: true,
    minSelections: 1,
    allowOther: true,
    options: options("rx-platforms", RX.platforms),
  },
  { id: "rx-stars", order: 3, type: "rating", title: "Bạn đánh giá trải nghiệm RESCOM bao nhiêu sao?", required: true, maxRating: 5, ratingShape: "STAR" },
  {
    id: "rx-recommend",
    order: 4,
    type: "linear_scale",
    title: "Bạn có sẵn sàng giới thiệu RESCOM cho bạn bè không?",
    required: true,
    min: 1,
    max: 10,
    minLabel: "Không bao giờ",
    maxLabel: "Chắc chắn có",
  },
  { id: "rx-redeemed", order: 5, type: "single_choice", title: "Bạn đã từng đổi điểm thưởng chưa?", required: true, options: options("rx-redeemed", RX.redeemed) },
  { id: "rx-channel", order: 6, type: "single_choice", title: "Bạn biết đến RESCOM qua kênh nào?", required: true, options: options("rx-channel", RX.channels) },
  {
    id: "rx-minutes",
    order: 7,
    type: "number",
    title: "Mỗi tuần bạn dành khoảng bao nhiêu phút để làm khảo sát?",
    required: false,
    min: 0,
    max: 300,
    integerOnly: true,
    placeholder: "Ví dụ: 60",
  },
  { id: "rx-like", order: 8, type: "text", title: "Bạn thích điều gì nhất ở RESCOM?", required: false, maxLength: 200 },
  { id: "rx-improve", order: 9, type: "textarea", title: "Bạn muốn RESCOM cải thiện điều gì?", required: false, maxLength: 1000 },
  { id: "rx-since", order: 10, type: "date", title: "Bạn bắt đầu dùng RESCOM từ ngày nào?", required: false, minDate: "2026-01-01", maxDate: "2026-12-31" },
]);

export const GROUP_STUDY_BLOCKS = define([
  {
    id: "gs-freq",
    order: 0,
    type: "single_choice",
    title: "Bạn thường học nhóm bao nhiêu buổi mỗi tuần?",
    required: true,
    options: options("gs-freq", ["Không học nhóm", "1 buổi", "2–3 buổi", "Từ 4 buổi trở lên"]),
  },
  {
    id: "gs-place",
    order: 1,
    type: "multiple_choice",
    title: "Bạn hay học nhóm ở đâu?",
    required: true,
    allowOther: true,
    options: options("gs-place", ["Thư viện trường", "Quán cà phê", "Phòng tự học", "Online (Meet, Zoom)"]),
  },
  {
    id: "gs-help",
    order: 2,
    type: "linear_scale",
    title: "Học nhóm giúp bạn hiểu bài hơn đến mức nào?",
    required: true,
    min: 1,
    max: 5,
    minLabel: "Không giúp gì",
    maxLabel: "Giúp rất nhiều",
  },
  { id: "gs-size", order: 3, type: "number", title: "Nhóm học của bạn thường có mấy người?", required: false, min: 2, max: 20, integerOnly: true },
  { id: "gs-why", order: 4, type: "textarea", title: "Điều gì khiến buổi học nhóm của bạn kém hiệu quả?", required: false, maxLength: 1000 },
]);

// --- Exact answer counts of "Đánh giá trải nghiệm nền tảng RESCOM" ---

export const COUNTS = {
  gender: [126, 194, 1],
  age: [109, 76, 34, 48, 54],
  platforms: [245, 210, 145, 188, 132],
  stars: [10, 15, 44, 103, 149],
  recommend: [6, 5, 9, 12, 24, 33, 58, 72, 61, 41],
  redeemed: [198, 123],
  channels: [84, 67, 49, 38, 27, 31, 17, 8],
  minutesAnswered: 290,
  likeAnswered: 182,
  improveAnswered: 118,
  sinceAnswered: 243,
} as const;

export const PLATFORM_OTHERS = ["Threads", "Discord", "Telegram", "Pinterest", "LinkedIn", "Reddit", "X (Twitter)"];

const LIKES = [
  "Giao diện dễ sử dụng",
  "Có nhiều khảo sát thú vị",
  "Hệ thống reward khá hay",
  "Nhận điểm nhanh",
  "Khảo sát ngắn, làm lúc rảnh được",
  "Giao diện đẹp, gọn",
  "Được ẩn danh nên yên tâm trả lời",
  "Đổi điểm thưởng dễ",
  "Nhiều chủ đề gần với sinh viên",
  "Làm trên điện thoại rất mượt",
  "Biết trước thời gian làm mỗi khảo sát",
  "Có thông báo khi có khảo sát mới",
  "Giúp được bạn bè làm nghiên cứu",
  "Ví điểm rõ ràng",
  "Không có quảng cáo",
  "Tải nhanh",
  "Câu hỏi rõ ràng, dễ hiểu",
  "Có chế độ lưu nháp",
  "Thưởng điểm công bằng",
  "Tạo khảo sát nhanh",
  "Kết quả khảo sát trực quan",
  "Hỗ trợ trả lời nhanh",
  "Được thử nhiều loại câu hỏi",
  "Cộng đồng sinh viên đông",
  "Minh bạch về cách dùng dữ liệu",
];

const IMPROVEMENTS = [
  "Mong có thêm nhiều khảo sát với mức thưởng cao hơn.",
  "Nên có thông báo khi điểm thưởng được cộng vào ví.",
  "Muốn đổi điểm sang nhiều loại quà hơn, ví dụ voucher ăn uống.",
  "Một số khảo sát ghi 5 phút nhưng làm mất gần 10 phút.",
  "Trang Khám phá nên có bộ lọc theo chủ đề và thời gian làm.",
  "Nên cho xem lại câu trả lời mình đã gửi.",
  "Ứng dụng đôi khi tải chậm vào buổi tối.",
  "Mong có chế độ tối để đỡ mỏi mắt.",
  "Nên giải thích rõ vì sao một câu trả lời bị đánh dấu cần xem lại.",
  "Muốn có bảng xếp hạng người làm khảo sát tích cực.",
  "Cần hướng dẫn chi tiết hơn cho người mới tạo khảo sát.",
  "Nên hỗ trợ đăng nhập bằng tài khoản trường nhanh hơn.",
  "Có khảo sát hỏi lại thông tin cá nhân mình đã điền trong hồ sơ.",
  "Mong thời gian duyệt khảo sát nhanh hơn.",
  "Nên có thêm câu hỏi dạng xếp hạng thứ tự.",
  "Muốn xuất kết quả khảo sát ra file để làm báo cáo môn học.",
  "Giao diện trên máy tính bảng còn hơi trống.",
  "Nên nhắc khi mình bỏ dở khảo sát giữa chừng.",
  "Điểm thưởng tối thiểu để đổi quà hơi cao.",
  "Mong có thêm khảo sát cho sinh viên năm cuối.",
];

// --- Forms, versions, responses, quality snapshot ---

function rescomTimes(now: number) {
  return {
    createdAt: now - 18 * DAY,
    submittedAt: now - 17 * DAY,
    publishedAt: now - 16 * DAY,
    closedAt: now - 2 * DAY,
  };
}

function groupStudyTimes(now: number) {
  return { createdAt: now - 26 * HOUR, submittedAt: now - 5 * HOUR, publishedAt: now - 3 * HOUR, deadlineAt: now + 10 * DAY };
}

const GROUP_STUDY_EXPECTED = 50;
const GROUP_STUDY_REWARD = 10;
export const GROUP_STUDY_EFFORT_SECONDS = 4 * 60;

export function analyticsPublisherForms(now = Date.now()): MockPublisherForm[] {
  const rx = rescomTimes(now);
  const gs = groupStudyTimes(now);
  return [
    {
      id: ANALYTICS_FORM_IDS.rescomExperience,
      ownerEmail: DEMO_PUBLISHER,
      title: "Đánh giá trải nghiệm nền tảng RESCOM",
      type: "INTERNAL",
      status: "CLOSED",
      rewardPerResponse: 8,
      expectedCompletions: RESCOM_TOTAL,
      completedCompletions: RESCOM_TOTAL,
      escrowLocked: 0,
      estimatedEffortSeconds: RESCOM_EFFORT_SECONDS,
      externalUrl: null,
      createdAt: new Date(rx.createdAt).toISOString(),
      submittedAt: new Date(rx.submittedAt).toISOString(),
      publishedAt: new Date(rx.publishedAt).toISOString(),
      deadlineAt: null,
      closedAt: new Date(rx.closedAt).toISOString(),
      hiddenFromMarketplace: true,
      rejection: null,
      versionNumber: 1,
      closeKind: "OWNER",
      audienceLabel: "Mọi người dùng RESCOM",
      questionCount: RESCOM_EXPERIENCE_BLOCKS.length,
    },
    {
      id: ANALYTICS_FORM_IDS.groupStudy,
      ownerEmail: DEMO_PUBLISHER,
      title: "Hiệu quả của việc học nhóm",
      type: "INTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: GROUP_STUDY_REWARD,
      expectedCompletions: GROUP_STUDY_EXPECTED,
      completedCompletions: 0,
      // MOCK-ONLY like the demo running survey (`form-drafts.ts`): not mirrored in the seeded wallet escrow.
      escrowLocked: GROUP_STUDY_EXPECTED * escrowDrawPerCompletion({ type: "INTERNAL", rewardPerResponse: GROUP_STUDY_REWARD }),
      estimatedEffortSeconds: GROUP_STUDY_EFFORT_SECONDS,
      externalUrl: null,
      createdAt: new Date(gs.createdAt).toISOString(),
      submittedAt: new Date(gs.submittedAt).toISOString(),
      publishedAt: new Date(gs.publishedAt).toISOString(),
      deadlineAt: new Date(gs.deadlineAt).toISOString(),
      closedAt: null,
      hiddenFromMarketplace: false,
      rejection: null,
      versionNumber: 1,
      closeKind: null,
      audienceLabel: "Mọi sinh viên",
      questionCount: GROUP_STUDY_BLOCKS.length,
    },
  ];
}

/**
 * Respondent-side mirror of the running "Hiệu quả của việc học nhóm"
 * (`surveys.ts`, same id — like "Nhu cầu nhà trọ gần trường"), so the link
 * copied from its empty Tóm tắt opens the survey in Khám phá / `/surveys/:id/start`.
 * Its questions are `GROUP_STUDY_BLOCKS` (`survey-content.ts`).
 */
export function analyticsRespondentSurveys(now = Date.now()): MockSurvey[] {
  const gs = groupStudyTimes(now);
  return [
    {
      id: ANALYTICS_FORM_IDS.groupStudy,
      formVersionId: ANALYTICS_VERSION_IDS.groupStudy,
      versionNumber: 1,
      title: "Hiệu quả của việc học nhóm",
      description: null,
      type: "INTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: GROUP_STUDY_REWARD,
      expectedCompletions: GROUP_STUDY_EXPECTED,
      completedCompletions: 0,
      estimatedEffortSeconds: GROUP_STUDY_EFFORT_SECONDS,
      topic: "Giáo dục",
      publisherName: DEMO_PUBLISHER_NAME,
      externalUrl: null,
      publishedAt: new Date(gs.publishedAt).toISOString(),
    },
  ];
}

export function analyticsFormVersions(now = Date.now()): MockFormVersion[] {
  const rx = rescomTimes(now);
  const gs = groupStudyTimes(now);
  return [
    {
      id: ANALYTICS_VERSION_IDS.rescomExperience,
      formId: ANALYTICS_FORM_IDS.rescomExperience,
      versionNumber: 1,
      isPublished: true,
      publishedAt: new Date(rx.publishedAt).toISOString(),
      createdAt: new Date(rx.createdAt).toISOString(),
      updatedAt: new Date(rx.submittedAt).toISOString(),
      submittedForReviewAt: new Date(rx.submittedAt).toISOString(),
      collectedFrom: new Date(rx.publishedAt).toISOString(),
      collectedUntil: new Date(rx.closedAt).toISOString(),
      blocks: structuredClone(RESCOM_EXPERIENCE_BLOCKS),
    },
    {
      id: ANALYTICS_VERSION_IDS.groupStudy,
      formId: ANALYTICS_FORM_IDS.groupStudy,
      versionNumber: 1,
      isPublished: true,
      publishedAt: new Date(gs.publishedAt).toISOString(),
      createdAt: new Date(gs.createdAt).toISOString(),
      updatedAt: new Date(gs.submittedAt).toISOString(),
      submittedForReviewAt: new Date(gs.submittedAt).toISOString(),
      collectedFrom: new Date(gs.publishedAt).toISOString(),
      collectedUntil: null,
      blocks: structuredClone(GROUP_STUDY_BLOCKS),
    },
  ];
}

/** Everyone picks ≥ 1 platform: those without Facebook all use TikTok. Free "Khác" texts go last. */
function platformAnswers(): string[][] {
  const people = shuffled([...Array(RESCOM_TOTAL).keys()], "rx-platforms");
  const [facebook, tiktok, instagram, youtube, zalo] = COUNTS.platforms;
  const withFacebook = people.slice(0, facebook);
  const withoutFacebook = people.slice(facebook);
  const picks: Array<Set<number>> = [
    new Set(withFacebook),
    new Set([...withoutFacebook, ...shuffled(withFacebook, "rx-platforms-tiktok").slice(0, tiktok - withoutFacebook.length)]),
    new Set(shuffled(people, "rx-platforms-instagram").slice(0, instagram)),
    new Set(shuffled(people, "rx-platforms-youtube").slice(0, youtube)),
    new Set(shuffled(people, "rx-platforms-zalo").slice(0, zalo)),
  ];
  const others = new Map(shuffled(people, "rx-platforms-other").slice(0, PLATFORM_OTHERS.length).map((person, index) => [person, PLATFORM_OTHERS[index]]));
  return [...Array(RESCOM_TOTAL).keys()].map((person) => {
    const chosen: string[] = RX.platforms.filter((_, index) => picks[index].has(person));
    const other = others.get(person);
    return other ? [...chosen, other] : chosen;
  });
}

/** Round-number minutes (people answer 30, 45, 60…), wide spread over 0–300. */
function minuteAnswers(): MockAnswer[] {
  const rng = rngOf("rx-minutes-values");
  const values = [...Array(COUNTS.minutesAnswered)].map(() => {
    const raw = 300 * rng() ** 1.6;
    return Math.min(300, Math.round(raw / 5) * 5);
  });
  return exact(values.map((value) => [value, 1] as const), RESCOM_TOTAL, "rx-minutes");
}

function pooledAnswers(pool: readonly string[], answered: number, seed: string): MockAnswer[] {
  const rng = rngOf(`${seed}-values`);
  // Earlier phrases are more popular.
  const values = [...Array(answered)].map(() => pool[Math.floor(pool.length * rng() ** 1.5)]);
  return exact(values.map((value) => [value, 1] as const), RESCOM_TOTAL, seed);
}

function dateAnswers(): MockAnswer[] {
  const rng = rngOf("rx-since-values");
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2026, 8, 1);
  const values = [...Array(COUNTS.sinceAnswered)].map(() =>
    new Date(start + Math.floor(rng() ** 0.8 * ((end - start) / DAY)) * DAY).toISOString().slice(0, 10),
  );
  return exact(values.map((value) => [value, 1] as const), RESCOM_TOTAL, "rx-since");
}

const pairs = (labels: readonly string[], counts: readonly number[]) => labels.map((label, index) => [label, counts[index]] as const);

/** Newest first; submitted within the collection window, mostly in the daytime (+07:00). */
function rescomSubmissionTimes(now: number): number[] {
  const rx = rescomTimes(now);
  const from = rx.publishedAt + HOUR / 2;
  const until = rx.closedAt - HOUR / 2;
  const rng = rngOf("rx-times");
  return [...Array(RESCOM_TOTAL)]
    .map(() => {
      // More answers right after launch.
      let time = from + (until - from) * rng() ** 1.4;
      const localHour = new Date(time + VN_OFFSET).getUTCHours();
      if (localHour >= 1 && localHour < 7) time += 8 * HOUR;
      if (time > until) time -= DAY;
      return time;
    })
    .sort((a, b) => b - a);
}

function hexCodes(count: number): string[] {
  const rng = rngOf("rx-codes");
  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(Math.floor(rng() * 0x10000).toString(16).toUpperCase().padStart(4, "0"));
  }
  return [...codes];
}

interface RescomRowTraits {
  flagged: boolean;
  durationSeconds: number;
}

let rescomTraitsCache: RescomRowTraits[] | null = null;

/**
 * Review flag and duration of each row (newest first). Independent of `now`,
 * so it is generated once and shared by the responses and the quality snapshot.
 */
function rescomRowTraits(): RescomRowTraits[] {
  if (rescomTraitsCache) return rescomTraitsCache;
  const review = new Set(shuffled([...Array(RESCOM_TOTAL).keys()], "rx-review").slice(0, RESCOM_REVIEW_COUNT));
  const rng = rngOf("rx-durations");
  rescomTraitsCache = [...Array(RESCOM_TOTAL).keys()].map((index) => {
    const flagged = review.has(index);
    // 150–175 s for the too-fast ones, otherwise 190–700 s centred around 6 minutes.
    const durationSeconds = flagged
      ? 150 + Math.floor(rng() * 26)
      : Math.round(190 + 510 * ((rng() + rng() + rng()) / 3) ** 1.15);
    return { flagged, durationSeconds };
  });
  return rescomTraitsCache;
}

export function analyticsResponses(now = Date.now()): MockFormResponse[] {
  const columns: Record<string, MockAnswer[]> = {
    "rx-gender": exact(pairs(RX.gender, COUNTS.gender), RESCOM_TOTAL, "rx-gender"),
    "rx-age": exact(pairs(RX.age, COUNTS.age), RESCOM_TOTAL, "rx-age"),
    "rx-platforms": platformAnswers(),
    "rx-stars": exact(COUNTS.stars.map((count, index) => [index + 1, count] as const), RESCOM_TOTAL, "rx-stars"),
    "rx-recommend": exact(COUNTS.recommend.map((count, index) => [index + 1, count] as const), RESCOM_TOTAL, "rx-recommend"),
    "rx-redeemed": exact(pairs(RX.redeemed, COUNTS.redeemed), RESCOM_TOTAL, "rx-redeemed"),
    "rx-channel": exact(pairs(RX.channels, COUNTS.channels), RESCOM_TOTAL, "rx-channel"),
    "rx-minutes": minuteAnswers(),
    "rx-like": pooledAnswers(LIKES, COUNTS.likeAnswered, "rx-like"),
    "rx-improve": pooledAnswers(IMPROVEMENTS, COUNTS.improveAnswered, "rx-improve"),
    "rx-since": dateAnswers(),
  };
  const times = rescomSubmissionTimes(now);
  const codes = hexCodes(RESCOM_TOTAL);
  const traits = rescomRowTraits();
  return times.map((time, index) => {
    const { flagged, durationSeconds } = traits[index];
    const answers: Record<string, MockAnswer> = {};
    for (const [questionId, values] of Object.entries(columns)) {
      const value = values[index];
      if (value !== null) answers[questionId] = value;
    }
    return {
      id: `9f3a5b70-2c4d-4e5f-8c7d-${String(index + 1).padStart(12, "0")}`,
      formId: ANALYTICS_FORM_IDS.rescomExperience,
      versionNumber: 1,
      code: codes[index],
      submittedAt: vnIso(time),
      durationSeconds,
      quality: flagged ? "NEEDS_REVIEW" : "PASSED",
      reviewReasons: flagged ? [{ code: "TOO_FAST", params: { declaredMinutes: RESCOM_EFFORT_SECONDS / 60 } }] : [],
      answers,
      codeVerified: null,
    };
  });
}

/** 356 started − 321 completed = 35 abandoned, mostly at the optional open questions. */
export function analyticsQualitySnapshots(now = Date.now()): MockQualitySnapshot[] {
  const rx = rescomTimes(now);
  const durations = rescomRowTraits()
    .map((row) => row.durationSeconds)
    .sort((a, b) => a - b);
  const middle = Math.floor(durations.length / 2);
  return [
    {
      formId: ANALYTICS_FORM_IDS.rescomExperience,
      versionNumber: 1,
      started: RESCOM_STARTED,
      abandoned: RESCOM_STARTED - RESCOM_TOTAL,
      medianDurationSeconds: durations.length % 2 ? durations[middle] : Math.round((durations[middle - 1] + durations[middle]) / 2),
      technicalErrors: 0,
      feedback: { average: 4.3, count: 64 },
      dropOffByQuestion: { 3: 6, 5: 4, 8: 7, 10: 13, 11: 5 },
      answerChangesQuestion: 5,
      updatedAt: vnIso(rx.closedAt),
    },
  ];
}
