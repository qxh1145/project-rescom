import {
  formBlockTypeEnum,
  formVersionSummarySchema as sharedFormVersionSummarySchema,
  formTypeEnum,
  publisherFormVersionDetailSchema,
  publisherResponsesPageSchema,
  type PublisherResponseAnswerValue,
  type PublisherResponseQuestion,
  type PublisherResponseRow,
  type PublisherResponsesPage,
} from "@rescom/schemas";
import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Phase 5C — publisher results (Figma 10d, 10d', 10e, 17, 17a).
 *
 * | Endpoint | Label |
 * |---|---|
 * | `GET /forms/:id/responses[?versionNumber&cursor&limit]` | VERIFIED (Story IR.4a, shared `publisherResponsesPageSchema`) — one keyset page of one version, newest first |
 * | `GET /forms/:id/quality[?versionNumber=]` | ASSUMED API CONTRACT — survey quality (policy `survey-quality-v1`); stays on MSW (Epic 10 deferred) |
 * | `GET /forms/:id/versions` | VERIFIED (`forms.controller.ts` → `FormVersionSummaryDto[]`, ascending); the stats fields are ASSUMED optional extensions |
 * | `GET /forms/:id/versions/:versionId` | VERIFIED (Story IR.4a, shared `publisherFormVersionDetailSchema`) — one version with its blocks |
 *
 * Responses, analytics, progress and version detail are owner only: anybody
 * else (an Admin included) gets 404 `FORM_NOT_FOUND`; an unknown version 404
 * `FORM_VERSION_NOT_FOUND`. `collectFormResponses` walks the cursor up to
 * `RESPONSES_MAX_PAGES` so search, pagination and the export stay client-side
 * (`results-view.ts`, `results-export.ts`). Google Forms surveys answer
 * `NOT_APPLICABLE`: their answers stay in Google.
 */

const isoDate = z.string().min(1);

export type ResultQuestion = PublisherResponseQuestion;
export type AnswerValue = PublisherResponseAnswerValue;
/** One listed response: never graded in Phase 1 (`integrity.applicability` NOT_ASSESSED). */
export type FormResponse = PublisherResponseRow;
export type FormResponsesPage = PublisherResponsesPage;
type AvailablePage = Extract<PublisherResponsesPage, { availability: "AVAILABLE" }>;
type NotApplicablePage = Extract<PublisherResponsesPage, { availability: "NOT_APPLICABLE" }>;

/** Every collected row of one version (`collectFormResponses`). */
export type FormResponses =
  | (AvailablePage & { truncated: boolean })
  | (NotApplicablePage & { truncated: false });

/** Collected rows of an Internal survey (narrowed on `availability`). */
export type AvailableFormResponses = Extract<FormResponses, { availability: "AVAILABLE" }>;

/** Rows per request while collecting (the backend maximum). */
export const RESPONSES_PAGE_LIMIT = 100;
/** Story IR.4a AC8.1: at most 20 pages (2 000 newest rows) are loaded in the browser. */
export const RESPONSES_MAX_PAGES = 20;

export const formQualitySchema = z.object({
  versionNumber: z.number().int().positive(),
  status: z.enum(["ENOUGH_DATA", "NOT_ENOUGH_DATA"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
  policyVersion: z.string(),
  basedOnResponses: z.number().int().nonnegative(),
  minimumResponses: z.number().int().nonnegative(),
  updatedAt: isoDate.nullable(),
  formType: formTypeEnum,
  questionCount: z.number().int().nonnegative(),
  started: z.number().int().nonnegative(),
  abandoned: z.number().int().nonnegative(),
  medianDurationSeconds: z.number().nonnegative().nullable(),
  declaredEffortSeconds: z.number().int().nonnegative(),
  technicalErrors: z.number().int().nonnegative(),
  feedback: z.object({ average: z.number().nullable(), count: z.number().int().nonnegative() }),
  passed: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  /** One entry per question of the version (INTERNAL); empty for Google Forms. */
  dropOff: z.array(
    z.object({
      questionNumber: z.number().int().positive(),
      questionType: formBlockTypeEnum,
      required: z.boolean(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /** Codes + numbers; the copy lives in `results-quality.ts`. */
  suggestions: z.array(
    z.object({
      code: z.string(),
      params: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
      /** Draft version that already addresses it ("Sửa ở v2"). */
      fixedInVersion: z.number().int().positive().nullable().default(null),
    }),
  ),
});
export type FormQuality = z.infer<typeof formQualitySchema>;

/** `FormVersionSummaryDto` (shared `formVersionSummarySchema`) + ASSUMED optional stats (absent on today's backend). */
export const formVersionSummarySchema = sharedFormVersionSummarySchema.extend({
  updatedAt: isoDate.nullable().optional(),
  submittedForReviewAt: isoDate.nullable().optional(),
  collectedFrom: isoDate.nullable().optional(),
  collectedUntil: isoDate.nullable().optional(),
  responseCount: z.number().int().nonnegative().nullable().optional(),
  questionCount: z.number().int().nonnegative().nullable().optional(),
  qualityStatus: z.enum(["ENOUGH_DATA", "NOT_ENOUGH_DATA"]).nullable().optional(),
});
export type FormVersionSummary = z.infer<typeof formVersionSummarySchema>;

/** Loose block shape: a draft may still hold incomplete blocks. */
export const versionBlockSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    order: z.number().optional(),
    title: z.string().default(""),
    required: z.boolean().default(false),
    options: z.array(z.object({ label: z.string() }).passthrough()).optional(),
  })
  .passthrough();
export type VersionBlock = z.infer<typeof versionBlockSchema>;

/**
 * VERIFIED `GET /forms/:id/versions/:versionId` (shared schema), with the
 * blocks read loosely: a draft version may still hold incomplete blocks.
 */
export const formVersionDetailSchema = publisherFormVersionDetailSchema.extend({
  schemaJson: z.object({ blocks: z.array(versionBlockSchema) }).passthrough(),
});
export type FormVersionDetail = z.infer<typeof formVersionDetailSchema>;

const formPath = (formId: string): `/forms/${string}` => `/forms/${encodeURIComponent(formId)}`;
const versionQuery = (versionNumber?: number | null) =>
  versionNumber ? `?versionNumber=${encodeURIComponent(String(versionNumber))}` : "";

/** VERIFIED: one keyset page of `GET /forms/:id/responses`. */
export function getFormResponsesPage(
  formId: string,
  query: { versionNumber?: number | null; cursor?: string | null; limit?: number },
  signal?: AbortSignal,
): Promise<FormResponsesPage> {
  const params = new URLSearchParams();
  if (query.versionNumber) params.set("versionNumber", String(query.versionNumber));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.limit) params.set("limit", String(query.limit));
  const search = params.toString();
  return apiRequest(`${formPath(formId)}/responses${search ? `?${search}` : ""}`, {
    schema: publisherResponsesPageSchema,
    signal,
  });
}

/**
 * Fetches one page. `versionNumber` is null for the first page (the server
 * picks the version) and then pinned to the first page's version, so a newer
 * version receiving its first response mid-walk cannot switch the walk (the
 * cursor belongs to one version).
 */
type PageFetcher = (cursor: string | null, versionNumber: number | null) => Promise<FormResponsesPage>;

/**
 * Walks `nextCursor` (sequentially: each page needs the previous cursor) up
 * to `RESPONSES_MAX_PAGES`, pinned to the first page's version, de-duplicates
 * by id and returns the first page with every collected row; `truncated` when
 * rows were left behind.
 */
export async function collectResponsePages(
  fetchPage: PageFetcher,
  versionNumber: number | null = null,
): Promise<FormResponses> {
  const first = await fetchPage(null, versionNumber);
  if (first.availability === "NOT_APPLICABLE") return { ...first, truncated: false };
  const seen = new Set<string>();
  const responses: FormResponse[] = [];
  const add = (rows: readonly FormResponse[]) => {
    for (const row of rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      responses.push(row);
    }
  };
  add(first.responses);
  let cursor = first.nextCursor;
  let pages = 1;
  while (cursor && pages < RESPONSES_MAX_PAGES) {
    const page = await fetchPage(cursor, first.form.versionNumber);
    if (page.availability !== "AVAILABLE" || page.form.versionId !== first.form.versionId) break;
    add(page.responses);
    cursor = page.nextCursor;
    pages += 1;
  }
  return { ...first, responses, nextCursor: null, truncated: cursor !== null };
}

/** Every response of one version (up to `RESPONSES_MAX_PAGES` × `RESPONSES_PAGE_LIMIT`), newest first. */
export function collectFormResponses(
  formId: string,
  versionNumber?: number | null,
  signal?: AbortSignal,
): Promise<FormResponses> {
  return collectResponsePages(
    (cursor, pinned) => getFormResponsesPage(formId, { versionNumber: pinned, cursor, limit: RESPONSES_PAGE_LIMIT }, signal),
    versionNumber ?? null,
  );
}

export function getFormQuality(
  formId: string,
  versionNumber?: number | null,
  signal?: AbortSignal,
): Promise<FormQuality> {
  return apiRequest(`${formPath(formId)}/quality${versionQuery(versionNumber)}`, {
    schema: formQualitySchema,
    signal,
  });
}

export function getFormVersions(formId: string, signal?: AbortSignal): Promise<FormVersionSummary[]> {
  return apiRequest(`${formPath(formId)}/versions`, {
    schema: z.array(formVersionSummarySchema),
    signal,
  });
}

export function getFormVersion(formId: string, versionId: string, signal?: AbortSignal): Promise<FormVersionDetail> {
  return apiRequest(`${formPath(formId)}/versions/${encodeURIComponent(versionId)}`, {
    schema: formVersionDetailSchema,
    signal,
  });
}
