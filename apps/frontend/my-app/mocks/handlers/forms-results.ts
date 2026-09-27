import type { FormBlock } from "@rescom/schemas";
import { http, type RequestHandler } from "msw";
import { apiUrl } from "@/lib/api/config";
import {
  QUALITY_MINIMUM_RESPONSES,
  QUALITY_SNAPSHOTS,
  responsesOf,
  versionsWithResponses,
} from "../data/form-responses";
import { findVersion, versionsOf, type MockFormVersion } from "../data/form-versions";
import { findPublisherForm, type MockPublisherForm } from "../data/forms";
import { getMockSessionUser } from "../db/session";
import { fail, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Phase 5C — publisher results. `GET /forms/:id/versions` is VERIFIED
 * (`forms.controller.ts`, stats fields ASSUMED); responses, quality and one
 * version's blocks are ASSUMED (see `lib/forms/results-service.ts`).
 */

/** ASSUMED short column headers (Figma 10d "C1 · Chỗ ở hiện tại"…). */
const SHORT_LABELS: Record<string, string> = {
  "house-q1": "Chỗ ở hiện tại",
  "house-q3": "Ngân sách/tháng",
  "house-q5": "Hài lòng",
};

async function ownedForm(id: string): Promise<{ form: MockPublisherForm } | { error: Response }> {
  const user = await getMockSessionUser();
  if (!user) return { error: unauthorized() };
  const form = findPublisherForm(id);
  if (!form) return { error: fail(404, "FORM_NOT_FOUND", `Form with ID "${id}" was not found.`) };
  if (form.ownerEmail !== user.email && user.role !== "ADMIN") {
    return { error: fail(403, "FORM_FORBIDDEN", "You do not have access to this form.") };
  }
  return { form };
}

function questionsOf(blocks: FormBlock[]) {
  return [...blocks]
    .sort((a, b) => a.order - b.order)
    .map((block, index) => ({
      id: block.id,
      number: index + 1,
      title: block.title,
      shortLabel: SHORT_LABELS[block.id] ?? null,
      type: block.type,
      required: block.required,
      options:
        block.type === "single_choice" || block.type === "multiple_choice"
          ? block.options.map((option) => ({ value: option.value, label: option.label }))
          : [],
      allowOther: (block.type === "single_choice" || block.type === "multiple_choice") && block.allowOther === true,
      scale:
        block.type === "linear_scale"
          ? { min: block.min, max: block.max, minLabel: block.minLabel ?? null, maxLabel: block.maxLabel ?? null }
          : block.type === "rating"
            ? { min: 1, max: block.maxRating, minLabel: null, maxLabel: null }
            : null,
    }));
}

/** `?versionNumber=` or the newest version with responses (else the newest published one). */
function pickVersion(form: MockPublisherForm, raw: string | null): MockFormVersion | undefined {
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

export const formsResultsHandlers: RequestHandler[] = [
  // ASSUMED API CONTRACT: GET /forms/:id/responses[?versionNumber=]
  http.get(apiUrl("/forms/:id/responses"), async ({ params, request }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const { form } = owned;
    const version = pickVersion(form, new URL(request.url).searchParams.get("versionNumber"));
    if (!version) return versionNotFound();
    return ok({
      form: {
        id: form.id,
        title: form.title,
        type: form.type,
        versionNumber: version.versionNumber,
        estimatedEffortSeconds: form.estimatedEffortSeconds,
        externalUrl: form.externalUrl,
      },
      questions: form.type === "INTERNAL" ? questionsOf(version.blocks) : [],
      responses: responsesOf(form.id, version.versionNumber).map((row) => ({
        id: row.id,
        code: row.code,
        submittedAt: row.submittedAt,
        durationSeconds: row.durationSeconds,
        quality: row.quality,
        reviewReasons: row.reviewReasons,
        answers: row.answers,
        codeVerified: row.codeVerified,
      })),
    });
  }),

  // ASSUMED API CONTRACT: GET /forms/:id/quality[?versionNumber=]
  http.get(apiUrl("/forms/:id/quality"), async ({ params, request }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const { form } = owned;
    const version = pickVersion(form, new URL(request.url).searchParams.get("versionNumber"));
    if (!version) return versionNotFound();
    const rows = responsesOf(form.id, version.versionNumber);
    const snapshot = QUALITY_SNAPSHOTS.find(
      (item) => item.formId === form.id && item.versionNumber === version.versionNumber,
    );
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

  // VERIFIED: GET /forms/:id/versions (FormVersionSummaryDto[], ascending) + ASSUMED stats.
  http.get(apiUrl("/forms/:id/versions"), async ({ params }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const { form } = owned;
    return ok(
      versionsOf(form.id).map((version) => {
        const count = responsesOf(form.id, version.versionNumber).length;
        return {
          id: version.id,
          formId: version.formId,
          versionNumber: version.versionNumber,
          isPublished: version.isPublished,
          publishedAt: version.publishedAt,
          createdAt: version.createdAt,
          updatedAt: version.updatedAt,
          submittedForReviewAt: version.submittedForReviewAt,
          collectedFrom: version.collectedFrom,
          collectedUntil: version.collectedUntil,
          responseCount: count,
          questionCount: form.type === "INTERNAL" ? version.blocks.length : null,
          qualityStatus: count >= QUALITY_MINIMUM_RESPONSES ? "ENOUGH_DATA" : "NOT_ENOUGH_DATA",
        };
      }),
    );
  }),

  // ASSUMED API CONTRACT: GET /forms/:id/versions/:versionId (FormVersionDto-like, with blocks).
  http.get(apiUrl("/forms/:id/versions/:versionId"), async ({ params }) => {
    const forced = await applyScenario("forms-results");
    if (forced) return forced;
    const owned = await ownedForm(String(params.id));
    if ("error" in owned) return owned.error;
    const version = findVersion(owned.form.id, String(params.versionId));
    if (!version) return versionNotFound();
    return ok({
      id: version.id,
      formId: version.formId,
      versionNumber: version.versionNumber,
      isPublished: version.isPublished,
      publishedAt: version.publishedAt,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      schemaJson: { schemaVersion: 1, title: owned.form.title, blocks: version.blocks },
    });
  }),
];
