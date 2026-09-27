import type { FormBlock } from "@rescom/schemas";
import { createCollection } from "../db/store";
import { analyticsFormVersions } from "./form-analytics-seed";
import { findPublisherForm, PUBLISHER_FORM_IDS } from "./forms";
import { surveyContentOf } from "./survey-content";

/**
 * Form versions of the publisher surveys (Figma 17a "Lịch sử phiên bản",
 * 63:5939). Phase 5C owns it.
 * v1 = the published 8 questions (`survey-content.ts`); v2 = adds C9, a C3
 * option and makes C8 optional (Figma "Thay đổi so với v1").
 *
 * The survey is CLOSED by its owner (Figma 10b/17 "Mở lại thêm mẫu"), so v2 is
 * seeded as approved: the backend only puts a CLOSED survey back with an
 * approved current version (`FORM_NOT_REOPENABLE` / `VERSION_NOT_APPROVED`),
 * and a new draft version exists only while the survey is a DRAFT (`POST
 * /forms/:id/versions` needs PUBLISHED). Figma 17a's unpublished v2 draft card
 * ("Mở lại với v2") is a state the backend cannot produce together with 10b.
 * Timeline: v1 filled the quota on 22/09; the owner re-versioned, v2 was
 * approved, then the owner closed the survey.
 */
export interface MockFormVersion {
  id: string;
  formId: string;
  versionNumber: number;
  isPublished: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  submittedForReviewAt: string | null;
  collectedFrom: string | null;
  collectedUntil: string | null;
  blocks: FormBlock[];
}

const HOUSING = PUBLISHER_FORM_IDS.housingNearCampus;

function housingV2(v1: FormBlock[]): FormBlock[] {
  const blocks = structuredClone(v1).map((block) => {
    if (block.id === "house-q3" && block.type === "single_choice") {
      return {
        ...block,
        options: [...block.options, { id: "house-q3-o5", label: "Trên 5 triệu đồng", value: "Trên 5 triệu đồng" }],
      };
    }
    if (block.id === "house-q8") return { ...block, required: false };
    return block;
  });
  blocks.push({
    id: "house-q9",
    order: 8,
    type: "number",
    title: "Bạn sẵn sàng trả thêm bao nhiêu cho phòng có máy lạnh?",
    description: "Đơn vị: nghìn đồng mỗi tháng.",
    required: false,
    min: 0,
    max: 5000,
    integerOnly: true,
  } as FormBlock);
  return blocks;
}

function seed(): MockFormVersion[] {
  const housingV1 = surveyContentOf(HOUSING)?.blocks ?? [];
  const versions: MockFormVersion[] = [
    {
      id: "8d2e4f60-1a2b-4c3d-9e4f-5a6b7c8d9e01",
      formId: HOUSING,
      versionNumber: 1,
      isPublished: true,
      publishedAt: "2026-09-15T08:00:00+07:00",
      createdAt: "2026-09-13T20:10:00+07:00",
      updatedAt: "2026-09-14T09:30:00+07:00",
      submittedForReviewAt: "2026-09-14T09:30:00+07:00",
      collectedFrom: "2026-09-15T08:00:00+07:00",
      collectedUntil: "2026-09-22T21:14:00+07:00",
      blocks: housingV1,
    },
    {
      id: "8d2e4f60-1a2b-4c3d-9e4f-5a6b7c8d9e02",
      formId: HOUSING,
      versionNumber: 2,
      isPublished: true,
      publishedAt: "2026-09-22T22:40:00+07:00",
      createdAt: "2026-09-22T21:30:00+07:00",
      updatedAt: "2026-09-22T22:05:00+07:00",
      submittedForReviewAt: "2026-09-22T22:05:00+07:00",
      collectedFrom: "2026-09-22T22:40:00+07:00",
      collectedUntil: "2026-09-22T23:10:00+07:00",
      blocks: housingV2(housingV1),
    },
  ];
  // Every other publisher survey: one version (published once approved).
  const others = [
    PUBLISHER_FORM_IDS.consumerMarketing,
    PUBLISHER_FORM_IDS.readingHabits,
    PUBLISHER_FORM_IDS.foodDeliveryApp,
  ];
  others.forEach((formId, index) => {
    const form = findPublisherForm(formId);
    if (!form) return;
    versions.push({
      id: `8d2e4f60-1a2b-4c3d-9e4f-5a6b7c8d9f0${index + 1}`,
      formId,
      versionNumber: 1,
      isPublished: Boolean(form.publishedAt),
      publishedAt: form.publishedAt,
      createdAt: form.createdAt,
      updatedAt: form.submittedAt ?? form.createdAt,
      submittedForReviewAt: form.submittedAt,
      collectedFrom: form.publishedAt,
      collectedUntil: form.closedAt,
      blocks: [],
    });
  });
  // Survey response analytics: one published version each, blocks in `form-analytics-seed.ts`.
  versions.push(...analyticsFormVersions());
  return versions;
}

export const formVersions = createCollection<MockFormVersion[]>("form-versions", seed);

/** Ascending, like `GET /forms/:id/versions`. */
export function versionsOf(formId: string): MockFormVersion[] {
  return formVersions
    .get()
    .filter((version) => version.formId === formId)
    .sort((a, b) => a.versionNumber - b.versionNumber);
}

export function findVersion(formId: string, versionId: string): MockFormVersion | undefined {
  return versionsOf(formId).find((version) => version.id === versionId);
}
