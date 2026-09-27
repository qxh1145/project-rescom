import type {
  MockUser,
  MockSurvey,
  MockStoreState,
  MockOnboardingDraft,
  MockNotification,
  MockTopUpOptions,
} from "./types";
import type {
  DemographicProfileDto,
  WalletBalanceDto,
  WalletTransactionItemDto,
} from "@rescom/schemas";

/**
 * Story 7.2: starter points of not-yet-activated demo users expire 30 days
 * after registration (FR-5). Their registration dates are relative to "now"
 * so the demo (and the tests) never silently cross that deadline.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
const NEW_USER_REGISTERED_AT = daysAgoIso(6);
const INCOMPLETE_USER_REGISTERED_AT = daysAgoIso(4);

export const MOCK_NEW_USER: MockUser = {
  id: "user-new-001",
  email: "student@fpt.edu.vn",
  name: "Nguyễn Văn Mới",
  role: "RESPONDENT",
  isOnboarded: false,
  isActivated: false,
  hasUnlockedFrozenPoints: false,
  streak: 0,
  completedSurveyIds: [],
  createdAt: NEW_USER_REGISTERED_AT,
};

export const MOCK_ACTIVATED_USER: MockUser = {
  id: "user-active-002",
  email: "minh.le@fpt.edu.vn",
  name: "Lê Nhật Minh",
  role: "RESPONDENT",
  isOnboarded: true,
  isActivated: true,
  hasUnlockedFrozenPoints: true,
  activatedAt: "2026-09-15T11:00:00.000Z",
  streak: 3,
  completedSurveyIds: ["survey-int-001"],
  createdAt: "2026-09-15T09:30:00.000Z",
};

export const MOCK_ACTIVATED_DEMOGRAPHICS: DemographicProfileDto = {
  userId: "user-active-002",
  age: 21,
  gender: "MALE",
  location: "Đà Nẵng",
  // Code review P9: values from the wizard catalogs (`lib/demographic-options.ts`).
  occupation: "Sinh viên đại học",
  fieldOfStudy: "Công nghệ thông tin",
  householdIncome: "5 - 10 triệu VNĐ/tháng",
  specificInterests: ["Trí tuệ nhân tạo (AI)", "Công nghệ & Lập trình", "Nghiên cứu khoa học"],
  createdAt: "2026-09-15T10:00:00.000Z",
  updatedAt: "2026-09-15T10:00:00.000Z",
};

export const MOCK_INCOMPLETE_USER: MockUser = {
  id: "user-onboarding-003",
  email: "linh.onboarding@fpt.edu.vn",
  name: "Trần Mai Linh",
  role: "RESPONDENT",
  isOnboarded: false,
  isActivated: false,
  hasUnlockedFrozenPoints: false,
  streak: 0,
  completedSurveyIds: [],
  createdAt: INCOMPLETE_USER_REGISTERED_AT,
};

/** Phase 6 admin console demo account (Figma 11 "Admin Hùng"). Mock login ignores the password. */
export const MOCK_ADMIN_USER: MockUser = {
  id: "user-admin-004",
  email: "admin@rescom.vn",
  name: "Hùng Nguyễn",
  role: "ADMIN",
  isOnboarded: true,
  isActivated: true,
  hasUnlockedFrozenPoints: true,
  streak: 0,
  completedSurveyIds: [],
  createdAt: "2026-08-01T08:00:00.000Z",
};

export const MOCK_INCOMPLETE_DRAFT: MockOnboardingDraft = {
  step: 2,
  answers: {
    age: 20,
    gender: "FEMALE",
    location: "Hà Nội",
  },
  updatedAt: "2026-09-22T14:20:00.000Z",
};

export const MOCK_SURVEYS: Record<string, MockSurvey> = {
  "survey-int-001": {
    id: "survey-int-001",
    publisherId: "pub-001",
    publisherName: "CLB Nghiên cứu Khoa học FPT",
    title: "Khảo sát thói quen học tập và sử dụng AI của sinh viên",
    description:
      "Nghiên cứu về mức độ ứng dụng ChatGPT và các công cụ trợ lý AI trong học tập của sinh viên đại học khối ngành Công nghệ & Kinh tế.",
    type: "INTERNAL",
    status: "PUBLISHED",
    rewardPerResponse: 15,
    expectedCompletions: 50,
    completedCompletions: 28,
    estimatedEffortSeconds: 180,
    minTimeBarrierSeconds: 5,
    versionNumber: 1,
    currentVersionId: "ver-int-001",
    publishedAt: "2026-09-18T10:00:00.000Z",
    hasTargeting: true,
    targetingJson: {
      ageRange: { min: 18, max: 26 },
      locations: ["Đà Nẵng", "Hà Nội", "TP. Hồ Chí Minh"],
      occupations: ["Sinh viên", "Sinh viên đại học"],
      fieldOfStudy: [
        "Công nghệ thông tin",
        "Kinh tế",
        "Kỹ thuật",
        "Kinh tế & Quản trị kinh doanh",
      ],
    },
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: true,
      allowPublicAccess: true,
      submitButtonText: "Nộp bài khảo sát",
    },
    metadata: {
      expectedEffortSeconds: 180,
      minTimeBarrierSeconds: 5,
    },
    blocks: [
      {
        id: "b-int1-1",
        type: "single_choice",
        order: 1,
        title: "Bạn hiện đang là sinh viên năm thứ mấy?",
        description: "Chọn một đáp án phù hợp nhất với bạn",
        required: true,
        allowOther: false,
        options: [
          { id: "opt-1-1", label: "Sinh viên năm 1", value: "nam_1" },
          { id: "opt-1-2", label: "Sinh viên năm 2", value: "nam_2" },
          { id: "opt-1-3", label: "Sinh viên năm 3", value: "nam_3" },
          { id: "opt-1-4", label: "Sinh viên năm 4 hoặc tốt nghiệp", value: "nam_4_plus" },
        ],
      },
      {
        id: "b-int1-2",
        type: "multiple_choice",
        order: 2,
        title: "Bạn thường xuyên sử dụng các công cụ AI nào dưới đây cho việc học?",
        description: "Có thể chọn nhiều đáp án",
        required: true,
        allowOther: true,
        options: [
          { id: "opt-2-1", label: "ChatGPT (OpenAI)", value: "chatgpt" },
          { id: "opt-2-2", label: "Claude (Anthropic)", value: "claude" },
          { id: "opt-2-3", label: "Google Gemini", value: "gemini" },
          { id: "opt-2-4", label: "GitHub Copilot / Cursor", value: "copilot" },
        ],
      },
      {
        id: "b-int1-3",
        type: "rating",
        order: 3,
        title: "Đánh giá mức độ hữu ích của AI đối với việc giải bài tập và nghiên cứu (1 - 5 sao):",
        required: true,
        maxRating: 5,
        ratingShape: "STAR",
      },
      {
        id: "b-int1-4",
        type: "textarea",
        order: 4,
        title: "Chia sẻ ngắn về một tình huống bạn thấy AI giúp bạn tiết kiệm thời gian nhất:",
        description: "Tùy chọn, tối đa 500 ký tự",
        required: false,
        placeholder: "Ví dụ: Tóm tắt bài báo khoa học, giải thích lỗi code, gợi ý ý tưởng thuyết trình...",
        maxLength: 500,
      },
    ],
  },
  "survey-int-002": {
    id: "survey-int-002",
    publisherId: "pub-002",
    publisherName: "Ban Quản lý Ký túc xá",
    title: "Khảo sát chất lượng dịch vụ ăn uống và đời sống ký túc xá",
    description:
      "Thu thập ý kiến đóng góp của sinh viên nhằm nâng cao chất lượng phục vụ tại căng-tin và các tiện ích sinh hoạt nội trú.",
    type: "INTERNAL",
    status: "PUBLISHED",
    rewardPerResponse: 10,
    expectedCompletions: 100,
    completedCompletions: 64,
    estimatedEffortSeconds: 120,
    minTimeBarrierSeconds: 4,
    versionNumber: 1,
    currentVersionId: "ver-int-002",
    publishedAt: "2026-09-19T08:30:00.000Z",
    hasTargeting: false,
    targetingJson: null,
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: true,
      allowPublicAccess: true,
      submitButtonText: "Gửi ý kiến đóng góp",
    },
    metadata: {
      expectedEffortSeconds: 120,
      minTimeBarrierSeconds: 4,
    },
    blocks: [
      {
        id: "b-int2-1",
        type: "single_choice",
        order: 1,
        title: "Tần suất bạn dùng bữa tại căng-tin trường học là bao nhiêu?",
        required: true,
        allowOther: false,
        options: [
          { id: "opt-21-1", label: "Hàng ngày (từ 2 bữa trở lên)", value: "daily" },
          { id: "opt-21-2", label: "3 - 4 lần / tuần", value: "often" },
          { id: "opt-21-3", label: "1 - 2 lần / tuần", value: "sometimes" },
          { id: "opt-21-4", label: "Hiếm khi hoặc không bao giờ", value: "never" },
        ],
      },
      {
        id: "b-int2-2",
        type: "linear_scale",
        order: 2,
        title: "Mức độ hài lòng của bạn về mức giá và vệ sinh an toàn thực phẩm:",
        required: true,
        min: 1,
        max: 5,
        minLabel: "Rất không hài lòng",
        maxLabel: "Rất hài lòng",
        step: 1,
      },
      {
        id: "b-int2-3",
        type: "text",
        order: 3,
        title: "Món ăn hoặc dịch vụ bạn muốn bổ sung thêm tại căng-tin:",
        required: false,
        placeholder: "Ví dụ: Thêm đồ uống ít đường, quầy thức ăn nhanh buổi tối...",
      },
    ],
  },
  "survey-int-003": {
    id: "survey-int-003",
    publisherId: "pub-003",
    publisherName: "Khoa Tâm lý học Đường",
    title: "Nghiên cứu áp lực thi cử và sức khỏe tinh thần của sinh viên",
    description:
      "Tìm hiểu các yếu tố gây căng thẳng trong kỳ thi và đề xuất giải pháp cải thiện môi trường học đường hỗ trợ tâm lý sinh viên.",
    type: "INTERNAL",
    status: "PUBLISHED",
    rewardPerResponse: 25,
    expectedCompletions: 40,
    completedCompletions: 12,
    estimatedEffortSeconds: 300,
    minTimeBarrierSeconds: 5,
    versionNumber: 1,
    currentVersionId: "ver-int-003",
    publishedAt: "2026-09-21T11:00:00.000Z",
    hasTargeting: false,
    targetingJson: null,
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: true,
      allowPublicAccess: true,
      submitButtonText: "Nộp khảo sát",
    },
    metadata: {
      expectedEffortSeconds: 300,
      minTimeBarrierSeconds: 5,
    },
    blocks: [
      {
        id: "b-int3-1",
        type: "single_choice",
        order: 1,
        title: "Bạn thường gặp mức độ căng thẳng như thế nào trong tuần thi cuối kỳ?",
        required: true,
        allowOther: false,
        options: [
          { id: "opt-31-1", label: "Rất ít / Không đáng kể", value: "low" },
          { id: "opt-31-2", label: "Bình thường / Có kiểm soát", value: "medium" },
          { id: "opt-31-3", label: "Khá căng thẳng, ảnh hưởng giấc ngủ", value: "high" },
          { id: "opt-31-4", label: "Rất kiệt sức và lo âu kéo dài", value: "severe" },
        ],
      },
      {
        id: "b-int3-2",
        type: "multiple_choice",
        order: 2,
        title: "Phương pháp bạn thường áp dụng để cân bằng lại tinh thần:",
        required: true,
        allowOther: true,
        options: [
          { id: "opt-32-1", label: "Tập thể dục, chạy bộ, gym", value: "exercise" },
          { id: "opt-32-2", label: "Trò chuyện với bạn bè, người thân", value: "talk" },
          { id: "opt-32-3", label: "Nghe nhạc, xem phim giải trí", value: "entertainment" },
          { id: "opt-32-4", label: "Ngủ đủ giấc và nghỉ ngơi", value: "sleep" },
        ],
      },
      {
        id: "b-int3-3",
        type: "rating",
        order: 3,
        title: "Đánh giá mức độ cần thiết của phòng tư vấn tâm lý sinh viên tại trường (1 - 5 sao):",
        required: true,
        maxRating: 5,
        ratingShape: "STAR",
      },
    ],
  },
  "survey-ext-001": {
    id: "survey-ext-001",
    publisherId: "pub-004",
    publisherName: "Nhóm Khóa luận Marketing K16",
    title: "Nghiên cứu hành vi tiêu dùng xanh của giới trẻ (Google Forms)",
    description:
      "Khảo sát đề tài khóa luận tốt nghiệp về xu hướng chọn mua các sản phẩm thân thiện với môi trường của sinh viên đại học.",
    type: "EXTERNAL",
    status: "PUBLISHED",
    rewardPerResponse: 20,
    expectedCompletions: 80,
    completedCompletions: 45,
    estimatedEffortSeconds: 240,
    minTimeBarrierSeconds: 10,
    versionNumber: 1,
    currentVersionId: "ver-ext-001",
    publishedAt: "2026-09-17T15:00:00.000Z",
    externalUrl: "https://docs.google.com/forms/d/e/1FAIpQLSc_demo_rescom_green_consumption/viewform",
    completionCode: "689201",
    hasTargeting: true,
    targetingJson: {
      ageRange: { min: 18, max: 28 },
      locations: ["Đà Nẵng", "Hà Nội", "TP. Hồ Chí Minh"],
    },
  },
  "survey-ext-002": {
    id: "survey-ext-002",
    publisherId: "pub-005",
    publisherName: "Trung tâm Hướng nghiệp & Việc làm",
    title: "Đánh giá nhu cầu thực tập và việc làm ngành Marketing (Google Forms)",
    description:
      "Khảo sát dành cho sinh viên chuẩn bị đi thực tập doanh nghiệp về kỹ năng chuyên môn, kỹ năng mềm và kỳ vọng đãi ngộ.",
    type: "EXTERNAL",
    status: "PUBLISHED",
    rewardPerResponse: 15,
    expectedCompletions: 60,
    completedCompletions: 19,
    estimatedEffortSeconds: 180,
    minTimeBarrierSeconds: 8,
    versionNumber: 1,
    currentVersionId: "ver-ext-002",
    publishedAt: "2026-09-20T16:00:00.000Z",
    externalUrl: "https://docs.google.com/forms/d/e/1FAIpQLSd_demo_rescom_marketing_internship/viewform",
    completionCode: "202614",
    hasTargeting: true,
    targetingJson: {
      fieldOfStudy: ["Kinh tế", "Marketing", "Quản trị kinh doanh"],
    },
  },
};

export const MOCK_WALLETS: Record<string, WalletBalanceDto> = {
  "user-new-001": {
    available: 0,
    pending: 0,
    escrow: 0,
    frozen: 100,
    integrityHold: 0,
    total: 100,
  },
  "user-active-002": {
    available: 115,
    pending: 20,
    escrow: 0,
    frozen: 0,
    integrityHold: 0,
    total: 135,
  },
  "user-onboarding-003": {
    available: 0,
    pending: 0,
    escrow: 0,
    frozen: 100,
    integrityHold: 0,
    total: 100,
  },
};

export const MOCK_TRANSACTIONS: Record<string, WalletTransactionItemDto[]> = {
  "user-new-001": [
    {
      id: "tx-new-001",
      journalId: "j-new-001",
      amount: 100,
      accountClass: "FROZEN",
      description: "Điểm thưởng chào mừng thành viên mới (Mở khóa sau khi hoàn tất hồ sơ và 1 khảo sát)",
      idempotencyKey: "idem-welcome-new-001",
      createdAt: NEW_USER_REGISTERED_AT,
      reversesJournalId: null,
    },
  ],
  "user-active-002": [
    {
      id: "tx-act-001",
      journalId: "j-act-001",
      amount: 100,
      accountClass: "FROZEN",
      description: "Điểm thưởng tân thủ ban đầu",
      idempotencyKey: "idem-welcome-act-002",
      createdAt: "2026-09-15T09:30:00.000Z",
      reversesJournalId: null,
    },
    {
      id: "tx-act-002",
      journalId: "j-act-002",
      amount: -100,
      accountClass: "FROZEN",
      description: "Mở khóa điểm tân thủ (chuyển sang Khả dụng)",
      idempotencyKey: "idem-unlock-act-002",
      createdAt: "2026-09-15T11:00:00.000Z",
      reversesJournalId: null,
    },
    {
      id: "tx-act-003",
      journalId: "j-act-002",
      amount: 100,
      accountClass: "USER_AVAILABLE",
      description: "Mở khóa 100 điểm tân thủ thành công",
      idempotencyKey: "idem-unlock-credit-act-002",
      createdAt: "2026-09-15T11:00:00.000Z",
      reversesJournalId: null,
    },
    {
      id: "tx-act-004",
      journalId: "j-act-003",
      amount: 15,
      accountClass: "USER_AVAILABLE",
      description: "Thưởng khảo sát nội bộ: Khảo sát thói quen học tập và sử dụng AI của sinh viên",
      idempotencyKey: "idem-reward-int-001",
      createdAt: "2026-09-15T11:05:00.000Z",
      reversesJournalId: null,
    },
    {
      id: "tx-act-005",
      journalId: "j-act-004",
      amount: 20,
      accountClass: "PENDING",
      description: "Thưởng khảo sát ngoài (Google Forms): Nghiên cứu hành vi tiêu dùng xanh (Chờ duyệt 48h)",
      idempotencyKey: "idem-reward-ext-001",
      createdAt: "2026-09-23T14:00:00.000Z",
      reversesJournalId: null,
    },
  ],
  "user-onboarding-003": [
    {
      id: "tx-incomp-001",
      journalId: "j-incomp-001",
      amount: 100,
      accountClass: "FROZEN",
      description: "Điểm thưởng chào mừng thành viên mới (Khóa đến khi kích hoạt)",
      idempotencyKey: "idem-welcome-incomp-003",
      createdAt: INCOMPLETE_USER_REGISTERED_AT,
      reversesJournalId: null,
    },
  ],
};

export const MOCK_NOTIFICATIONS: Record<string, MockNotification[]> = {
  "user-active-002": [
    {
      id: "a1b2c3d4-0000-4000-8000-000000000001",
      userId: "user-active-002",
      type: "ACCOUNT_ACTIVATED",
      message:
        "Chúc mừng! 100 điểm tân thủ đã được mở khóa và chuyển vào số dư Khả dụng của bạn.",
      isRead: true,
      createdAt: "2026-09-15T11:00:00.000Z",
      readAt: "2026-09-15T11:05:00.000Z",
      dedupeKey: "starter-unlock:user-active-002",
    },
    {
      id: "a1b2c3d4-0000-4000-8000-000000000002",
      userId: "user-active-002",
      type: "REWARD_PENDING",
      message:
        "+20 điểm từ khảo sát \"Nghiên cứu hành vi tiêu dùng xanh của giới trẻ (Google Forms)\" đang chờ đối soát 48 giờ trước khi chuyển sang số dư Khả dụng.",
      isRead: false,
      createdAt: "2026-09-23T14:00:00.000Z",
      readAt: null,
      dedupeKey: "external-completion:att-seed-ext-001",
    },
  ],
};

/**
 * Demo platform bank account for manual top-ups (Story 6.6). Mirrors the
 * backend `TOPUP_BANK_*` development defaults; it is a placeholder, not a real
 * account, so the demo never asks anyone to transfer real money.
 */
export const MOCK_TOP_UP_BANK: MockTopUpOptions["bank"] = {
  bankName: "Vietcombank",
  bankBin: "970436",
  accountNumber: "0000000000",
  accountName: "RESCOM DEMO",
};

export function createInitialStoreState(): MockStoreState {
  return {
    currentUserId: "user-new-001",
    users: {
      "user-new-001": { ...MOCK_NEW_USER },
      "user-active-002": { ...MOCK_ACTIVATED_USER },
      "user-onboarding-003": { ...MOCK_INCOMPLETE_USER },
      "user-admin-004": { ...MOCK_ADMIN_USER },
    },
    demographics: {
      "user-active-002": { ...MOCK_ACTIVATED_DEMOGRAPHICS },
    },
    surveys: { ...MOCK_SURVEYS },
    attempts: {},
    wallets: { ...MOCK_WALLETS },
    transactions: { ...MOCK_TRANSACTIONS },
    onboardingDrafts: {
      "user-onboarding-003": { ...MOCK_INCOMPLETE_DRAFT },
    },
    notifications: Object.fromEntries(
      Object.entries(MOCK_NOTIFICATIONS).map(([userId, list]) => [
        userId,
        list.map((notification) => ({ ...notification })),
      ]),
    ),
    topUpRequests: {},
    surveyFeedback: {},
  };
}
