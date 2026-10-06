import type { FormTopic } from "@rescom/schemas";
import { escrowDrawPerCompletion, type DraftFormDefinition, type FormBlock, type FormStatusEnum } from "@rescom/schemas";
import type { AiConversation } from "@/lib/forms/builder-ai";
import { createCollection, hoursAgo, mockId, nowIso } from "../db/store";
import { addPublisherForm, findPublisherForm, updatePublisherForm } from "./forms";
import { choice, ordered, paragraph, scale, stars } from "./form-ai-canned";

/**
 * Form Builder drafts (Phase 5D, Figma 13). One entry per In-Rescom form the
 * builder created; the summary row other screens list lives in
 * `publisherForms` (`forms.ts`) under the same id. `ai` holds the ASSUMED
 * "Soạn bằng AI" conversation with deterministic, canned Vietnamese replies.
 */

export interface MockFormDraft {
  id: string;
  ownerEmail: string;
  status: FormStatusEnum;
  title: string;
  description: string | null;
  rewardPerResponse: number;
  expectedCompletions: number;
  estimatedDurationMinutes: number | null;
  schema: DraftFormDefinition;
  targetingJson: unknown;
  /** Plan 2.2 / Story IR.2b (`PATCH /forms/:id/draft` parity). */
  topic?: FormTopic | null;
  deadlineAt?: string | null;
  versionNumber: number;
  escrowLocked: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  ai: Omit<AiConversation, "formId"> | null;
}

const DEMO_PUBLISHER = "minh.le@fpt.edu.vn";
export const DEMO_BUILDER_FORM_ID = "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f13";

function definition(
  title: string,
  description: string,
  blocks: FormBlock[],
  effortSeconds: number,
  sections?: DraftFormDefinition["sections"],
): DraftFormDefinition {
  return {
    schemaVersion: 1,
    title,
    description,
    blocks: ordered(blocks),
    ...(sections?.length ? { sections } : {}),
    settings: {
      shuffleBlocks: false,
      progressBar: true,
      requireAuth: false,
      allowPublicAccess: true,
      submitButtonText: "Gửi câu trả lời",
    },
    metadata: { expectedEffortSeconds: effortSeconds, minTimeBarrierSeconds: 15 },
  };
}

// --- Seed: Figma 13a "Thói quen học nhóm của sinh viên" (6 câu · 2 phần) ---

function seed(): Record<string, MockFormDraft> {
  const blocks = [
    choice("q-freq", "Bạn thường học nhóm bao nhiêu buổi mỗi tuần?", ["Không học nhóm", "1 buổi", "2 đến 3 buổi", "Từ 4 buổi trở lên"]),
    choice("q-place", "Bạn hay học nhóm ở đâu?", ["Thư viện trường", "Quán cà phê", "Phòng tự học", "Online (Meet, Zoom)"], { multiple: true }),
    scale("q-help", "Học nhóm giúp bạn hiểu bài hơn đến mức nào?", "Không giúp gì", "Giúp rất nhiều"),
    stars("q-space", "Bạn chấm không gian tự học của trường mấy sao?"),
    choice("q-check", "Để biết bạn đang đọc kỹ, hãy chọn “Đồng ý một phần”.", ["Đồng ý", "Đồng ý một phần", "Không đồng ý"], {
      attention: "opt_2",
    }),
    paragraph("q-why", "Điều gì khiến buổi học nhóm của bạn kém hiệu quả?"),
  ];
  const title = "Thói quen học nhóm của sinh viên";
  return {
    [DEMO_BUILDER_FORM_ID]: {
      id: DEMO_BUILDER_FORM_ID,
      ownerEmail: DEMO_PUBLISHER,
      status: "DRAFT",
      title,
      description: "Khảo sát cho môn Phương pháp nghiên cứu. Khoảng 5 phút, câu trả lời được ẩn danh.",
      rewardPerResponse: 12,
      expectedCompletions: 30,
      estimatedDurationMinutes: 5,
      schema: definition(
        title,
        "Khảo sát cho môn Phương pháp nghiên cứu. Khoảng 5 phút, câu trả lời được ẩn danh.",
        blocks,
        300,
        [
          { id: "sec-habits", title: "Thói quen học nhóm", blockIds: ["q-freq", "q-place", "q-help"] },
          { id: "sec-feedback", title: "Trải nghiệm & góp ý", blockIds: ["q-space", "q-check", "q-why"] },
        ],
      ),
      targetingJson: null,
      versionNumber: 1,
      escrowLocked: 0,
      createdAt: hoursAgo(26),
      updatedAt: hoursAgo(2),
      submittedAt: null,
      ai: null,
    },
  };
}

export const formDrafts = createCollection<Record<string, MockFormDraft>>("form-drafts", seed);

export function findFormDraft(id: string): MockFormDraft | undefined {
  return formDrafts.get()[id];
}

export function saveFormDraft(draft: MockFormDraft): MockFormDraft {
  formDrafts.update((all) => {
    all[draft.id] = draft;
  });
  return draft;
}

/** `updatedAt` strictly after `previous` (two saves in one millisecond stay ordered). */
export function nextUpdatedAt(previous: string): string {
  const now = Date.now();
  const prev = Date.parse(previous);
  return new Date(Number.isFinite(prev) && prev >= now ? prev + 1 : now).toISOString();
}

/** The summary row "Khảo sát của tôi" lists (shared `publisherForms`). */
export function syncPublisherForm(draft: MockFormDraft): void {
  const summary = {
    title: draft.title,
    status: draft.status,
    rewardPerResponse: draft.rewardPerResponse,
    expectedCompletions: draft.expectedCompletions,
    escrowLocked: draft.escrowLocked,
    estimatedEffortSeconds: (draft.estimatedDurationMinutes ?? 0) * 60 || draft.schema.metadata.expectedEffortSeconds,
    submittedAt: draft.submittedAt,
    versionNumber: draft.versionNumber,
    deadlineAt: draft.deadlineAt ?? null,
  };
  if (findPublisherForm(draft.id)) {
    updatePublisherForm(draft.id, (form) => Object.assign(form, summary));
    return;
  }
  addPublisherForm({
    id: draft.id,
    ownerEmail: draft.ownerEmail,
    type: "INTERNAL",
    completedCompletions: 0,
    externalUrl: null,
    createdAt: draft.createdAt,
    publishedAt: null,
    closedAt: null,
    rejection: null,
    ...summary,
  });
}

export function createFormDraft(input: {
  ownerEmail: string;
  title: string;
  description: string | null;
  rewardPerResponse: number;
  expectedCompletions: number;
  estimatedDurationMinutes: number | null;
  schema?: DraftFormDefinition;
}): MockFormDraft {
  const now = nowIso();
  const draft: MockFormDraft = {
    id: mockId(),
    ownerEmail: input.ownerEmail,
    status: "DRAFT",
    title: input.title,
    description: input.description,
    rewardPerResponse: input.rewardPerResponse,
    expectedCompletions: input.expectedCompletions,
    estimatedDurationMinutes: input.estimatedDurationMinutes,
    schema: input.schema ?? definition(input.title, input.description ?? "", [], 60),
    targetingJson: null,
    versionNumber: 1,
    escrowLocked: 0,
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    ai: null,
  };
  saveFormDraft(draft);
  syncPublisherForm(draft);
  return draft;
}

/** Registers the seeded demo draft in "Khảo sát của tôi" once. */
export function ensureDemoDraftListed(): void {
  const demo = findFormDraft(DEMO_BUILDER_FORM_ID);
  if (demo && !findPublisherForm(DEMO_BUILDER_FORM_ID)) syncPublisherForm(demo);
}

// --- Demo: a running Form Builder survey per publisher ("Chỉnh sửa" → new version) ---

/** MOCK-ONLY: which demo running survey each account got (email → form id). */
const demoRunningForms = createCollection<Record<string, string>>("demo-running-forms", () => ({}));

/**
 * Gives `ownerEmail` one approved, running In-Rescom survey the first time its
 * list loads, so "Chỉnh sửa" (`POST /forms/:id/versions`) can be tried without
 * going through publish + Admin approval. Created once per account.
 */
export function ensureDemoRunningForm(ownerEmail: string): void {
  if (demoRunningForms.get()[ownerEmail]) return;
  const title = "Thói quen dùng thư viện của sinh viên";
  const description = "Khảo sát ngắn về cách sinh viên dùng thư viện trường. Khoảng 4 phút, câu trả lời được ẩn danh.";
  const blocks = [
    choice("lib-freq", "Bạn đến thư viện trường bao nhiêu lần mỗi tuần?", ["Không đến", "1 lần", "2 đến 3 lần", "Từ 4 lần trở lên"]),
    choice("lib-purpose", "Bạn thường đến thư viện để làm gì?", ["Tự học", "Mượn sách", "Học nhóm", "Dùng máy tính / Wi-Fi"], {
      multiple: true,
    }),
    scale("lib-quiet", "Không gian thư viện yên tĩnh đến mức nào?", "Rất ồn", "Rất yên tĩnh"),
    stars("lib-rate", "Bạn chấm thư viện trường mấy sao?"),
    paragraph("lib-wish", "Bạn muốn thư viện cải thiện điều gì nhất?"),
  ];
  const expected = 30;
  const completed = 12;
  const reward = 10;
  const escrow = (expected - completed) * escrowDrawPerCompletion({ type: "INTERNAL", rewardPerResponse: reward });
  const draft: MockFormDraft = {
    id: mockId(),
    ownerEmail,
    status: "PUBLISHED",
    title,
    description,
    rewardPerResponse: reward,
    expectedCompletions: expected,
    estimatedDurationMinutes: 4,
    schema: definition(title, description, blocks, 240),
    targetingJson: null,
    versionNumber: 1,
    escrowLocked: escrow,
    createdAt: hoursAgo(24 * 3),
    updatedAt: hoursAgo(24 * 2),
    submittedAt: hoursAgo(24 * 3),
    ai: null,
  };
  saveFormDraft(draft);
  syncPublisherForm(draft);
  updatePublisherForm(draft.id, (form) => {
    form.completedCompletions = completed;
    form.publishedAt = hoursAgo(24 * 2);
    form.deadlineAt = hoursAgo(-24 * 7);
    form.questionCount = blocks.length;
  });
  demoRunningForms.update((all) => {
    all[ownerEmail] = draft.id;
  });
}
