import test from "node:test";
import assert from "node:assert/strict";

const view = await import("../lib/profile/account-view.ts");
const { EMPTY_ANSWERS, answersFromServer } = await import("../lib/onboarding/onboarding-answers.ts");
const { userProfileSchema } = await import("@rescom/schemas");

const CURRENT_YEAR = 2026;

/** Figma 15g/15h seed: Linh Nguyễn, 2005, Nữ, Đà Nẵng, student in year 3, Marketing. */
const linh = {
  ...EMPTY_ANSWERS,
  displayName: "Linh Nguyễn",
  birthYear: "2005",
  gender: "FEMALE",
  location: "Đà Nẵng",
  occupation: "Sinh viên đại học",
  school: "ĐH FPT – Đà Nẵng",
  schoolYear: "Năm 3",
  fieldOfStudy: "Marketing & Truyền thông",
  householdIncome: "Không chia sẻ",
  interests: ["Công nghệ", "Du lịch & Ẩm thực", "Thời trang", "Âm nhạc"],
  goal: "BOTH",
};

test("15g rows: personal and study summaries", () => {
  assert.equal(view.personalSummary(linh, CURRENT_YEAR), "21 tuổi · Nữ · Đà Nẵng");
  assert.equal(view.studySummary(linh, CURRENT_YEAR), "Marketing · 4 chủ đề");
  assert.equal(view.personalSummary(EMPTY_ANSWERS, CURRENT_YEAR), view.EMPTY_FIELD_VALUE);
  assert.equal(view.studySummary(EMPTY_ANSWERS, CURRENT_YEAR), view.EMPTY_FIELD_VALUE);
});

test("15h field groups follow Figma, school fields only for students", () => {
  const groups = view.profileFieldGroups(linh, CURRENT_YEAR);
  assert.deepEqual(
    groups.map((group) => [group.title, group.fields.map((field) => `${field.label}: ${field.value}`)]),
    [
      ["Về bạn", ["Tên hiển thị: Linh Nguyễn", "Năm sinh: 2005 · 21 tuổi", "Giới tính: Nữ", "Tỉnh/thành: Đà Nẵng"]],
      [
        "Học tập & công việc",
        [
          "Nghề nghiệp: Sinh viên đại học",
          "Trường: ĐH FPT, Đà Nẵng",
          "Năm học: Năm 3",
          "Ngành: Marketing & Truyền thông",
          "Thu nhập hộ gia đình: Không chia sẻ",
        ],
      ],
      ["Sở thích & mục tiêu", ["Sở thích: 4 chủ đề", "Mục tiêu: Cả hai"]],
    ],
  );

  const worker = view.profileFieldGroups({ ...linh, occupation: "Nhân viên văn phòng" }, CURRENT_YEAR);
  assert.deepEqual(
    worker[1].fields.map((field) => field.step),
    ["occupation", "field", "income"],
  );

  const empty = view.profileFieldGroups(EMPTY_ANSWERS, CURRENT_YEAR);
  assert.ok(empty.flatMap((group) => group.fields).every((field) => field.value === view.EMPTY_FIELD_VALUE));
});

test("15h shows the saved profile from a backend-shaped GET /users/me/profile", () => {
  const profile = userProfileSchema.parse({
    displayName: "Linh Nguyễn",
    birthYear: 2005,
    school: "ĐH FPT – Đà Nẵng",
    schoolYear: "Năm 3",
    goal: "BOTH",
  });
  const demographics = {
    age: 21,
    gender: "FEMALE",
    location: "Đà Nẵng",
    occupation: "Sinh viên đại học",
    fieldOfStudy: "Marketing & Truyền thông",
    householdIncome: "Không chia sẻ",
    specificInterests: linh.interests,
  };
  const fields = view
    .profileFieldGroups(answersFromServer(demographics, profile, CURRENT_YEAR), CURRENT_YEAR)
    .flatMap((group) => group.fields);
  const valueOf = (label) => fields.find((field) => field.label === label)?.value;
  assert.equal(valueOf("Tên hiển thị"), "Linh Nguyễn");
  assert.equal(valueOf("Trường"), "ĐH FPT, Đà Nẵng");
  assert.equal(valueOf("Năm học"), "Năm 3");
  assert.equal(valueOf("Mục tiêu"), "Cả hai");
  assert.ok(fields.every((field) => field.value !== view.EMPTY_FIELD_VALUE));
});

test("15h 'Sửa' reopens the onboarding question and returns to the profile", () => {
  assert.equal(view.profileEditHref("birth-year"), "/onboarding?step=birth-year&edit=1&returnTo=%2Faccount%2Fprofile");
});

test("15g row values: consent, weekly rank, unread", () => {
  assert.equal(
    view.consentLabel({ currentVersion: 1, acceptedVersion: 1, acceptedAt: "2026-09-26T03:00:00.000Z" }),
    "Đã đồng ý v1 · 26/09",
  );
  // 26/09 18:00 UTC is already 27/09 in Vietnam.
  assert.equal(
    view.consentLabel({ currentVersion: 1, acceptedVersion: 1, acceptedAt: "2026-09-26T18:00:00.000Z" }),
    "Đã đồng ý v1 · 27/09",
  );
  assert.equal(view.consentLabel({ currentVersion: 2, acceptedVersion: null, acceptedAt: null }), "Chưa đồng ý");
  assert.equal(view.weeklyRankLabel(41), "Tuần này #41");
  assert.equal(view.weeklyRankLabel(null), "Chưa có hạng tuần này");
  assert.equal(view.unreadLabel(3), "3 chưa đọc");
  assert.equal(view.unreadLabel(0), "Đã đọc hết");
  assert.equal(view.RELIABILITY_LEVEL_LABEL.FORMING, "Đang hình thành");
});

function summary(level, completed) {
  return {
    streak: { current: 1, longest: 3, countedToday: true, week: [] },
    tier: { level },
    stats: { completedSurveys: completed, publishedSurveys: 4 },
    weeklyRank: 41,
  };
}

test("15g profile card: tier, stats and next-tier progress", () => {
  assert.deepEqual(view.tierCardView(summary(2, 2)), {
    tierName: "Thành viên xác thực",
    streakDays: 1,
    completed: 2,
    published: 4,
    next: {
      name: "Người đóng góp tích cực",
      current: 2,
      target: 20,
      hint: "Làm thêm 18 khảo sát để được ưu tiên hiển thị trên Khám phá.",
    },
  });
  // Level 1 with a survey done: only the profile gate is left.
  assert.equal(view.tierCardView(summary(1, 1)).next.hint, "Hoàn tất hồ sơ để mở khoá điểm và dùng đầy đủ tính năng.");
  assert.equal(view.tierCardView(summary(1, 0)).next.hint, "Làm thêm 1 khảo sát để mở khoá điểm và dùng đầy đủ tính năng.");
  // Level ≥ 2 with enough surveys: no profile gate, the tier is just not updated yet (same copy as 16).
  assert.equal(view.tierCardView(summary(2, 25)).next.hint, "Đã đủ khảo sát, hạng sẽ được cập nhật sớm.");
  assert.equal(view.tierCardView(summary(3, 120)).next.hint, "Đã đủ khảo sát, hạng sẽ được cập nhật sớm.");
  assert.equal(
    view.tierCardView(summary(3, 40)).next.hint,
    "Làm thêm 60 khảo sát để nhận huy hiệu và quyền lợi của hạng Nhà nghiên cứu tin cậy.",
  );
  assert.equal(view.tierCardView(summary(5, 400)).next, null);
});
