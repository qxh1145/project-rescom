import type { FormStatusEnum } from "@rescom/schemas";
import { createCollection, hoursAgo } from "../db/store";
import { SURVEY_IDS } from "./surveys";

/**
 * Publisher-side surveys ("Khảo sát của tôi", Figma 10 · 63:127). Shared by the
 * Phase 5 flows: Google Forms wizard, my-surveys/tracking/results, Form Builder.
 * Statuses are the backend `formStatusEnum`; the Figma pills map as
 * MODERATION_QUEUE → "Chờ duyệt", PUBLISHED → "Đang chạy", CLOSED → "Đủ mẫu /
 * Đã kết thúc", CLOSED + `closeKind` MODERATION (backend `rejectPublication`)
 * → "Bị từ chối" with the ASSUMED `rejection` details.
 *
 * A PUBLISHED/CLOSED form that respondents can see also exists in
 * `surveys.ts` under the same id (e.g. "Nhu cầu nhà trọ gần trường").
 * Domain files add their own data keyed by `id` (blocks, versions, responses…).
 */
export const PUBLISHER_FORM_IDS = {
  consumerMarketing: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f01",
  readingHabits: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f02",
  housingNearCampus: SURVEY_IDS.housingNearCampus,
  foodDeliveryApp: "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f04",
} as const;

export type PublisherFormKind = "INTERNAL" | "EXTERNAL";

export interface MockPublisherForm {
  id: string;
  /** Owner (demo publisher = `minh.le@fpt.edu.vn`). */
  ownerEmail: string;
  title: string;
  type: PublisherFormKind;
  status: FormStatusEnum;
  rewardPerResponse: number;
  expectedCompletions: number;
  completedCompletions: number;
  /** Points currently locked in escrow for this survey. */
  escrowLocked: number;
  estimatedEffortSeconds: number;
  externalUrl: string | null;
  createdAt: string;
  submittedAt: string | null;
  publishedAt: string | null;
  /** Collection deadline (Figma "hạn 05/10 · còn 9 ngày"). */
  deadlineAt: string | null;
  closedAt: string | null;
  /** Hidden from Khám phá once full (Figma "đã ẩn khỏi Khám phá"). */
  hiddenFromMarketplace: boolean;
  /** Admin rejection (Figma "Bị từ chối · Lý do … · Đã hoàn 120 điểm"). */
  rejection: { reason: string; refundedPoints: number; rejectedAt: string } | null;
  /** Current version number (page 17a "Phiên bản"). */
  versionNumber: number;
  /**
   * Phase 5B (forms-manage) additions, optional so other seeds stay valid.
   * `closeKind` = backend `FormDetailDto.closeKind` (only `OWNER` reopens);
   * `pausedAt` = ASSUMED "Tạm dừng" (Figma 10a); `audienceLabel` = Figma 10a
   * targeting summary; `questionCount` = Figma 17 "8 câu hỏi".
   */
  closeKind?: "OWNER" | "ADMIN" | "MODERATION" | null;
  pausedAt?: string | null;
  audienceLabel?: string | null;
  questionCount?: number | null;
}

const DEMO_PUBLISHER = "minh.le@fpt.edu.vn";

function seed(): MockPublisherForm[] {
  return [
    {
      id: PUBLISHER_FORM_IDS.consumerMarketing,
      ownerEmail: DEMO_PUBLISHER,
      title: "Hành vi tiêu dùng của sinh viên Marketing",
      type: "EXTERNAL",
      status: "MODERATION_QUEUE",
      rewardPerResponse: 10,
      expectedCompletions: 10,
      completedCompletions: 0,
      escrowLocked: 100,
      estimatedEffortSeconds: 6 * 60,
      externalUrl: "https://docs.google.com/forms/d/e/mock-consumer-marketing/viewform",
      createdAt: hoursAgo(3),
      submittedAt: hoursAgo(2.5),
      publishedAt: null,
      deadlineAt: null,
      closedAt: null,
      hiddenFromMarketplace: true,
      rejection: null,
      versionNumber: 1,
    },
    {
      id: PUBLISHER_FORM_IDS.readingHabits,
      ownerEmail: DEMO_PUBLISHER,
      title: "Thói quen đọc sách của sinh viên",
      type: "EXTERNAL",
      status: "PUBLISHED",
      rewardPerResponse: 10,
      expectedCompletions: 10,
      completedCompletions: 6,
      escrowLocked: 40,
      // Figma 10a "Google Forms · 8 phút · 10 điểm/lượt".
      estimatedEffortSeconds: 8 * 60,
      externalUrl: "https://docs.google.com/forms/d/e/mock-reading-habits/viewform",
      createdAt: hoursAgo(24 * 5),
      submittedAt: hoursAgo(24 * 5),
      publishedAt: hoursAgo(24 * 4),
      deadlineAt: hoursAgo(-24 * 9),
      closedAt: null,
      hiddenFromMarketplace: false,
      rejection: null,
      versionNumber: 1,
      audienceLabel: "Marketing, QTKD · 18–25 tuổi",
    },
    {
      id: PUBLISHER_FORM_IDS.housingNearCampus,
      ownerEmail: DEMO_PUBLISHER,
      title: "Nhu cầu nhà trọ gần trường",
      type: "INTERNAL",
      status: "CLOSED",
      rewardPerResponse: 12,
      expectedCompletions: 20,
      completedCompletions: 20,
      escrowLocked: 0,
      estimatedEffortSeconds: 6 * 60,
      externalUrl: null,
      createdAt: hoursAgo(24 * 14),
      submittedAt: hoursAgo(24 * 13),
      publishedAt: hoursAgo(24 * 12),
      deadlineAt: null,
      closedAt: hoursAgo(24 * 5),
      hiddenFromMarketplace: true,
      rejection: null,
      versionNumber: 2,
      // ASSUMED: the owner closed it once the quota was full, so it can be reopened (Figma 10b).
      closeKind: "OWNER",
      questionCount: 8,
    },
    {
      id: PUBLISHER_FORM_IDS.foodDeliveryApp,
      ownerEmail: DEMO_PUBLISHER,
      title: "Trải nghiệm dùng app giao đồ ăn",
      type: "EXTERNAL",
      // Rejected by moderation: the backend closes it for good (decision E8-D1).
      status: "CLOSED",
      rewardPerResponse: 12,
      expectedCompletions: 10,
      completedCompletions: 0,
      escrowLocked: 0,
      estimatedEffortSeconds: 5 * 60,
      externalUrl: "https://docs.google.com/forms/d/e/mock-food-delivery/viewform",
      createdAt: hoursAgo(24 * 7),
      submittedAt: hoursAgo(24 * 7),
      publishedAt: null,
      deadlineAt: null,
      closedAt: hoursAgo(24 * 6),
      hiddenFromMarketplace: true,
      rejection: {
        reason: "Form yêu cầu đăng nhập tài khoản trường nên người ngoài không mở được.",
        refundedPoints: 120,
        rejectedAt: hoursAgo(24 * 6),
      },
      versionNumber: 1,
      closeKind: "MODERATION",
    },
  ];
}

export const publisherForms = createCollection<MockPublisherForm[]>("publisher-forms", seed);

export function formsOwnedBy(email: string): MockPublisherForm[] {
  return publisherForms.get().filter((form) => form.ownerEmail === email);
}

export function findPublisherForm(id: string): MockPublisherForm | undefined {
  return publisherForms.get().find((form) => form.id === id);
}

export function updatePublisherForm(
  id: string,
  mutator: (form: MockPublisherForm) => void,
): MockPublisherForm | undefined {
  return publisherForms
    .update((all) => {
      const target = all.find((form) => form.id === id);
      if (target) mutator(target);
    })
    .find((form) => form.id === id);
}

export function addPublisherForm(form: MockPublisherForm): MockPublisherForm {
  publisherForms.update((all) => {
    all.unshift(form);
  });
  return form;
}
