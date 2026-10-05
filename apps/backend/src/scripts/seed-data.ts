import type {
  DraftFormDefinitionInput,
  FormBlockInput,
  SubmitDemographicSurveyInput,
  SubmitSurveyFeedbackInput,
  SurveyTargetingCriteria,
} from '@rescom/schemas';

/**
 * Static content of the go-live demo seed (`src/scripts/seed.ts`): accounts,
 * Vietnamese surveys and deterministic answer generators. Every value goes
 * through the application services, so it must satisfy the shared schemas
 * (form blocks, publishability, FR-14 pricing bands, demographic survey).
 */

export const SEED_EMAIL_DOMAIN = 'rescom.test';

export interface SeedPublisher {
  key: 'lan' | 'huy' | 'trang';
  email: string;
  displayName: string;
  /** Approved top-ups (Points) that fund the publisher's Escrow. */
  approvedTopUps: number[];
  pendingTopUps: number[];
  rejectedTopUps: number[];
  registeredDaysAgo: number;
}

export const PUBLISHERS: SeedPublisher[] = [
  {
    key: 'lan',
    email: `lan.nguyen.gv@${SEED_EMAIL_DOMAIN}`,
    displayName: 'ThS. Nguyễn Thị Lan (Giảng viên Kinh tế)',
    approvedTopUps: [1000, 1000],
    pendingTopUps: [],
    rejectedTopUps: [],
    registeredDaysAgo: 21,
  },
  {
    key: 'huy',
    email: `huy.tran.research@${SEED_EMAIL_DOMAIN}`,
    displayName: 'Trần Minh Huy (Nhóm nghiên cứu CNTT)',
    approvedTopUps: [2000],
    pendingTopUps: [],
    rejectedTopUps: [],
    registeredDaysAgo: 20,
  },
  {
    key: 'trang',
    email: `trang.le.marketing@${SEED_EMAIL_DOMAIN}`,
    displayName: 'Lê Thu Trang (CLB Marketing)',
    approvedTopUps: [500],
    pendingTopUps: [300],
    rejectedTopUps: [1000],
    registeredDaysAgo: 19,
  },
];

export type RespondentActivity =
  /** Demographics done and completes surveys (starter points unlocked). */
  | 'ACTIVE'
  /** Demographics done, no completed survey yet (starter points Frozen). */
  | 'PROFILE_ONLY'
  /** Just registered: no demographic survey (onboarding pending). */
  | 'NEW';

export interface SeedRespondent {
  key: string;
  email: string;
  displayName: string;
  activity: RespondentActivity;
  registeredDaysAgo: number;
  demographics?: SubmitDemographicSurveyInput;
}

function respondent(
  key: string,
  displayName: string,
  activity: RespondentActivity,
  registeredDaysAgo: number,
  demographics?: SubmitDemographicSurveyInput,
): SeedRespondent {
  return {
    key,
    email: `${key}@${SEED_EMAIL_DOMAIN}`,
    displayName,
    activity,
    registeredDaysAgo,
    demographics,
  };
}

export const RESPONDENTS: SeedRespondent[] = [
  respondent('minhanh.nguyen', 'Nguyễn Minh Anh', 'ACTIVE', 18, {
    age: 20,
    gender: 'FEMALE',
    location: 'Đà Nẵng',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Công nghệ thông tin',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: [
      'Trí tuệ nhân tạo (AI)',
      'Công nghệ & Lập trình',
      'Phim ảnh & Giải trí',
    ],
  }),
  respondent('quocbao.pham', 'Phạm Quốc Bảo', 'ACTIVE', 18, {
    age: 21,
    gender: 'MALE',
    location: 'Hà Nội',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Kinh tế & Quản trị kinh doanh',
    householdIncome: '5 - 10 triệu VNĐ/tháng',
    specificInterests: ['Khởi nghiệp & Kinh doanh', 'Tài chính & Đầu tư'],
  }),
  respondent('thuha.vo', 'Võ Thu Hà', 'ACTIVE', 17, {
    age: 19,
    gender: 'FEMALE',
    location: 'TP. Hồ Chí Minh',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Marketing & Truyền thông',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: [
      'Marketing & Mạng xã hội',
      'Thời trang & Làm đẹp',
      'Du lịch & Ẩm thực',
    ],
  }),
  respondent('ducthang.le', 'Lê Đức Thắng', 'ACTIVE', 17, {
    age: 22,
    gender: 'MALE',
    location: 'Thừa Thiên Huế',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Kỹ thuật & Kiến trúc',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: [
      'Thể thao & Rèn luyện sức khỏe',
      'Trò chơi điện tử & Thể thao điện tử',
    ],
  }),
  respondent('ngocanh.dang', 'Đặng Ngọc Ánh', 'ACTIVE', 16, {
    age: 24,
    gender: 'FEMALE',
    location: 'Đà Nẵng',
    occupation: 'Nhân viên văn phòng',
    fieldOfStudy: 'Ngôn ngữ & Khoa học xã hội',
    householdIncome: '10 - 20 triệu VNĐ/tháng',
    specificInterests: ['Du lịch & Ẩm thực', 'Nghệ thuật & Âm nhạc'],
  }),
  respondent('hoanglong.bui', 'Bùi Hoàng Long', 'ACTIVE', 16, {
    age: 27,
    gender: 'MALE',
    location: 'TP. Hồ Chí Minh',
    occupation: 'Lao động tự do (Freelancer)',
    fieldOfStudy: 'Thiết kế đồ họa & Mỹ thuật đa phương tiện',
    householdIncome: '10 - 20 triệu VNĐ/tháng',
    specificInterests: ['Nghệ thuật & Âm nhạc', 'Công nghệ & Lập trình'],
  }),
  respondent('thanhtruc.huynh', 'Huỳnh Thanh Trúc', 'ACTIVE', 15, {
    age: 20,
    gender: 'FEMALE',
    location: 'Cần Thơ',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Y sinh & Sức khỏe',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: [
      'Sức khỏe tinh thần',
      'Tình nguyện & Hoạt động cộng đồng',
    ],
  }),
  respondent('vankhoa.ngo', 'Ngô Văn Khoa', 'ACTIVE', 15, {
    age: 23,
    gender: 'MALE',
    location: 'Quảng Nam',
    occupation: 'Học viên sau đại học',
    fieldOfStudy: 'Công nghệ thông tin',
    householdIncome: '5 - 10 triệu VNĐ/tháng',
    specificInterests: ['Trí tuệ nhân tạo (AI)', 'Nghiên cứu khoa học'],
  }),
  respondent('phuonglinh.do', 'Đỗ Phương Linh', 'ACTIVE', 14, {
    age: 21,
    gender: 'FEMALE',
    location: 'Hải Phòng',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Kinh tế & Quản trị kinh doanh',
    householdIncome: 'Không chia sẻ',
    specificInterests: [
      'Tài chính & Đầu tư',
      'Tiêu dùng xanh & Bảo vệ môi trường',
    ],
  }),
  respondent('giahuy.truong', 'Trương Gia Huy', 'ACTIVE', 14, {
    age: 18,
    gender: 'MALE',
    location: 'Bình Dương',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Công nghệ thông tin',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: [
      'Trò chơi điện tử & Thể thao điện tử',
      'Công nghệ & Lập trình',
    ],
  }),
  respondent('mylinh.phan', 'Phan Mỹ Linh', 'ACTIVE', 14, {
    age: 32,
    gender: 'FEMALE',
    location: 'Hà Nội',
    occupation: 'Giảng viên / Nghiên cứu viên',
    fieldOfStudy: 'Ngôn ngữ & Khoa học xã hội',
    householdIncome: 'Trên 20 triệu VNĐ/tháng',
    specificInterests: ['Giáo dục & Kỹ năng học tập', 'Nghiên cứu khoa học'],
  }),
  respondent('tuankiet.ly', 'Lý Tuấn Kiệt', 'ACTIVE', 13, {
    age: 26,
    gender: 'MALE',
    location: 'Khánh Hòa',
    occupation: 'Nhân viên văn phòng',
    fieldOfStudy: 'Marketing & Truyền thông',
    householdIncome: '10 - 20 triệu VNĐ/tháng',
    specificInterests: [
      'Du lịch & Ẩm thực',
      'Thể thao & Rèn luyện sức khỏe',
      'Việc làm & Phát triển sự nghiệp',
    ],
  }),
  respondent('baotran.vu', 'Vũ Bảo Trân', 'ACTIVE', 6, {
    age: 22,
    gender: 'FEMALE',
    location: 'Đồng Nai',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Marketing & Truyền thông',
    householdIncome: '5 - 10 triệu VNĐ/tháng',
    specificInterests: ['Thời trang & Làm đẹp', 'Marketing & Mạng xã hội'],
  }),
  respondent('khanhvy.cao', 'Cao Khánh Vy', 'PROFILE_ONLY', 3, {
    age: 20,
    gender: 'FEMALE',
    location: 'Nghệ An',
    occupation: 'Sinh viên đại học',
    fieldOfStudy: 'Ngôn ngữ & Khoa học xã hội',
    householdIncome: 'Dưới 5 triệu VNĐ/tháng',
    specificInterests: ['Giáo dục & Kỹ năng học tập', 'Phim ảnh & Giải trí'],
  }),
  respondent('duyanh.mai', 'Mai Duy Anh', 'NEW', 1),
];

// ---------------------------------------------------------------------------
// Block builders (compact Vietnamese question definitions)
// ---------------------------------------------------------------------------

type Pair = [value: string, label: string];

function options(pairs: Pair[]) {
  return pairs.map(([value, label], index) => ({
    id: `opt-${index + 1}`,
    label,
    value,
  }));
}

function single(
  id: string,
  title: string,
  pairs: Pair[],
  extra: Partial<FormBlockInput> = {},
): FormBlockInput {
  return {
    id,
    order: 0,
    type: 'single_choice',
    title,
    required: true,
    options: options(pairs),
    ...extra,
  } as FormBlockInput;
}

function multiple(
  id: string,
  title: string,
  pairs: Pair[],
  extra: Partial<FormBlockInput> = {},
): FormBlockInput {
  return {
    id,
    order: 0,
    type: 'multiple_choice',
    title,
    required: true,
    options: options(pairs),
    minSelections: 1,
    ...extra,
  } as FormBlockInput;
}

function block(input: Omit<FormBlockInput, 'order'>): FormBlockInput {
  return { order: 0, required: true, ...input } as FormBlockInput;
}

/** Assigns sequential `order` values (required by the Form Definition). */
function ordered(blocks: FormBlockInput[]): FormBlockInput[] {
  return blocks.map((item, index) => ({ ...item, order: index }));
}

function definition(
  title: string,
  description: string,
  blocks: FormBlockInput[],
  estimatedDurationMinutes: number,
): DraftFormDefinitionInput {
  return {
    schemaVersion: 1,
    title,
    description,
    blocks: ordered(blocks),
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: false,
      allowPublicAccess: true,
      submitButtonText: 'Gửi câu trả lời',
    },
    metadata: {
      expectedEffortSeconds: estimatedDurationMinutes * 60,
      minTimeBarrierSeconds: 30,
    },
  } as DraftFormDefinitionInput;
}

// ---------------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------------

export type SurveyScenario =
  /** Published and answered. */
  | 'PUBLISHED'
  /** Published, answered, then closed by its owner (Escrow refunded). */
  | 'OWNER_CLOSED'
  /** Submitted for publication, waiting in the Admin moderation queue. */
  | 'MODERATION_QUEUE'
  /** Submitted and rejected by the Admin (Escrow refunded). */
  | 'REJECTED'
  /** Never submitted. */
  | 'DRAFT';

export interface SeedInternalSurvey {
  key: string;
  type: 'INTERNAL';
  publisher: SeedPublisher['key'];
  scenario: SurveyScenario;
  title: string;
  description: string;
  rewardPerResponse: number;
  expectedCompletions: number;
  estimatedDurationMinutes: number;
  targeting?: SurveyTargetingCriteria;
  schema: DraftFormDefinitionInput;
  /** Respondent keys that complete the survey, in order. */
  respondents: string[];
  /** Days before the seed run the survey went live (timeline backdating). */
  publishedDaysAgo: number;
  closedDaysAgo?: number;
  moderationNote?: string;
  rejectionReason?: string;
  closeReason?: string;
  answers?: (profile: AnswerProfile, rng: Rng) => Record<string, unknown>;
}

export interface SeedExternalSurvey {
  key: string;
  type: 'EXTERNAL';
  publisher: SeedPublisher['key'];
  scenario: 'PUBLISHED';
  title: string;
  description: string;
  externalUrl: string;
  rewardPerResponse: number;
  expectedCompletions: number;
  estimatedDurationMinutes: number;
  idempotencyKey: string;
  respondents: string[];
  publishedDaysAgo: number;
  moderationNote?: string;
}

export type SeedSurvey = SeedInternalSurvey | SeedExternalSurvey;

export interface AnswerProfile {
  age: number;
  gender: string;
  occupation: string;
  fieldOfStudy: string;
  isStudent: boolean;
}

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  pickSome<T>(items: readonly T[], min: number, max: number): T[];
  chance(probability: number): boolean;
}

/** Deterministic PRNG (mulberry32) so re-seeding a fresh DB is reproducible. */
export function createRng(seedText: string): Rng {
  let state = 0;
  for (const char of seedText) {
    state = (Math.imul(state ^ char.charCodeAt(0), 2654435761) >>> 0) + 1;
  }
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
  const pickSome = <T>(items: readonly T[], min: number, max: number): T[] => {
    const pool = [...items];
    const count = Math.min(pool.length, int(min, max));
    const chosen: T[] = [];
    while (chosen.length < count) {
      chosen.push(pool.splice(int(0, pool.length - 1), 1)[0]);
    }
    return chosen;
  };
  return { next, int, pick, pickSome, chance: (p) => next() < p };
}

const ATTENTION_PARTLY = 'dong_y_mot_phan';

export const SURVEYS: SeedSurvey[] = [
  {
    key: 'study-habits',
    type: 'INTERNAL',
    publisher: 'lan',
    scenario: 'PUBLISHED',
    title: 'Thói quen tự học và quản lý thời gian của sinh viên',
    description:
      'Khảo sát phục vụ đề tài nghiên cứu khoa học cấp khoa về thói quen tự học, địa điểm học và mức độ trì hoãn của sinh viên đại học. Thông tin được ẩn danh và chỉ dùng cho mục đích nghiên cứu.',
    rewardPerResponse: 15,
    expectedCompletions: 40,
    estimatedDurationMinutes: 8,
    publishedDaysAgo: 12,
    moderationNote: 'Câu hỏi rõ ràng, mức thưởng phù hợp thời lượng.',
    respondents: [
      'minhanh.nguyen',
      'quocbao.pham',
      'thuha.vo',
      'ducthang.le',
      'thanhtruc.huynh',
      'vankhoa.ngo',
      'phuonglinh.do',
      'giahuy.truong',
      'mylinh.phan',
      'ngocanh.dang',
      'hoanglong.bui',
      'tuankiet.ly',
    ],
    schema: definition(
      'Thói quen tự học và quản lý thời gian của sinh viên',
      'Vui lòng trả lời trung thực dựa trên học kỳ gần nhất của bạn.',
      [
        single('sh-year', 'Hiện tại bạn là sinh viên năm mấy?', [
          ['nam_1', 'Năm 1'],
          ['nam_2', 'Năm 2'],
          ['nam_3', 'Năm 3'],
          ['nam_4', 'Năm 4 trở lên'],
          ['sau_dai_hoc', 'Học viên sau đại học'],
          ['da_tot_nghiep', 'Đã tốt nghiệp / Khác'],
        ]),
        block({
          id: 'sh-hours',
          type: 'number',
          title:
            'Trung bình mỗi ngày bạn tự học bao nhiêu giờ (ngoài giờ lên lớp)?',
          min: 0,
          max: 16,
          step: 0.5,
          integerOnly: false,
          placeholder: 'Ví dụ: 2.5',
        } as FormBlockInput),
        multiple(
          'sh-places',
          'Bạn thường tự học ở đâu? (chọn tối đa 3)',
          [
            ['thu_vien', 'Thư viện trường'],
            ['quan_cafe', 'Quán cà phê'],
            ['ky_tuc_xa', 'Ký túc xá / phòng trọ'],
            ['nha_rieng', 'Nhà riêng'],
            ['lop_trong', 'Phòng học trống'],
            ['coworking', 'Không gian làm việc chung'],
          ],
          { maxSelections: 3, allowOther: true },
        ),
        single('sh-slot', 'Khung giờ bạn học hiệu quả nhất?', [
          ['sang_som', 'Sáng sớm (5h - 7h)'],
          ['buoi_sang', 'Buổi sáng (7h - 11h)'],
          ['buoi_chieu', 'Buổi chiều (13h - 17h)'],
          ['buoi_toi', 'Buổi tối (19h - 23h)'],
          ['dem_khuya', 'Đêm khuya (sau 23h)'],
        ]),
        block({
          id: 'sh-procrastination',
          type: 'linear_scale',
          title: 'Bạn có hay trì hoãn việc học khi còn xa hạn nộp bài không?',
          min: 1,
          max: 5,
          step: 1,
          minLabel: 'Hầu như không',
          maxLabel: 'Rất thường xuyên',
        } as FormBlockInput),
        single(
          'sh-attention',
          'Câu hỏi kiểm tra: vui lòng chọn "Đồng ý một phần" để xác nhận bạn đang đọc kỹ câu hỏi.',
          [
            ['dong_y_hoan_toan', 'Đồng ý hoàn toàn'],
            [ATTENTION_PARTLY, 'Đồng ý một phần'],
            ['khong_dong_y', 'Không đồng ý'],
          ],
          {
            integrity: {
              attentionCheck: {
                isAttentionCheck: true,
                expectedValue: ATTENTION_PARTLY,
                failAction: 'FLAG',
              },
              semanticCategory: 'ATTENTION_CHECK',
            },
          },
        ),
        multiple('sh-tools', 'Bạn dùng công cụ nào để hỗ trợ việc học?', [
          ['notion', 'Notion / OneNote'],
          ['google_docs', 'Google Docs / Drive'],
          ['quizlet', 'Quizlet / Anki (thẻ ghi nhớ)'],
          ['chatbot_ai', 'Chatbot AI (ChatGPT, Gemini...)'],
          ['youtube', 'Video bài giảng trên YouTube'],
          ['pomodoro', 'Ứng dụng Pomodoro / hẹn giờ'],
        ]),
        block({
          id: 'sh-satisfaction',
          type: 'rating',
          title: 'Bạn hài lòng thế nào với kết quả học tập kỳ gần nhất?',
          maxRating: 5,
          ratingShape: 'STAR',
        } as FormBlockInput),
        block({
          id: 'sh-exam-date',
          type: 'date',
          title: 'Ngày thi cuối kỳ gần nhất của bạn là ngày nào?',
          required: false,
          minDate: '2026-01-01',
          maxDate: '2026-12-31',
          includeTime: false,
        } as FormBlockInput),
        block({
          id: 'sh-difficulty',
          type: 'textarea',
          title: 'Khó khăn lớn nhất của bạn khi tự học là gì?',
          required: false,
          maxLength: 1000,
          placeholder: 'Chia sẻ ngắn gọn...',
        } as FormBlockInput),
      ],
      8,
    ),
    answers: (profile, rng) => {
      const year = !profile.isStudent
        ? profile.occupation === 'Học viên sau đại học'
          ? 'sau_dai_hoc'
          : 'da_tot_nghiep'
        : profile.age <= 19
          ? 'nam_1'
          : profile.age === 20
            ? rng.pick(['nam_2', 'nam_1'])
            : profile.age === 21
              ? rng.pick(['nam_3', 'nam_2'])
              : 'nam_4';
      const answers: Record<string, unknown> = {
        'sh-year': year,
        'sh-hours': rng.pick([1, 1.5, 2, 2.5, 3, 3.5, 4, 5]),
        'sh-places': rng.pickSome(
          ['thu_vien', 'quan_cafe', 'ky_tuc_xa', 'nha_rieng', 'lop_trong'],
          1,
          3,
        ),
        'sh-slot': rng.pick([
          'buoi_toi',
          'buoi_toi',
          'dem_khuya',
          'buoi_sang',
          'sang_som',
          'buoi_chieu',
        ]),
        'sh-procrastination': rng.pick([2, 3, 3, 4, 4, 5]),
        'sh-attention': ATTENTION_PARTLY,
        'sh-tools': rng.pickSome(
          ['notion', 'google_docs', 'quizlet', 'chatbot_ai', 'youtube'],
          1,
          4,
        ),
        'sh-satisfaction': rng.pick([2, 3, 3, 4, 4, 5]),
      };
      if (rng.chance(0.2)) {
        (answers['sh-places'] as string[]).push('Nhà sách Fahasa');
      }
      if (rng.chance(0.7)) {
        answers['sh-exam-date'] = rng.pick([
          '2026-06-12',
          '2026-06-18',
          '2026-06-25',
          '2026-07-02',
          '2026-09-15',
        ]);
      }
      if (rng.chance(0.75)) {
        answers['sh-difficulty'] = rng.pick([
          'Dễ bị phân tâm bởi điện thoại và mạng xã hội, ngồi học được 20 phút là lại lướt TikTok.',
          'Không biết cách lập kế hoạch nên hay dồn bài đến sát ngày thi.',
          'Phòng trọ ồn, thư viện thì hay hết chỗ vào mùa thi.',
          'Vừa đi làm thêm vừa học nên thiếu thời gian và hay mệt buổi tối.',
          'Tài liệu tiếng Anh nhiều, đọc chậm nên dễ nản.',
          'Khó duy trì động lực khi học một mình, thích học nhóm hơn.',
          'Chưa biết cách ghi chú hiệu quả, học xong hay quên.',
        ]);
      }
      return answers;
    },
  },
  {
    key: 'online-shopping',
    type: 'INTERNAL',
    publisher: 'lan',
    scenario: 'PUBLISHED',
    title: 'Hành vi mua sắm trực tuyến của giới trẻ năm 2026',
    description:
      'Tìm hiểu nền tảng, tần suất, mức chi tiêu và yếu tố ảnh hưởng đến quyết định mua hàng online của người trẻ Việt Nam.',
    rewardPerResponse: 12,
    expectedCompletions: 30,
    estimatedDurationMinutes: 6,
    publishedDaysAgo: 10,
    moderationNote: 'Đạt yêu cầu.',
    respondents: [
      'thuha.vo',
      'minhanh.nguyen',
      'quocbao.pham',
      'ngocanh.dang',
      'phuonglinh.do',
      'hoanglong.bui',
      'tuankiet.ly',
      'giahuy.truong',
      'thanhtruc.huynh',
      'mylinh.phan',
    ],
    schema: definition(
      'Hành vi mua sắm trực tuyến của giới trẻ năm 2026',
      'Các câu hỏi dựa trên thói quen mua sắm của bạn trong 3 tháng gần nhất.',
      [
        multiple('os-platforms', 'Bạn thường mua sắm trên nền tảng nào?', [
          ['shopee', 'Shopee'],
          ['tiktok_shop', 'TikTok Shop'],
          ['lazada', 'Lazada'],
          ['tiki', 'Tiki'],
          ['facebook', 'Facebook / Instagram'],
          ['website_hang', 'Website chính hãng'],
        ]),
        single('os-frequency', 'Bạn đặt hàng online bao lâu một lần?', [
          ['hang_tuan', 'Hằng tuần'],
          ['2_3_lan_thang', '2 - 3 lần mỗi tháng'],
          ['hang_thang', 'Khoảng 1 lần mỗi tháng'],
          ['vai_thang', 'Vài tháng một lần'],
        ]),
        single(
          'os-spend',
          'Mức chi tiêu mua sắm online trung bình mỗi tháng?',
          [
            ['duoi_200k', 'Dưới 200.000đ'],
            ['200_500k', '200.000đ - 500.000đ'],
            ['500k_1tr', '500.000đ - 1 triệu'],
            ['1_2tr', '1 - 2 triệu'],
            ['tren_2tr', 'Trên 2 triệu'],
          ],
        ),
        multiple(
          'os-categories',
          'Bạn thường mua nhóm sản phẩm nào?',
          [
            ['thoi_trang', 'Quần áo, giày dép'],
            ['my_pham', 'Mỹ phẩm, chăm sóc cá nhân'],
            ['do_an', 'Đồ ăn vặt, thực phẩm'],
            ['cong_nghe', 'Phụ kiện công nghệ'],
            ['sach', 'Sách, văn phòng phẩm'],
            ['gia_dung', 'Đồ gia dụng'],
          ],
          { maxSelections: 4 },
        ),
        block({
          id: 'os-livestream',
          type: 'linear_scale',
          title:
            'Livestream bán hàng và KOL/KOC ảnh hưởng thế nào đến quyết định mua của bạn?',
          min: 1,
          max: 5,
          step: 1,
          minLabel: 'Không ảnh hưởng',
          maxLabel: 'Ảnh hưởng rất lớn',
        } as FormBlockInput),
        single('os-payment', 'Phương thức thanh toán bạn dùng nhiều nhất?', [
          ['cod', 'Thanh toán khi nhận hàng (COD)'],
          ['vi_dien_tu', 'Ví điện tử (MoMo, ZaloPay, ShopeePay)'],
          ['the_ngan_hang', 'Thẻ ngân hàng'],
          ['chuyen_khoan', 'Chuyển khoản / QR'],
        ]),
        block({
          id: 'os-review-trust',
          type: 'rating',
          title:
            'Bạn tin tưởng đánh giá (review) của người mua khác đến mức nào?',
          maxRating: 5,
          ratingShape: 'STAR',
        } as FormBlockInput),
        block({
          id: 'os-deal',
          type: 'text',
          title: 'Loại ưu đãi nào khiến bạn "chốt đơn" nhanh nhất?',
          required: false,
          maxLength: 200,
          placeholder: 'Ví dụ: freeship, flash sale...',
        } as FormBlockInput),
      ],
      6,
    ),
    answers: (profile, rng) => {
      const answers: Record<string, unknown> = {
        'os-platforms': rng.pickSome(
          ['shopee', 'shopee', 'tiktok_shop', 'lazada', 'tiki', 'facebook'],
          1,
          3,
        ),
        'os-frequency': rng.pick([
          'hang_tuan',
          '2_3_lan_thang',
          '2_3_lan_thang',
          'hang_thang',
          'vai_thang',
        ]),
        'os-spend': profile.isStudent
          ? rng.pick(['duoi_200k', '200_500k', '200_500k', '500k_1tr'])
          : rng.pick(['500k_1tr', '1_2tr', '1_2tr', 'tren_2tr']),
        'os-categories':
          profile.gender === 'FEMALE'
            ? rng.pickSome(['thoi_trang', 'my_pham', 'do_an', 'sach'], 2, 3)
            : rng.pickSome(
                ['cong_nghe', 'thoi_trang', 'do_an', 'gia_dung'],
                1,
                3,
              ),
        'os-livestream': rng.pick([1, 2, 3, 3, 4, 5]),
        'os-payment': rng.pick([
          'cod',
          'vi_dien_tu',
          'vi_dien_tu',
          'chuyen_khoan',
          'the_ngan_hang',
        ]),
        'os-review-trust': rng.pick([2, 3, 3, 4, 4, 5]),
      };
      // Deduplicate platforms (the pool repeats Shopee to weight it).
      answers['os-platforms'] = [
        ...new Set(answers['os-platforms'] as string[]),
      ];
      if (rng.chance(0.7)) {
        answers['os-deal'] = rng.pick([
          'Freeship',
          'Flash sale 0h',
          'Mã giảm 50% cho đơn đầu tiên',
          'Mua 1 tặng 1',
          'Voucher hoàn xu',
          'Combo giá sốc trong livestream',
        ]);
      }
      return answers;
    },
  },
  {
    key: 'ai-usage',
    type: 'INTERNAL',
    publisher: 'huy',
    scenario: 'PUBLISHED',
    title: 'Mức độ sử dụng công cụ AI tạo sinh trong học tập và công việc',
    description:
      'Nhóm nghiên cứu khảo sát cách sinh viên và người đi làm sử dụng ChatGPT, Gemini, Copilot... để đề xuất hướng dẫn sử dụng AI có trách nhiệm.',
    rewardPerResponse: 18,
    expectedCompletions: 50,
    estimatedDurationMinutes: 10,
    publishedDaysAgo: 9,
    moderationNote: 'Nội dung phù hợp, có câu kiểm tra chú ý.',
    respondents: [
      'vankhoa.ngo',
      'minhanh.nguyen',
      'giahuy.truong',
      'hoanglong.bui',
      'quocbao.pham',
      'mylinh.phan',
      'thuha.vo',
      'ducthang.le',
      'ngocanh.dang',
      'phuonglinh.do',
      'tuankiet.ly',
      'thanhtruc.huynh',
    ],
    schema: definition(
      'Mức độ sử dụng công cụ AI tạo sinh trong học tập và công việc',
      'Khảo sát gồm 10 câu hỏi, mất khoảng 10 phút.',
      [
        single(
          'ai-frequency',
          'Bạn sử dụng công cụ AI tạo sinh thường xuyên thế nào?',
          [
            ['hang_ngay', 'Hằng ngày'],
            ['vai_lan_tuan', 'Vài lần mỗi tuần'],
            ['vai_lan_thang', 'Vài lần mỗi tháng'],
            ['hiem_khi', 'Hiếm khi'],
            ['chua_bao_gio', 'Chưa bao giờ'],
          ],
        ),
        multiple(
          'ai-tools',
          'Bạn đã từng dùng công cụ nào?',
          [
            ['chatgpt', 'ChatGPT'],
            ['gemini', 'Gemini'],
            ['claude', 'Claude'],
            ['copilot', 'Microsoft / GitHub Copilot'],
            ['perplexity', 'Perplexity'],
            ['notebooklm', 'NotebookLM'],
          ],
          { allowOther: true },
        ),
        multiple('ai-purposes', 'Bạn dùng AI chủ yếu cho mục đích gì?', [
          ['viet_bai', 'Viết và chỉnh sửa văn bản'],
          ['lap_trinh', 'Lập trình, sửa lỗi code'],
          ['dich_thuat', 'Dịch thuật'],
          ['tom_tat', 'Tóm tắt tài liệu'],
          ['y_tuong', 'Lên ý tưởng, brainstorm'],
          ['hoc_ngoai_ngu', 'Luyện ngoại ngữ'],
        ]),
        block({
          id: 'ai-trust',
          type: 'linear_scale',
          title:
            'Bạn tin tưởng độ chính xác của câu trả lời do AI đưa ra ở mức nào?',
          min: 0,
          max: 10,
          step: 1,
          minLabel: 'Hoàn toàn không tin',
          maxLabel: 'Tin tưởng tuyệt đối',
        } as FormBlockInput),
        block({
          id: 'ai-attention',
          type: 'linear_scale',
          title:
            'Câu hỏi kiểm tra sự tập trung: vui lòng chọn mức 3 trên thang đo dưới đây.',
          min: 1,
          max: 5,
          step: 1,
          integrity: {
            attentionCheck: {
              isAttentionCheck: true,
              expectedValue: 3,
              failAction: 'FLAG',
            },
            semanticCategory: 'ATTENTION_CHECK',
          },
        } as FormBlockInput),
        single('ai-plan', 'Bạn đang dùng gói AI nào?', [
          ['tra_phi', 'Gói trả phí cá nhân'],
          ['mien_phi', 'Chỉ dùng bản miễn phí'],
          ['to_chuc_cap', 'Trường / công ty cung cấp'],
        ]),
        block({
          id: 'ai-hours-saved',
          type: 'number',
          title: 'Ước tính AI giúp bạn tiết kiệm bao nhiêu giờ mỗi tuần?',
          min: 0,
          max: 40,
          integerOnly: true,
          placeholder: '0',
        } as FormBlockInput),
        single(
          'ai-policy',
          'Trường / nơi làm việc của bạn có quy định về dùng AI không?',
          [
            ['cam', 'Cấm hoàn toàn'],
            ['co_dieu_kien', 'Cho phép có điều kiện (phải ghi nguồn)'],
            ['khuyen_khich', 'Khuyến khích sử dụng'],
            ['chua_co', 'Chưa có quy định'],
          ],
        ),
        block({
          id: 'ai-job-worry',
          type: 'rating',
          title:
            'Bạn lo ngại AI sẽ ảnh hưởng đến cơ hội việc làm tương lai ở mức nào?',
          maxRating: 5,
          ratingShape: 'NUMBER',
        } as FormBlockInput),
        block({
          id: 'ai-advice',
          type: 'textarea',
          title: 'Theo bạn, sinh viên nên sử dụng AI như thế nào cho đúng?',
          minLength: 10,
          maxLength: 1500,
        } as FormBlockInput),
      ],
      10,
    ),
    answers: (profile, rng) => {
      const techy =
        profile.fieldOfStudy === 'Công nghệ thông tin' ||
        profile.occupation === 'Lao động tự do (Freelancer)';
      const tools = rng.pickSome(
        techy
          ? ['chatgpt', 'gemini', 'claude', 'copilot', 'perplexity']
          : ['chatgpt', 'gemini', 'notebooklm', 'perplexity'],
        1,
        3,
      );
      if (!tools.includes('chatgpt') && rng.chance(0.7)) tools.push('chatgpt');
      return {
        'ai-frequency': techy
          ? rng.pick(['hang_ngay', 'hang_ngay', 'vai_lan_tuan'])
          : rng.pick([
              'vai_lan_tuan',
              'vai_lan_thang',
              'hang_ngay',
              'hiem_khi',
            ]),
        'ai-tools': tools,
        'ai-purposes': techy
          ? rng.pickSome(
              ['lap_trinh', 'tom_tat', 'y_tuong', 'dich_thuat'],
              2,
              3,
            )
          : rng.pickSome(
              ['viet_bai', 'dich_thuat', 'tom_tat', 'y_tuong', 'hoc_ngoai_ngu'],
              1,
              3,
            ),
        'ai-trust': rng.int(4, 8),
        'ai-attention': 3,
        'ai-plan': techy
          ? rng.pick(['tra_phi', 'mien_phi', 'tra_phi'])
          : rng.pick(['mien_phi', 'mien_phi', 'to_chuc_cap']),
        'ai-hours-saved': techy ? rng.int(3, 10) : rng.int(0, 5),
        'ai-policy': rng.pick([
          'co_dieu_kien',
          'co_dieu_kien',
          'chua_co',
          'cam',
        ]),
        'ai-job-worry': rng.pick([2, 3, 3, 4, 5]),
        'ai-advice': rng.pick([
          'Dùng AI để hiểu bài và gợi ý hướng làm, nhưng phải tự kiểm chứng và tự viết lại bằng ngôn ngữ của mình.',
          'Nên xem AI như trợ giảng: hỏi để hiểu khái niệm, không copy nguyên văn vào bài nộp.',
          'Luôn ghi rõ phần nào có sự hỗ trợ của AI và kiểm tra lại nguồn tham khảo vì AI có thể bịa số liệu.',
          'Dùng để tiết kiệm thời gian cho việc lặp lại như định dạng, tóm tắt; phần tư duy phải tự làm.',
          'Nhà trường nên hướng dẫn cụ thể thay vì cấm, vì đằng nào sinh viên cũng sẽ dùng.',
          'Hỏi AI giải thích lỗi code rồi tự sửa, đừng để AI viết hết vì đi làm sẽ không theo kịp.',
        ]),
      };
    },
  },
  {
    key: 'sleep-mental-health',
    type: 'INTERNAL',
    publisher: 'huy',
    scenario: 'PUBLISHED',
    title: 'Giấc ngủ và sức khỏe tinh thần của người trẻ (18 - 30 tuổi)',
    description:
      'Khảo sát ngắn về thời lượng ngủ, mức độ căng thẳng và thói quen vận động. Dành cho người từ 18 đến 30 tuổi.',
    rewardPerResponse: 14,
    expectedCompletions: 30,
    estimatedDurationMinutes: 7,
    publishedDaysAgo: 7,
    targeting: { ageRange: { min: 18, max: 30 } },
    moderationNote: 'Đã kiểm tra: không thu thập thông tin y tế định danh.',
    respondents: [
      'thanhtruc.huynh',
      'minhanh.nguyen',
      'thuha.vo',
      'ducthang.le',
      'giahuy.truong',
      'ngocanh.dang',
      'vankhoa.ngo',
      'hoanglong.bui',
    ],
    schema: definition(
      'Giấc ngủ và sức khỏe tinh thần của người trẻ (18 - 30 tuổi)',
      'Các câu hỏi đề cập đến 2 tuần gần nhất.',
      [
        block({
          id: 'mh-sleep-hours',
          type: 'number',
          title: 'Trung bình mỗi đêm bạn ngủ bao nhiêu giờ?',
          min: 3,
          max: 12,
          step: 0.5,
          integerOnly: false,
        } as FormBlockInput),
        single('mh-bedtime', 'Bạn thường đi ngủ lúc mấy giờ?', [
          ['truoc_23h', 'Trước 23h'],
          ['23h_0h', 'Từ 23h đến 0h'],
          ['0h_1h', 'Từ 0h đến 1h'],
          ['sau_1h', 'Sau 1h sáng'],
        ]),
        block({
          id: 'mh-stress',
          type: 'linear_scale',
          title: 'Mức độ căng thẳng của bạn trong 2 tuần gần đây?',
          min: 1,
          max: 5,
          step: 1,
          minLabel: 'Rất thoải mái',
          maxLabel: 'Rất căng thẳng',
        } as FormBlockInput),
        multiple(
          'mh-stress-sources',
          'Nguồn gây căng thẳng chính của bạn? (tối đa 3)',
          [
            ['hoc_tap', 'Học tập, thi cử'],
            ['tai_chinh', 'Tài chính'],
            ['gia_dinh', 'Gia đình'],
            ['cong_viec', 'Công việc / làm thêm'],
            ['moi_quan_he', 'Các mối quan hệ'],
            ['tuong_lai', 'Lo lắng về tương lai'],
          ],
          { maxSelections: 3 },
        ),
        single(
          'mh-exercise',
          'Mỗi tuần bạn vận động thể chất bao nhiêu buổi?',
          [
            ['khong', 'Không vận động'],
            ['1_2_buoi', '1 - 2 buổi'],
            ['3_4_buoi', '3 - 4 buổi'],
            ['5_buoi', 'Từ 5 buổi trở lên'],
          ],
        ),
        block({
          id: 'mh-sleep-quality',
          type: 'rating',
          title: 'Bạn đánh giá chất lượng giấc ngủ của mình thế nào?',
          maxRating: 5,
          ratingShape: 'STAR',
        } as FormBlockInput),
        single(
          'mh-counseling',
          'Bạn đã từng sử dụng dịch vụ tư vấn tâm lý chưa?',
          [
            ['da_dung', 'Đã từng sử dụng'],
            ['biet_chua_dung', 'Biết nhưng chưa dùng'],
            ['khong_biet', 'Không biết nơi nào cung cấp'],
          ],
        ),
        block({
          id: 'mh-relax',
          type: 'text',
          title: 'Một thói quen giúp bạn thư giãn sau ngày dài?',
          required: false,
          maxLength: 200,
        } as FormBlockInput),
      ],
      7,
    ),
    answers: (profile, rng) => {
      const answers: Record<string, unknown> = {
        'mh-sleep-hours': rng.pick([5, 5.5, 6, 6, 6.5, 7, 7.5, 8]),
        'mh-bedtime': rng.pick([
          '23h_0h',
          '0h_1h',
          '0h_1h',
          'sau_1h',
          'truoc_23h',
        ]),
        'mh-stress': rng.pick([2, 3, 3, 4, 4, 5]),
        'mh-stress-sources': rng.pickSome(
          profile.isStudent
            ? ['hoc_tap', 'tai_chinh', 'tuong_lai', 'moi_quan_he']
            : ['cong_viec', 'tai_chinh', 'gia_dinh', 'tuong_lai'],
          1,
          3,
        ),
        'mh-exercise': rng.pick([
          'khong',
          '1_2_buoi',
          '1_2_buoi',
          '3_4_buoi',
          '5_buoi',
        ]),
        'mh-sleep-quality': rng.pick([2, 3, 3, 4, 4]),
        'mh-counseling': rng.pick([
          'biet_chua_dung',
          'biet_chua_dung',
          'khong_biet',
          'da_dung',
        ]),
      };
      if (rng.chance(0.65)) {
        answers['mh-relax'] = rng.pick([
          'Nghe nhạc lo-fi trước khi ngủ',
          'Đi bộ ven sông Hàn buổi tối',
          'Chơi cầu lông với bạn cùng phòng',
          'Tắt điện thoại sớm và đọc sách',
          'Nấu ăn cho cả tuần vào chủ nhật',
          'Tập yoga 15 phút',
        ]);
      }
      return answers;
    },
  },
  {
    key: 'coffee-milktea-external',
    type: 'EXTERNAL',
    publisher: 'huy',
    scenario: 'PUBLISHED',
    title: 'Thói quen uống cà phê và trà sữa của sinh viên (Google Forms)',
    description:
      'Khảo sát thực hiện trên Google Forms. Hoàn thành biểu mẫu, sao chép mã hoàn thành 6 chữ số ở trang cuối và nhập lại trên RESCOM để nhận điểm (điểm chờ duyệt 48 giờ).',
    externalUrl:
      'https://docs.google.com/forms/d/e/1FAIpQLSdRescomDemoCafeTraSua2026/viewform',
    rewardPerResponse: 12,
    expectedCompletions: 20,
    estimatedDurationMinutes: 5,
    idempotencyKey: 'rescom-seed:coffee-milktea-external:v1',
    publishedDaysAgo: 2,
    moderationNote: 'Liên kết Google Forms hợp lệ.',
    respondents: ['baotran.vu', 'tuankiet.ly', 'ngocanh.dang', 'quocbao.pham'],
  },
  {
    key: 'canteen-review',
    type: 'INTERNAL',
    publisher: 'lan',
    scenario: 'OWNER_CLOSED',
    title: 'Đánh giá chất lượng căng tin trường học kỳ Hè 2026',
    description:
      'Góp ý nhanh về chất lượng món ăn, giá cả và vệ sinh của căng tin để gửi Ban quản lý ký túc xá.',
    rewardPerResponse: 8,
    expectedCompletions: 25,
    estimatedDurationMinutes: 4,
    publishedDaysAgo: 13,
    closedDaysAgo: 3,
    closeReason:
      'Đã thu đủ dữ liệu cho báo cáo gửi Ban quản lý, đóng khảo sát sớm.',
    moderationNote: 'Khảo sát ngắn, phù hợp.',
    respondents: [
      'ducthang.le',
      'minhanh.nguyen',
      'giahuy.truong',
      'thanhtruc.huynh',
      'vankhoa.ngo',
      'phuonglinh.do',
    ],
    schema: definition(
      'Đánh giá chất lượng căng tin trường học kỳ Hè 2026',
      'Chỉ mất khoảng 4 phút.',
      [
        block({
          id: 'ct-food',
          type: 'rating',
          title: 'Chất lượng món ăn tại căng tin',
          maxRating: 5,
          ratingShape: 'STAR',
        } as FormBlockInput),
        single('ct-price', 'Bạn thấy giá cả ở căng tin thế nào?', [
          ['re', 'Rẻ, hợp túi tiền sinh viên'],
          ['hop_ly', 'Hợp lý'],
          ['hoi_cao', 'Hơi cao'],
          ['qua_cao', 'Quá cao so với chất lượng'],
        ]),
        multiple('ct-dishes', 'Món bạn hay chọn nhất?', [
          ['com_ga', 'Cơm gà xối mỡ'],
          ['bun_bo', 'Bún bò'],
          ['mi_quang', 'Mì Quảng'],
          ['banh_mi', 'Bánh mì'],
          ['com_chay', 'Cơm chay'],
        ]),
        block({
          id: 'ct-clean',
          type: 'linear_scale',
          title: 'Mức độ sạch sẽ của khu vực ăn uống',
          min: 1,
          max: 5,
          step: 1,
          minLabel: 'Rất kém',
          maxLabel: 'Rất tốt',
        } as FormBlockInput),
        block({
          id: 'ct-suggest',
          type: 'textarea',
          title: 'Góp ý để căng tin phục vụ tốt hơn',
          required: false,
          maxLength: 800,
        } as FormBlockInput),
      ],
      4,
    ),
    answers: (_profile, rng) => {
      const answers: Record<string, unknown> = {
        'ct-food': rng.pick([2, 3, 3, 4, 4]),
        'ct-price': rng.pick(['re', 'hop_ly', 'hop_ly', 'hoi_cao', 'qua_cao']),
        'ct-dishes': rng.pickSome(
          ['com_ga', 'bun_bo', 'mi_quang', 'banh_mi', 'com_chay'],
          1,
          2,
        ),
        'ct-clean': rng.pick([2, 3, 3, 4, 5]),
      };
      if (rng.chance(0.8)) {
        answers['ct-suggest'] = rng.pick([
          'Nên mở thêm quầy vào giờ cao điểm 11h30 - 12h15, xếp hàng quá lâu.',
          'Thêm món chay vào thứ 2 và thứ 6.',
          'Bàn ăn cần lau thường xuyên hơn, cuối giờ trưa khá bẩn.',
          'Cho thanh toán bằng QR để đỡ mất thời gian thối tiền.',
          'Giảm bớt đồ chiên, thêm rau xanh.',
        ]);
      }
      return answers;
    },
  },
  {
    key: 'public-transport-danang',
    type: 'INTERNAL',
    publisher: 'trang',
    scenario: 'MODERATION_QUEUE',
    title: 'Nhu cầu sử dụng xe buýt và phương tiện công cộng tại Đà Nẵng',
    description:
      'Khảo sát nhu cầu đi lại bằng xe buýt của sinh viên và người đi làm tại Đà Nẵng, phục vụ đề xuất tuyến xe buýt đến các khu đại học.',
    rewardPerResponse: 10,
    expectedCompletions: 30,
    estimatedDurationMinutes: 6,
    publishedDaysAgo: 1,
    targeting: { locations: ['Đà Nẵng', 'Quảng Nam'] },
    respondents: [],
    schema: definition(
      'Nhu cầu sử dụng xe buýt và phương tiện công cộng tại Đà Nẵng',
      'Khảo sát dành cho người đang sống, học tập hoặc làm việc tại Đà Nẵng.',
      [
        single('pt-main', 'Phương tiện chính bạn dùng để đi học / đi làm?', [
          ['xe_may', 'Xe máy'],
          ['xe_dap', 'Xe đạp / xe đạp điện'],
          ['xe_buyt', 'Xe buýt'],
          ['xe_cong_nghe', 'Xe công nghệ (Grab, Xanh SM, Be)'],
          ['di_bo', 'Đi bộ'],
        ]),
        block({
          id: 'pt-distance',
          type: 'number',
          title: 'Quãng đường từ nơi ở đến trường / nơi làm (km)?',
          min: 0,
          max: 100,
          step: 0.5,
          integerOnly: false,
        } as FormBlockInput),
        multiple('pt-barriers', 'Điều gì khiến bạn ngại đi xe buýt?', [
          ['it_tuyen', 'Ít tuyến, không đi qua nơi cần đến'],
          ['cho_lau', 'Thời gian chờ lâu'],
          ['nong', 'Trạm chờ nắng nóng, không mái che'],
          ['khong_biet', 'Không biết lộ trình / giờ chạy'],
          ['bat_tien', 'Bất tiện khi phải đi bộ đến trạm'],
        ]),
        block({
          id: 'pt-willing',
          type: 'linear_scale',
          title:
            'Nếu có tuyến xe buýt đi thẳng đến trường, bạn sẵn sàng sử dụng ở mức nào?',
          min: 1,
          max: 5,
          step: 1,
          minLabel: 'Không sử dụng',
          maxLabel: 'Chắc chắn sử dụng',
        } as FormBlockInput),
        block({
          id: 'pt-idea',
          type: 'textarea',
          title: 'Đề xuất của bạn cho hệ thống xe buýt Đà Nẵng',
          required: false,
          maxLength: 1000,
        } as FormBlockInput),
      ],
      6,
    ),
  },
  {
    key: 'crypto-rejected',
    type: 'INTERNAL',
    publisher: 'trang',
    scenario: 'REJECTED',
    title: 'Cơ hội đầu tư tiền mã hóa lợi nhuận 30%/tháng dành cho sinh viên',
    description:
      'Tham gia khảo sát để nhận tư vấn đầu tư miễn phí và cơ hội nhận thưởng.',
    rewardPerResponse: 8,
    expectedCompletions: 20,
    estimatedDurationMinutes: 4,
    publishedDaysAgo: 5,
    rejectionReason:
      'Khảo sát yêu cầu cung cấp số CCCD và số tài khoản ngân hàng, vi phạm chính sách bảo vệ dữ liệu cá nhân của RESCOM; tiêu đề hứa hẹn lợi nhuận đầu tư có dấu hiệu quảng cáo gây hiểu lầm. Vui lòng bỏ các câu hỏi thu thập thông tin định danh và chỉnh lại nội dung trước khi gửi lại.',
    respondents: [],
    schema: definition(
      'Cơ hội đầu tư tiền mã hóa lợi nhuận 30%/tháng dành cho sinh viên',
      'Điền thông tin để được tư vấn.',
      [
        block({
          id: 'cr-name',
          type: 'text',
          title: 'Họ và tên đầy đủ',
          maxLength: 100,
        } as FormBlockInput),
        block({
          id: 'cr-id-number',
          type: 'text',
          title: 'Số căn cước công dân (CCCD)',
          maxLength: 12,
        } as FormBlockInput),
        block({
          id: 'cr-bank',
          type: 'text',
          title: 'Số tài khoản ngân hàng để nhận lợi nhuận',
          maxLength: 20,
        } as FormBlockInput),
        single('cr-budget', 'Bạn có thể đầu tư bao nhiêu?', [
          ['duoi_5tr', 'Dưới 5 triệu'],
          ['5_20tr', '5 - 20 triệu'],
          ['tren_20tr', 'Trên 20 triệu'],
        ]),
      ],
      4,
    ),
  },
  {
    key: 'domestic-travel-draft',
    type: 'INTERNAL',
    publisher: 'trang',
    scenario: 'DRAFT',
    title: 'Trải nghiệm du lịch nội địa mùa hè 2026',
    description:
      'Bản nháp: tìm hiểu điểm đến, ngân sách và kênh đặt dịch vụ du lịch của người trẻ.',
    rewardPerResponse: 15,
    expectedCompletions: 40,
    estimatedDurationMinutes: 9,
    publishedDaysAgo: 2,
    respondents: [],
    schema: definition(
      'Trải nghiệm du lịch nội địa mùa hè 2026',
      'Bản nháp - đang hoàn thiện câu hỏi.',
      [
        multiple('tr-destinations', 'Hè này bạn đã / sẽ đi đâu?', [
          ['da_lat', 'Đà Lạt'],
          ['phu_quoc', 'Phú Quốc'],
          ['hoi_an', 'Hội An'],
          ['sa_pa', 'Sa Pa'],
          ['quy_nhon', 'Quy Nhơn'],
        ]),
        single('tr-budget', 'Ngân sách cho một chuyến đi 3 ngày 2 đêm?', [
          ['duoi_2tr', 'Dưới 2 triệu'],
          ['2_5tr', '2 - 5 triệu'],
          ['tren_5tr', 'Trên 5 triệu'],
        ]),
        block({
          id: 'tr-booking',
          type: 'text',
          title: 'Bạn thường đặt phòng qua ứng dụng nào?',
          required: false,
        } as FormBlockInput),
      ],
      9,
    ),
  },
];

/** Post-completion feedback left on some attempts (survey key, respondent key). */
export const FEEDBACK: Array<{
  survey: string;
  respondent: string;
  input: SubmitSurveyFeedbackInput;
}> = [
  {
    survey: 'study-habits',
    respondent: 'minhanh.nguyen',
    input: {
      rating: 5,
      comment:
        'Câu hỏi ngắn gọn, dễ hiểu. Mong nhóm chia sẻ kết quả nghiên cứu!',
    },
  },
  {
    survey: 'study-habits',
    respondent: 'quocbao.pham',
    input: { rating: 4, comment: 'Ổn, nhưng câu hỏi về ngày thi hơi thừa.' },
  },
  {
    survey: 'study-habits',
    respondent: 'mylinh.phan',
    input: {
      rating: 3,
      comment: 'Một số lựa chọn chưa phù hợp với người đã tốt nghiệp.',
      issueTags: ['UNCLEAR_QUESTIONS'],
    },
  },
  {
    survey: 'online-shopping',
    respondent: 'thuha.vo',
    input: { rating: 5, comment: 'Chủ đề gần gũi, làm rất nhanh.' },
  },
  {
    survey: 'online-shopping',
    respondent: 'hoanglong.bui',
    input: { rating: 4 },
  },
  {
    survey: 'ai-usage',
    respondent: 'vankhoa.ngo',
    input: {
      rating: 5,
      comment: 'Khảo sát rất đáng làm, câu hỏi mở cuối bài hay.',
    },
  },
  {
    survey: 'ai-usage',
    respondent: 'giahuy.truong',
    input: {
      rating: 4,
      comment: 'Hơi dài so với thời gian ước tính.',
      issueTags: ['LONGER_THAN_ESTIMATED'],
    },
  },
  {
    survey: 'ai-usage',
    respondent: 'ducthang.le',
    input: { rating: 4 },
  },
  {
    survey: 'sleep-mental-health',
    respondent: 'thanhtruc.huynh',
    input: {
      rating: 5,
      comment: 'Cảm ơn nhóm đã quan tâm đến sức khỏe tinh thần sinh viên.',
    },
  },
  {
    survey: 'sleep-mental-health',
    respondent: 'ngocanh.dang',
    input: { rating: 4 },
  },
  {
    survey: 'canteen-review',
    respondent: 'ducthang.le',
    input: {
      rating: 3,
      comment: 'Nút gửi hơi chậm khi mạng yếu.',
      issueTags: ['TECHNICAL_ISSUE'],
    },
  },
  {
    survey: 'coffee-milktea-external',
    respondent: 'baotran.vu',
    input: { rating: 5, comment: 'Form Google dễ làm, mã hoàn thành rõ ràng.' },
  },
  {
    survey: 'coffee-milktea-external',
    respondent: 'tuankiet.ly',
    input: { rating: 4 },
  },
];

export const TOP_UP_REJECTION_REASON =
  'Không tìm thấy giao dịch chuyển khoản khớp với nội dung chuyển khoản sau 48 giờ. Vui lòng liên hệ hỗ trợ kèm ảnh biên lai.';

/** Non-enforcing scoring policy deployment read by participation. */
export const SCORING_POLICY = {
  name: 'rescom-integrity-policy',
  version: 1,
  status: 'SHADOW' as const,
  definition: {
    description:
      'Phase 1 go-live policy: integrity signals are recorded only (SHADOW); rewards settle instantly (Internal) or after the 48 h review (External). No automatic holds.',
    mode: 'SHADOW',
    hardControls: {
      timeBarrierPolicy: 'time-barrier-v1',
      rateLimitPolicy: 'participation-rate-limit-v1',
      completionCodePolicy: 'completion-code-policy-v1',
    },
    thresholds: { hold: null, review: null },
  },
};
