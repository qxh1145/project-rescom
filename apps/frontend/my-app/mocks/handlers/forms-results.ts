import {
  decodePublisherResponsesCursor,
  encodePublisherResponsesCursor,
  projectPublisherAnswers,
  publisherFormVersionDetailSchema,
  publisherResponsesPageSchema,
  publisherResponsesQuerySchema,
  toPublisherQuestions,
  type FormBlock,
} from "@rescom/schemas";
import { http, type RequestHandler } from "msw";
import { apiUrl, isHybridMocking } from "@/lib/api/config";
import { ensureFormActivity, qualitySnapshotOf } from "../data/form-activity";
import { QUALITY_MINIMUM_RESPONSES, responsesOf, versionsWithResponses } from "../data/form-responses";
import { findVersion, versionsOf, type MockFormVersion } from "../data/form-versions";
import { findPublisherForm, type MockPublisherForm } from "../data/forms";
import { getMockSessionUser } from "../db/session";
import { fail, ok, unauthorized } from "../envelope";
import { demoSeed } from "../hybrid";
import { applyScenario } from "../scenarios";

/**
 * Phase 5C — publisher results. Responses and one version's detail are
 * VERIFIED (Story IR.4a, shared schemas of `@rescom/schemas`, parsed here for
 * parity); `GET /forms/:id/versions` is VERIFIED (stats fields ASSUMED);
 * quality stays MSW-only (Epic 10 deferred).
 */

const formNotFound = (id: string) => fail(404, "FORM_NOT_FOUND", `Form with ID "${id}" was not found.`);

/**
 * Session + form lookup. `ownerOnly` (Story IR.4a: progress, responses,
 * analytics, version detail): anybody but the owner — an Admin included —
 * gets 404 `FORM_NOT_FOUND`. Otherwise (versions list, quality) an Admin may
 * read and another user gets 403 `FORM_FORBIDDEN`, like `GET /forms/:id`.
 */
export async function ownedForm(
  id: string,
  options: { ownerOnly: boolean } = { ownerOnly: true },
): Promise<{ form: MockPublisherForm } | { error: Response }> {
  const user = await getMockSessionUser();
  if (!user) return { error: unauthorized() };
  const form = findPublisherForm(id);
  if (!form) return { error: formNotFound(id) };
  if (form.ownerEmail !== user.email) {
    if (options.ownerOnly) return { error: formNotFound(id) };
    if (user.role !== "ADMIN") return { error: fail(403, "FORM_FORBIDDEN", "You do not have access to this form.") };
  }
  // MOCK-ONLY: Form Builder surveys get their version, responses and quality snapshot.
  ensureFormActivity(form.id, user);
  return { form: findPublisherForm(id) ?? form };
}

/** The shared question projection (same as the backend). */
export function questionsOf(blocks: FormBlock[]) {
  return toPublisherQuestions(blocks);
}

/** Backend feed order: `submittedAt DESC, id DESC`. */
export function feedOrder<T extends { id: string; submittedAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/** `?versionNumber=` or the newest version with responses (else the newest published one). */
export function pickVersion(form: MockPublisherForm, raw: string | null): MockFormVersion | undefined {
  const versions = versionsOf(form.id);
  const requested = Number(raw);
  if (raw && Number.isInteger(requested)) return versions.find((version) => version.versionNumber === requested);
  const withData = versionsWithResponses(form.id)[0];
  return (
    versions.find((version) => version.versionNumber === withData) ??
    [...versions].reverse().find((version) => version.isPublished) ??
    versions[versions.length - 1]
  );
}

function versionNotFound() {
  return fail(404, "FORM_VERSION_NOT_FOUND", "Form version not found.");
}

const DEMO_QUESTION_TYPES = ["single_choice", "multiple_choice", "linear_scale", "text", "rating", "textarea"] as const;

/**
 * Hybrid (gate G): the form is the backend's (any UUID, never in the mock DB),
 * so its quality is demo data seeded by form id + version — the same numbers on
 * every visit. Shape as below (`formQualitySchema`), always "enough data".
 */
function hybridQualityOf(formId: string, rawVersion: string | null) {
  const requested = Number(rawVersion);
  const versionNumber = rawVersion && Number.isInteger(requested) && requested > 0 ? requested : 1;
  const seed = demoSeed(`${formId}:v${versionNumber}`);
  const pick = (shift: number, size: number) => (seed >>> shift) % size;
  const responses = 24 + pick(0, 60);
  const needsReview = 1 + pick(4, 4);
  const questionCount = 6 + pick(8, 5);
  const dropOff = Array.from({ length: questionCount }, (_, index) => ({
    questionNumber: index + 1,
    questionType: DEMO_QUESTION_TYPES[(index + pick(12, 6)) % DEMO_QUESTION_TYPES.length],
    required: index % 3 !== 2,
    count: (seed >>> (index % 24)) % 3,
  }));
  const peak = 1 + pick(16, questionCount);
  dropOff[peak - 1].count = 4 + pick(20, 5);
  const medianDurationSeconds = 150 + pick(10, 120);
  return {
    versionNumber,
    status: "ENOUGH_DATA",
    confidence: responses >= 50 ? "HIGH" : "MEDIUM",
    policyVersion: "survey-quality-v1",
    basedOnResponses: responses,
    minimumResponses: QUALITY_MINIMUM_RESPONSES,
    updatedAt: new Date(Date.now() - (1 + pick(6, 20)) * 3_600_000).toISOString(),
    formType: "INTERNAL",
    questionCount,
    started: responses + 8 + pick(14, 10),
    abandoned: 8 + pick(14, 10),
    medianDurationSeconds,
    declaredEffortSeconds: medianDurationSeconds + 60,
    technicalErrors: pick(18, 2),
    feedback: { average: (36 + pick(22, 12)) / 10, count: Math.round(responses / 3) },
    passed: responses - needsReview,
    needsReview,
    dropOff,
    suggestions: [
      {
        code: "DROP_OFF_QUESTION",
        params: { questionNumber: peak, count: dropOff[peak - 1].count, questionType: dropOff[peak - 1].questionType, required: dropOff[peak - 1].required },
        fixedInVersion: null,
      },
      { code: "EFFORT_OVERESTIMATED", params: { medianMinutes: Math.round(medianDurationSeconds / 60) }, fixedInVersion: null },
      {
        code: "RESPONSE_QUALITY",
        params: { passed: responses - needsReview, needsReview, questionCount, normal: needsReview / responses <= 0.2 },
        fixedInVersion: null,
      },
    ],
  };
}

export const formsResultsHandlers: RequestHandler[] = [
  // VERIFIED (Story IR.4a): GET /forms/:id/responses[?versionNumber&cursor&limit] — one keyset page.
  http.get(apiUrl("/forms/:id/responses"), async ({ params, request }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    // Backend order: the query pipe runs before the service's ownership check.
    const query = publisherResponsesQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return fail(400, "VALIDATION_ERROR", "Invalid query.", { details: query.error.format() });
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const { form } = owned;
    if (form.type === "EXTERNAL") {
      return ok(
        publisherResponsesPageSchema.parse({
          availability: "NOT_APPLICABLE",
          reason: "EXTERNAL_FORM",
          form: { id: form.id, title: form.title, type: "EXTERNAL", externalUrl: form.externalUrl },
        }),
      );
    }
    const version = pickVersion(form, query.data.versionNumber ? String(query.data.versionNumber) : null);
    if (!version) return versionNotFound();
    const rows = feedOrder(responsesOf(form.id, version.versionNumber));
    let start = 0;
    if (query.data.cursor) {
      const cursor = decodePublisherResponsesCursor(query.data.cursor);
      const at = cursor && cursor.versionId === version.id ? rows.findIndex((row) => row.id === cursor.id) : -1;
      if (at < 0) return fail(400, "INVALID_CURSOR", "The cursor is invalid or belongs to another version.");
      start = at + 1;
    }
    const page = rows.slice(start, start + query.data.limit);
    const last = page[page.length - 1];
    const hasMore = start + query.data.limit < rows.length;
    const questions = questionsOf(version.blocks);
    return ok(
      publisherResponsesPageSchema.parse({
        availability: "AVAILABLE",
        form: { id: form.id, title: form.title, type: "INTERNAL", versionId: version.id, versionNumber: version.versionNumber },
        questions,
        responses: page.map((row) => ({
          id: row.id,
          code: row.code,
          formVersionId: version.id,
          submittedAt: row.submittedAt,
          durationSeconds: row.durationSeconds,
          integrity: { applicability: "NOT_ASSESSED" },
          answers: projectPublisherAnswers(row.answers, questions),
        })),
        totalCount: rows.length,
        nextCursor:
          hasMore && last
            ? encodePublisherResponsesCursor({
                versionId: version.id,
                submittedAt: new Date(last.submittedAt).toISOString(),
                id: last.id,
              })
            : null,
      }),
    );
  }),

  // ASSUMED API CONTRACT: GET /forms/:id/quality[?versionNumber=] (stays MSW-only, Epic 10).
  http.get(apiUrl("/forms/:id/quality"), async ({ params, request }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    if (isHybridMocking) return ok(hybridQualityOf(String(params.id), new URL(request.url).searchParams.get("versionNumber")));
    const owned = await ownedForm(String(params.id), { ownerOnly: false });
    if ("error" in owned) return owned.error;
    const { form } = owned;
    const version = pickVersion(form, new URL(request.url).searchParams.get("versionNumber"));
    if (!version) return versionNotFound();
    const rows = responsesOf(form.id, version.versionNumber);
    const snapshot = qualitySnapshotOf(form.id, version.versionNumber);
    const questions = form.type === "INTERNAL" ? questionsOf(version.blocks) : [];
    const needsReview = rows.filter((row) => row.quality === "NEEDS_REVIEW").length;
    const enough = rows.length >= QUALITY_MINIMUM_RESPONSES;
    const dropOff = questions.map((question) => ({
      questionNumber: question.number,
      questionType: question.type,
      required: question.required,
      count: snapshot?.dropOffByQuestion[question.number] ?? 0,
    }));
    const suggestions = [];
    if (enough) {
      const peak = [...dropOff].sort((a, b) => b.count - a.count)[0];
      // A newer version (draft or approved) that already fixes it ("Sửa ở v2").
      const draft = versionsOf(form.id).find((item) => item.versionNumber > version.versionNumber);
      if (peak && peak.count > 1) {
        suggestions.push({
          code: "DROP_OFF_QUESTION",
          params: { questionNumber: peak.questionNumber, count: peak.count, questionType: peak.questionType, required: peak.required },
          fixedInVersion: draft?.versionNumber ?? null,
        });
      }
      if (snapshot?.answerChangesQuestion) {
        suggestions.push({
          code: "ANSWER_CHANGES",
          params: { questionNumber: snapshot.answerChangesQuestion },
          fixedInVersion: draft?.versionNumber ?? null,
        });
      }
      const median = snapshot?.medianDurationSeconds;
      if (median && form.estimatedEffortSeconds - median >= 45) {
        suggestions.push({ code: "EFFORT_OVERESTIMATED", params: { medianMinutes: Math.round(median / 60) }, fixedInVersion: null });
      }
      suggestions.push({
        code: "RESPONSE_QUALITY",
        params: { passed: rows.length - needsReview, needsReview, questionCount: questions.length, normal: needsReview / rows.length <= 0.2 },
        fixedInVersion: null,
      });
    }
    return ok({
      versionNumber: version.versionNumber,
      status: enough ? "ENOUGH_DATA" : "NOT_ENOUGH_DATA",
      confidence: enough ? (rows.length >= 50 ? "HIGH" : "MEDIUM") : rows.length ? "LOW" : null,
      policyVersion: "survey-quality-v1",
      basedOnResponses: rows.length,
      minimumResponses: QUALITY_MINIMUM_RESPONSES,
      updatedAt: snapshot?.updatedAt ?? (rows[0]?.submittedAt ?? null),
      formType: form.type,
      questionCount: questions.length,
      started: snapshot?.started ?? rows.length,
      abandoned: snapshot?.abandoned ?? 0,
      medianDurationSeconds: snapshot?.medianDurationSeconds ?? null,
      declaredEffortSeconds: form.estimatedEffortSeconds,
      technicalErrors: snapshot?.technicalErrors ?? 0,
      feedback: snapshot?.feedback ?? { average: null, count: 0 },
      passed: rows.length - needsReview,
      needsReview,
      dropOff,
      suggestions,
    });
  }),

  // VERIFIED: GET /forms/:id/versions (FormVersionSummaryDto[], ascending).
  http.get(apiUrl("/forms/:id/versions"), async ({ params }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const owned = await ownedForm(String(params.id), { ownerOnly: false });
    if ("error" in owned) return owned.error;
    const { form } = owned;
    return ok(
      versionsOf(form.id).map((version) => ({
        id: version.id,
        formId: version.formId,
        versionNumber: version.versionNumber,
        isPublished: version.isPublished,
        publishedAt: version.publishedAt,
        createdAt: version.createdAt,
      })),
    );
  }),

  // VERIFIED (Story IR.4a Q3): GET /forms/:id/versions/:versionId — owner only, shared schema.
  http.get(apiUrl("/forms/:id/versions/:versionId"), async ({ params }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const version = findVersion(owned.form.id, String(params.versionId));
    if (!version) return versionNotFound();
    return ok(
      publisherFormVersionDetailSchema.parse({
        id: version.id,
        formId: version.formId,
        versionNumber: version.versionNumber,
        isPublished: version.isPublished,
        publishedAt: version.publishedAt,
        createdAt: version.createdAt,
        externalUrl: owned.form.type === "EXTERNAL" ? owned.form.externalUrl : null,
        schemaJson: { schemaVersion: 1, title: owned.form.title, blocks: version.blocks },
      }),
    );
  }),
];
