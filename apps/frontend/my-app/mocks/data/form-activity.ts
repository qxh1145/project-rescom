import { escrowDrawPerCompletion } from "@rescom/schemas";
import type { MockSessionUser } from "../db/session";
import { createCollection, mockId, nowIso } from "../db/store";
import { payRewardFromSurveyEscrow, walletOf } from "./economy";
import { generateQualitySnapshot, generateResponses, generateTracking } from "./form-activity-rules";
import { findFormDraft } from "./form-drafts";
import { formResponses, QUALITY_SNAPSHOTS, type MockQualitySnapshot } from "./form-responses";
import { formVersions, versionsOf } from "./form-versions";
import { findPublisherForm, updatePublisherForm } from "./forms";
import { formTracking } from "./forms-manage";
import { findSurvey, updateSurvey } from "./surveys";

/**
 * MOCK-ONLY activity of Form Builder (In-Rescom) surveys, so the publisher's
 * Tiến độ / Câu trả lời / Chất lượng tabs have something to show without real
 * respondents. Seeded surveys (`forms-manage.ts`, `form-responses.ts`) keep
 * their Figma data; this only fills surveys that have a builder draft:
 *
 * - the published version row (`form-versions`) built from the draft's blocks;
 * - once per survey, a newly approved survey nobody has taken yet gets ~40%
 *   of its quota, each reward drawn from the owner's Ký quỹ like a real payout;
 * - one response per completion, answers generated from the blocks;
 * - tracking (opens chart, bỏ dở, ratings) and a quality snapshot, regenerated
 *   whenever the completion count changes.
 */

interface ActivityState {
  simulated: boolean;
  /** Completion count and live version the tracking/snapshot were generated for. */
  generatedFor: number | null;
  generatedVersion?: number | null;
  snapshots: MockQualitySnapshot[];
}

const activity = createCollection<Record<string, ActivityState>>("form-activity", () => ({}));

const SIMULATED_SHARE = 0.4;
/** Keeps the one-off payout loop (one ledger row each) small on big quotas. */
const SIMULATED_MAX = 200;

/**
 * Ensures the version respondents took exists; null = not a published builder
 * survey. A live (or owner-closed after approval) survey collects on its
 * current version; a re-versioned one — new version in draft, in review,
 * rejected, or withdrawn by closing — on the one before. The builder draft
 * tells them apart: only an approved version leaves it PUBLISHED.
 */
function ensureVersion(formId: string) {
  const form = findPublisherForm(formId);
  const draft = findFormDraft(formId);
  if (!form || !draft || form.type !== "INTERNAL" || !form.publishedAt) return null;
  const current =
    form.status === "PUBLISHED" ||
    (form.status === "CLOSED" && form.closeKind !== "MODERATION" && draft.status === "PUBLISHED");
  const liveNumber = current ? form.versionNumber : form.versionNumber - 1;
  if (liveNumber < 1) return null;
  syncCollectedUntil(formId, liveNumber, form.closedAt);
  const existing = versionsOf(formId).find((version) => version.versionNumber === liveNumber && version.isPublished);
  if (existing) return existing;
  // The draft only keeps the newest blocks: an older live version borrows them (MOCK-ONLY approximation).
  const version = {
    id: mockId(),
    formId,
    versionNumber: liveNumber,
    isPublished: true,
    publishedAt: form.publishedAt,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
    submittedForReviewAt: draft.submittedAt,
    collectedFrom: form.publishedAt,
    collectedUntil: form.closedAt,
    blocks: structuredClone(draft.schema.blocks),
  };
  formVersions.update((all) => {
    all.push(version);
  });
  return version;
}

/** 17a "dd/mm – dd/mm": older published versions stop collecting when a newer one goes live or the survey closes. */
function syncCollectedUntil(formId: string, liveNumber: number, closedAt: string | null): void {
  const versions = versionsOf(formId);
  const stale = versions.filter(
    (version) =>
      version.isPublished && version.collectedUntil === null && (version.versionNumber < liveNumber || closedAt !== null),
  );
  if (!stale.length) return;
  const newerStart = (number: number) =>
    versions.find((version) => version.versionNumber > number && version.isPublished)?.collectedFrom ?? null;
  formVersions.update((all) => {
    for (const version of all) {
      if (!stale.some((item) => item.id === version.id)) continue;
      version.collectedUntil = newerStart(version.versionNumber) ?? closedAt ?? nowIso();
    }
  });
}

/** Pays ~40% of the quota once from the owner's Ký quỹ (stops early if the escrow runs short). */
function simulateCompletions(formId: string, owner: MockSessionUser): void {
  const form = findPublisherForm(formId);
  if (!form || form.status !== "PUBLISHED" || form.completedCompletions > 0) return;
  const draw = escrowDrawPerCompletion(form);
  if (draw <= 0) return;
  const wanted = Math.min(SIMULATED_MAX, Math.max(1, Math.round(form.expectedCompletions * SIMULATED_SHARE)));
  const affordable = Math.floor(Math.min(form.escrowLocked, walletOf(owner).escrow) / draw);
  let paid = 0;
  for (let index = 0; index < Math.min(wanted, affordable); index += 1) {
    try {
      payRewardFromSurveyEscrow(owner, { amount: draw, surveyId: form.id, attemptId: mockId(), title: form.title });
      paid += 1;
    } catch {
      break;
    }
  }
  if (paid === 0) return;
  updatePublisherForm(form.id, (draft) => {
    draft.completedCompletions += paid;
    draft.escrowLocked -= paid * draw;
  });
  if (findSurvey(form.id)) {
    updateSurvey(form.id, (survey) => {
      survey.completedCompletions = Math.min(survey.expectedCompletions, survey.completedCompletions + paid);
    });
  }
}

/**
 * Fills a builder survey's activity. `viewer` = the signed-in user; only its
 * owner triggers the simulated completions (Admins just read what exists).
 */
export function ensureFormActivity(formId: string, viewer: MockSessionUser | null): void {
  const version = ensureVersion(formId);
  if (!version) return;
  const stored = activity.get()[formId];
  const state: ActivityState = stored
    ? structuredClone(stored)
    : { simulated: false, generatedFor: null, generatedVersion: null, snapshots: [] };
  const initial = findPublisherForm(formId);
  if (!state.simulated && viewer && initial?.ownerEmail === viewer.email) {
    simulateCompletions(formId, viewer);
    state.simulated = true;
  }

  const form = findPublisherForm(formId);
  if (!form?.publishedAt) return;
  const seed = form.id;
  const rows = formResponses.get().filter((row) => row.formId === formId);
  const missing = form.completedCompletions - rows.length;
  if (missing > 0) {
    const added = generateResponses({
      seed,
      formId,
      versionNumber: version.versionNumber,
      blocks: version.blocks,
      count: missing,
      startIndex: rows.length,
      // New rows come after the ones already listed, within this version's window.
      from: rows.reduce(
        (latest, row) => (Date.parse(row.submittedAt) > Date.parse(latest) ? row.submittedAt : latest),
        version.collectedFrom ?? form.publishedAt,
      ),
      until: form.closedAt ?? nowIso(),
      effortSeconds: form.estimatedEffortSeconds,
      takenCodes: new Set(rows.map((row) => row.code)),
    });
    formResponses.update((all) => {
      all.push(...added);
    });
  }

  if (state.generatedFor !== form.completedCompletions || state.generatedVersion !== version.versionNumber) {
    const current = formResponses.get().filter((row) => row.formId === formId);
    const now = form.closedAt ? Date.parse(form.closedAt) : Date.now();
    // Tiến độ covers the whole survey…
    const tracking = generateTracking({
      seed,
      completed: form.completedCompletions,
      durations: current.map((row) => row.durationSeconds),
      publishedAt: form.publishedAt,
      now,
    });
    formTracking.update((all) => {
      all[formId] = tracking;
    });
    // …while Chất lượng (17) is per version: its own funnel over that version's rows.
    // A single-version survey shares the Tiến độ numbers.
    const ofVersion = current.filter((row) => row.versionNumber === version.versionNumber);
    const versionFunnel =
      ofVersion.length === current.length
        ? tracking
        : generateTracking({
            seed: `${seed}:v${version.versionNumber}`,
            completed: ofVersion.length,
            durations: ofVersion.map((row) => row.durationSeconds),
            publishedAt: version.collectedFrom ?? form.publishedAt,
            now,
          });
    state.snapshots = [
      ...state.snapshots.filter((snapshot) => snapshot.versionNumber !== version.versionNumber),
      generateQualitySnapshot({
        seed,
        formId,
        versionNumber: version.versionNumber,
        blocks: version.blocks,
        tracking: versionFunnel,
        responses: ofVersion,
      }),
    ];
    state.generatedFor = form.completedCompletions;
    state.generatedVersion = version.versionNumber;
  }
  if (JSON.stringify(state) !== JSON.stringify(stored)) {
    activity.update((all) => {
      all[formId] = state;
    });
  }
}

/** Figma 17 snapshot: the seeded one, else the generated one. */
export function qualitySnapshotOf(formId: string, versionNumber: number): MockQualitySnapshot | undefined {
  return (
    QUALITY_SNAPSHOTS.find((item) => item.formId === formId && item.versionNumber === versionNumber) ??
    activity.get()[formId]?.snapshots.find((item) => item.versionNumber === versionNumber)
  );
}
