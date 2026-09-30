import { formBlockSchema, type FormBlock, type FormBlockInput } from "@rescom/schemas";
import { GROUP_STUDY_BLOCKS, GROUP_STUDY_EFFORT_SECONDS } from "./form-analytics-seed";
import { findFormDraft } from "./form-drafts";
import { SURVEY_IDS, type MockSurvey } from "./surveys";

/**
 * Question definitions of every INTERNAL survey in `SURVEY_IDS` (Phase 3B).
 * "Hành vi mua sắm online…" follows Figma 4 (62:158): 8 questions in 3
 * sections, Q3 radio and Q4 1–5 scale are the drawn ones; the rest is
 * plausible content. Blocks are validated with the shared `formBlockSchema`.
 * `sections` is the ASSUMED contract field (see `lib/participation/survey-form-service.ts`).
 */
export interface MockSurveySection {
  id: string;
  title: string;
  blockIds: string[];
}

export interface MockSurveyContent {
  blocks: FormBlock[];
  sections: MockSurveySection[];
  metadata: { expectedEffortSeconds: number; minTimeBarrierSeconds: number };
}

const options = (prefix: string, labels: string[]) =>
  labels.map((label, index) => ({ id: `${prefix}-o${index + 1}`, label, value: label }));

function define(
  raw: FormBlockInput[],
  sections: MockSurveySection[],
  metadata: MockSurveyContent["metadata"],
): MockSurveyContent {
  return { blocks: formBlockSchema.array().parse(raw), sections, metadata };
}

const onlineShopping = define(
  [
    {
      id: "shop-q1",
      order: 0,
      type: "single_choice",
      title: "Bạn đang là sinh viên năm mấy?",
      required: true,
      options: options("shop-q1", ["Năm 1", "Năm 2", "Năm 3", "Năm 4", "Năm 5 trở lên"]),
      integrity: { semanticCategory: "DEMOGRAPHIC" },
    },
    {
      id: "shop-q2",
      order: 1,
      type: "multiple_choice",
      title: "Bạn thường mua sắm trên những sàn nào?",
      description: "Chọn tất cả sàn bạn đã mua trong 3 tháng gần đây.",
      required: true,
      options: options("shop-q2", ["Shopee", "Lazada", "TikTok Shop", "Tiki", "Sendo"]),
      integrity: { semanticCategory: "BEHAVIORAL" },
    },
    {
      id: "shop-q3",
      order: 2,
      type: "single_choice",
      title: "Bạn mua sắm online bao nhiêu lần mỗi tháng?",
      required: true,
      options: options("shop-q3", ["Ít hơn 1 lần", "1 – 3 lần", "4 – 6 lần", "Nhiều hơn 6 lần"]),
      integrity: { semanticCategory: "BEHAVIORAL" },
    },
    {
      id: "shop-q4",
      order: 3,
      type: "linear_scale",
      title: "Bạn tin tưởng đánh giá sản phẩm trên sàn thương mại điện tử ở mức nào?",
      required: true,
      min: 1,
      max: 5,
      minLabel: "Hoàn toàn không tin",
      maxLabel: "Rất tin tưởng",
      integrity: { semanticCategory: "PSYCHOGRAPHIC" },
    },
    {
      id: "shop-q5",
      order: 4,
      type: "number",
      title: "Trung bình mỗi tháng bạn chi bao nhiêu cho mua sắm online (nghìn đồng)?",
      required: true,
      min: 0,
      max: 100000,
      integerOnly: true,
      placeholder: "Ví dụ: 500",
      integrity: { semanticCategory: "BEHAVIORAL" },
    },
    {
      id: "shop-q6",
      order: 5,
      type: "rating",
      title: "Bạn chấm trải nghiệm giao hàng gần đây nhất bao nhiêu sao?",
      required: true,
      maxRating: 5,
      ratingShape: "STAR",
      integrity: { semanticCategory: "FEEDBACK" },
    },
    {
      id: "shop-q7",
      order: 6,
      type: "multiple_choice",
      title: "Điều gì khiến bạn tin một sản phẩm online?",
      description: "Chọn tối đa 3 lý do.",
      required: true,
      maxSelections: 3,
      options: options("shop-q7", [
        "Nhiều đánh giá tốt",
        "Ảnh, video thật từ người mua",
        "Shop chính hãng (Mall)",
        "Giá hợp lý so với thị trường",
        "Bạn bè giới thiệu",
      ]),
      integrity: { semanticCategory: "PSYCHOGRAPHIC" },
    },
    {
      id: "shop-q8",
      order: 7,
      type: "textarea",
      title: "Bạn có góp ý gì để mua sắm online an toàn hơn?",
      required: false,
      maxLength: 500,
      placeholder: "Chia sẻ trải nghiệm của bạn (không bắt buộc)",
      integrity: { semanticCategory: "FEEDBACK" },
    },
  ],
  [
    { id: "shop-s1", title: "Thông tin chung", blockIds: ["shop-q1", "shop-q2"] },
    { id: "shop-s2", title: "Thói quen mua sắm", blockIds: ["shop-q3", "shop-q4", "shop-q5"] },
    { id: "shop-s3", title: "Mức độ tin tưởng", blockIds: ["shop-q6", "shop-q7", "shop-q8"] },
  ],
  { expectedEffortSeconds: 5 * 60, minTimeBarrierSeconds: 20 },
);

const librarySatisfaction = define(
  [
    {
      id: "lib-q1",
      order: 0,
      type: "single_choice",
      title: "Bạn đến thư viện trường bao lâu một lần?",
      required: true,
      options: options("lib-q1", ["Hầu như mỗi ngày", "Vài lần mỗi tuần", "Vài lần mỗi tháng", "Hiếm khi"]),
    },
    {
      id: "lib-q2",
      order: 1,
      type: "multiple_choice",
      title: "Bạn thường dùng thư viện để làm gì?",
      required: true,
      options: options("lib-q2", ["Tự học", "Học nhóm", "Mượn sách, giáo trình", "Dùng máy tính, in ấn"]),
    },
    {
      id: "lib-q3",
      order: 2,
      type: "linear_scale",
      title: "Bạn hài lòng với không gian học tập của thư viện ở mức nào?",
      required: true,
      min: 1,
      max: 5,
      minLabel: "Rất không hài lòng",
      maxLabel: "Rất hài lòng",
    },
    {
      id: "lib-q4",
      order: 3,
      type: "rating",
      title: "Đánh giá chung của bạn về thư viện trường",
      required: true,
      maxRating: 5,
    },
    {
      id: "lib-q5",
      order: 4,
      type: "text",
      title: "Một điều bạn muốn thư viện cải thiện",
      required: false,
      maxLength: 200,
      placeholder: "Ví dụ: thêm ổ cắm điện",
    },
  ],
  [
    { id: "lib-s1", title: "Sử dụng thư viện", blockIds: ["lib-q1", "lib-q2"] },
    { id: "lib-s2", title: "Mức độ hài lòng", blockIds: ["lib-q3", "lib-q4", "lib-q5"] },
  ],
  { expectedEffortSeconds: 3 * 60, minTimeBarrierSeconds: 10 },
);

const studyStressSleep = define(
  [
    {
      id: "sleep-q1",
      order: 0,
      type: "single_choice",
      title: "Học kỳ này bạn đăng ký bao nhiêu tín chỉ?",
      required: true,
      options: options("sleep-q1", ["Dưới 15", "15 – 18", "19 – 22", "Trên 22"]),
    },
    {
      id: "sleep-q2",
      order: 1,
      type: "linear_scale",
      title: "Bạn cảm thấy áp lực học tập ở mức nào?",
      required: true,
      min: 1,
      max: 5,
      minLabel: "Không áp lực",
      maxLabel: "Rất áp lực",
    },
    {
      id: "sleep-q3",
      order: 2,
      type: "number",
      title: "Trung bình mỗi đêm bạn ngủ bao nhiêu giờ?",
      required: true,
      min: 0,
      max: 24,
      step: 0.5,
      placeholder: "Ví dụ: 6.5",
    },
    {
      id: "sleep-q4",
      order: 3,
      type: "single_choice",
      title: "Bạn thường đi ngủ lúc mấy giờ?",
      required: true,
      options: options("sleep-q4", ["Trước 22 giờ", "22 – 24 giờ", "0 – 2 giờ sáng", "Sau 2 giờ sáng"]),
    },
    {
      id: "sleep-q5",
      order: 4,
      type: "date",
      title: "Lần gần nhất bạn thức trắng đêm để học là ngày nào?",
      description: "Bỏ qua nếu bạn chưa từng thức trắng đêm.",
      required: false,
    },
    {
      id: "sleep-q6",
      order: 5,
      type: "multiple_choice",
      title: "Điều gì ảnh hưởng nhiều nhất đến giấc ngủ của bạn?",
      required: true,
      maxSelections: 2,
      options: options("sleep-q6", ["Bài tập, deadline", "Điện thoại, mạng xã hội", "Làm thêm", "Tiếng ồn nơi ở"]),
    },
    {
      id: "sleep-q7",
      order: 6,
      type: "rating",
      title: "Bạn chấm chất lượng giấc ngủ tuần qua bao nhiêu sao?",
      required: true,
      maxRating: 5,
    },
    {
      id: "sleep-q8",
      order: 7,
      type: "textarea",
      title: "Bạn muốn chia sẻ thêm điều gì về áp lực học tập?",
      required: false,
      maxLength: 500,
    },
  ],
  [
    { id: "sleep-s1", title: "Học tập", blockIds: ["sleep-q1", "sleep-q2"] },
    { id: "sleep-s2", title: "Giấc ngủ", blockIds: ["sleep-q3", "sleep-q4", "sleep-q5"] },
    { id: "sleep-s3", title: "Cảm nhận", blockIds: ["sleep-q6", "sleep-q7", "sleep-q8"] },
  ],
  { expectedEffortSeconds: 10 * 60, minTimeBarrierSeconds: 30 },
);

/**
 * "Nhu cầu nhà trọ gần trường" = the 8 questions of its published v1 as drawn in
 * Figma 10d / 10d' (63:3944, 63:2033). Phase 5C (results) reads them; v2 (17a)
 * derives from them in `form-versions.ts`.
 */
const housingNearCampus = define(
  [
    {
      id: "house-q1",
      order: 0,
      type: "single_choice",
      title: "Hiện bạn đang ở đâu?",
      required: true,
      options: options("house-q1", ["Nhà trọ", "Ký túc xá", "Nhà người thân", "Nhà riêng"]),
    },
    {
      id: "house-q2",
      order: 1,
      type: "single_choice",
      title: "Chỗ ở cách trường bao xa?",
      required: true,
      options: options("house-q2", ["Dưới 1 km", "1–3 km", "3–5 km", "Trên 5 km"]),
    },
    {
      id: "house-q3",
      order: 2,
      type: "single_choice",
      title: "Ngân sách cho chỗ ở mỗi tháng?",
      required: true,
      options: options("house-q3", [
        "Dưới 1,5 triệu đồng",
        "1,5–2,5 triệu đồng",
        "2,5–3,5 triệu đồng",
        "Trên 3,5 triệu đồng",
      ]),
    },
    {
      id: "house-q4",
      order: 3,
      type: "multiple_choice",
      title: "Yếu tố quan trọng khi chọn chỗ ở?",
      required: true,
      options: options("house-q4", ["Giá thuê", "An ninh", "Gần trường", "Tiện nghi", "Chủ trọ dễ tính"]),
    },
    {
      id: "house-q5",
      order: 4,
      type: "linear_scale",
      title: "Mức hài lòng với chỗ ở hiện tại",
      required: true,
      min: 1,
      max: 5,
      minLabel: "Rất không hài lòng",
      maxLabel: "Rất hài lòng",
    },
    {
      id: "house-q6",
      order: 5,
      type: "single_choice",
      title: "Bạn có sẵn sàng ở ghép không?",
      required: true,
      options: options("house-q6", ["Có", "Không", "Tuỳ người ở ghép"]),
    },
    {
      id: "house-q7",
      order: 6,
      type: "multiple_choice",
      title: "Bạn thường tìm chỗ ở qua kênh nào?",
      required: true,
      options: options("house-q7", ["Nhóm Facebook", "Người quen", "Ứng dụng, website", "Bảng tin trường"]),
    },
    {
      id: "house-q8",
      order: 7,
      type: "text",
      title: "Điều bạn muốn cải thiện nhất ở chỗ ở hiện tại?",
      required: true,
      maxLength: 200,
    },
  ],
  [
    { id: "house-s1", title: "Nơi ở hiện tại", blockIds: ["house-q1", "house-q2", "house-q3"] },
    { id: "house-s2", title: "Nhu cầu", blockIds: ["house-q4", "house-q5", "house-q6", "house-q7", "house-q8"] },
  ],
  { expectedEffortSeconds: 6 * 60, minTimeBarrierSeconds: 15 },
);

/**
 * Phase 6 moderation seed. Once the admin approves this INTERNAL survey it is
 * published into the marketplace, so it needs the same respondent-facing
 * content as the Phase 3 catalog seeds. The id mirrors
 * `MODERATION_SEED_FORM_IDS.canteenSatisfaction` without importing the admin
 * module into the participation data layer.
 */
const canteenSatisfactionId = "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f11";
const canteenSatisfaction = define(
  [
    {
      id: "canteen-q1",
      order: 0,
      type: "single_choice",
      title: "Bạn sử dụng căng tin trường bao lâu một lần?",
      required: true,
      options: options("canteen-q1", ["Hầu như mỗi ngày", "Vài lần mỗi tuần", "Vài lần mỗi tháng", "Hiếm khi"]),
      integrity: { semanticCategory: "BEHAVIORAL" },
    },
    {
      id: "canteen-q2",
      order: 1,
      type: "multiple_choice",
      title: "Bạn thường mua gì tại căng tin?",
      required: true,
      options: options("canteen-q2", ["Bữa chính", "Đồ ăn nhẹ", "Nước uống", "Đồ dùng học tập"]),
      integrity: { semanticCategory: "BEHAVIORAL" },
    },
    {
      id: "canteen-q3",
      order: 2,
      type: "linear_scale",
      title: "Bạn hài lòng với chất lượng món ăn ở mức nào?",
      required: true,
      min: 1,
      max: 5,
      minLabel: "Rất không hài lòng",
      maxLabel: "Rất hài lòng",
      integrity: { semanticCategory: "FEEDBACK" },
    },
    {
      id: "canteen-q4",
      order: 3,
      type: "linear_scale",
      title: "Mức giá tại căng tin phù hợp với sinh viên đến đâu?",
      required: true,
      min: 1,
      max: 5,
      minLabel: "Hoàn toàn không phù hợp",
      maxLabel: "Rất phù hợp",
      integrity: { semanticCategory: "FEEDBACK" },
    },
    {
      id: "canteen-q5",
      order: 4,
      type: "rating",
      title: "Bạn đánh giá mức độ sạch sẽ của căng tin bao nhiêu sao?",
      required: true,
      maxRating: 5,
      ratingShape: "STAR",
      integrity: { semanticCategory: "FEEDBACK" },
    },
    {
      id: "canteen-q6",
      order: 5,
      type: "single_choice",
      title: "Bạn thường phải chờ bao lâu để nhận món?",
      required: true,
      options: options("canteen-q6", ["Dưới 5 phút", "5 – 10 phút", "11 – 20 phút", "Trên 20 phút"]),
      integrity: { semanticCategory: "BEHAVIORAL" },
    },
    {
      id: "canteen-q7",
      order: 6,
      type: "multiple_choice",
      title: "Căng tin nên ưu tiên cải thiện điều gì?",
      required: true,
      maxSelections: 2,
      options: options("canteen-q7", ["Thực đơn đa dạng hơn", "Giá bán", "Vệ sinh", "Thời gian phục vụ", "Chỗ ngồi"]),
      integrity: { semanticCategory: "FEEDBACK" },
    },
    {
      id: "canteen-q8",
      order: 7,
      type: "textarea",
      title: "Bạn có đề xuất cụ thể nào cho căng tin?",
      required: false,
      maxLength: 500,
      placeholder: "Chia sẻ góp ý của bạn (không bắt buộc)",
      integrity: { semanticCategory: "FEEDBACK" },
    },
  ],
  [
    { id: "canteen-s1", title: "Thói quen sử dụng", blockIds: ["canteen-q1", "canteen-q2"] },
    {
      id: "canteen-s2",
      title: "Mức độ hài lòng",
      blockIds: ["canteen-q3", "canteen-q4", "canteen-q5", "canteen-q6"],
    },
    { id: "canteen-s3", title: "Góp ý cải thiện", blockIds: ["canteen-q7", "canteen-q8"] },
  ],
  { expectedEffortSeconds: 4 * 60, minTimeBarrierSeconds: 15 },
);

/**
 * "Hiệu quả của việc học nhóm" = the published v1 blocks of the analytics seed
 * (`GROUP_STUDY_BLOCKS`, already validated there), so its answers line up
 * with the publisher's Câu trả lời screens.
 */
const groupStudy: MockSurveyContent = {
  blocks: GROUP_STUDY_BLOCKS,
  sections: [
    { id: "gs-s1", title: "Thói quen học nhóm", blockIds: ["gs-freq", "gs-place"] },
    { id: "gs-s2", title: "Hiệu quả", blockIds: ["gs-help", "gs-size", "gs-why"] },
  ],
  metadata: { expectedEffortSeconds: GROUP_STUDY_EFFORT_SECONDS, minTimeBarrierSeconds: 15 },
};

const CONTENT: Record<string, MockSurveyContent> = {
  [SURVEY_IDS.onlineShopping]: onlineShopping,
  [SURVEY_IDS.librarySatisfaction]: librarySatisfaction,
  [SURVEY_IDS.studyStressSleep]: studyStressSleep,
  [SURVEY_IDS.housingNearCampus]: housingNearCampus,
  [SURVEY_IDS.groupStudy]: groupStudy,
  [canteenSatisfactionId]: canteenSatisfaction,
};

/**
 * Seeded content, else the definition of a survey made in the Form Builder
 * (`formDrafts`): once the Admin approves it, respondents open it through
 * `GET /public/forms/:id` like any seeded survey.
 */
export function surveyContentOf(surveyId: string): MockSurveyContent | undefined {
  const seeded = CONTENT[surveyId];
  if (seeded) return seeded;
  const schema = findFormDraft(surveyId)?.schema;
  if (!schema) return undefined;
  return {
    blocks: [...schema.blocks].sort((a, b) => a.order - b.order),
    sections: (schema.sections ?? []).map((section) => ({
      id: section.id,
      title: section.title,
      blockIds: [...section.blockIds],
    })),
    metadata: {
      expectedEffortSeconds: schema.metadata.expectedEffortSeconds,
      minTimeBarrierSeconds: schema.metadata.minTimeBarrierSeconds ?? 15,
    },
  };
}

/** `GET /public/forms/:id` payload (`publicFormDetailsSchema` + ASSUMED `sections`). */
export function publicFormOf(survey: MockSurvey, content: MockSurveyContent) {
  return {
    id: survey.id,
    title: survey.title,
    description: survey.description,
    type: "INTERNAL" as const,
    versionNumber: survey.versionNumber,
    blocks: content.blocks,
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: false,
      allowPublicAccess: true,
      submitButtonText: "Nộp bài",
    },
    metadata: content.metadata,
    publicUrl: `/forms/${survey.id}/respond`,
    publishedAt: survey.publishedAt,
    sections: content.sections,
  };
}
