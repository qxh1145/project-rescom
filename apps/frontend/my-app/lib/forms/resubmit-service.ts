import {
  estimatedDurationMinutesSchema,
  parseFormDefinitionDraft,
  surveyTargetingSchema,
  type FormTypeEnum,
  type UpdateFormDraftInput,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import { builderFormSchema, type BuilderForm } from "./builder-service.ts";

/**
 * "Sửa & gửi lại" of a rejected in-Rescom survey. The backend closes a
 * rejected survey (`closeKind` MODERATION, final) and only edits DRAFTs, so
 * the Publisher edits a copy:
 *
 * 1. VERIFIED `POST /forms` (`createFormDraftSchema`) → a new INTERNAL draft;
 * 2. VERIFIED `PATCH /forms/:newId/draft` (`updateFormDraftSchema`, optimistic
 *    lock `clientUpdatedAt` = the `updatedAt` step 1 returned) with the
 *    rejected survey's definition, title, description, targeting, reward,
 *    sample size and duration.
 *
 * The caller then opens `/forms/:newId/builder`. One copy per source at a
 * time: a second call while one runs gets the same promise, and a copy whose
 * PATCH failed is filled again on retry instead of creating another draft.
 */

type Request = typeof apiRequest;

/** The rejected survey as `GET /forms/:id` returns it (VERIFIED `FormDetailDto`). */
export interface ResubmitSource {
  id: string;
  type: FormTypeEnum;
  title: string;
  description?: string | null;
  rewardPerResponse: number;
  expectedCompletions: number;
  estimatedDurationMinutes?: number | null;
  currentVersion: { schemaJson?: unknown; targetingJson?: unknown };
}

export type CopyPayload = Omit<UpdateFormDraftInput, "clientUpdatedAt">;

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 2000;

function copyTitle(source: ResubmitSource): string {
  return source.title.trim().slice(0, TITLE_MAX) || "Khảo sát chưa có tên";
}

/**
 * PATCH body of the copy. Only what the backend accepts is sent: an invalid
 * stored definition or targeting is left out (the draft then starts empty /
 * open to everyone) rather than failing the whole copy.
 */
export function copyPayloadOf(source: ResubmitSource): CopyPayload {
  const title = copyTitle(source);
  const payload: CopyPayload = {
    title,
    description: source.description ? source.description.slice(0, DESCRIPTION_MAX) : null,
    rewardPerResponse: source.rewardPerResponse,
    expectedCompletions: Math.max(1, source.expectedCompletions),
  };
  const duration = estimatedDurationMinutesSchema.safeParse(source.estimatedDurationMinutes);
  if (duration.success) payload.estimatedDurationMinutes = duration.data;
  const definition = parseFormDefinitionDraft(source.currentVersion.schemaJson ?? null);
  if (definition.success) {
    const schema = { ...definition.data, title };
    // The definition id belongs to the rejected survey.
    delete schema.id;
    payload.schema = schema;
  }
  const targeting = surveyTargetingSchema.safeParse(source.currentVersion.targetingJson);
  if (targeting.success) payload.targetingJson = targeting.data;
  return payload;
}

const formPath = (id: string) => `/forms/${encodeURIComponent(id)}` as const;

const inFlight = new Map<string, Promise<BuilderForm>>();
/** Copies created by step 1 whose step 2 failed, by source id. */
const unfilled = new Map<string, string>();

async function runCopy(source: ResubmitSource, request: Request): Promise<BuilderForm> {
  const payload = copyPayloadOf(source);
  const pendingId = unfilled.get(source.id);
  // A retry refreshes the copy's `updatedAt` (the lock token) instead of creating another draft.
  const copy = pendingId
    ? await request(formPath(pendingId), { schema: builderFormSchema })
    : await request("/forms", {
        method: "POST",
        body: { title: payload.title, type: "INTERNAL" },
        schema: builderFormSchema,
      });
  unfilled.set(source.id, copy.id);
  const filled = await request(`${formPath(copy.id)}/draft`, {
    method: "PATCH",
    body: { ...payload, clientUpdatedAt: copy.updatedAt },
    schema: builderFormSchema,
  });
  unfilled.delete(source.id);
  return filled;
}

/** Creates (or finishes) the editable copy of a rejected in-Rescom survey. */
export function copyRejectedForm(source: ResubmitSource, request: Request = apiRequest): Promise<BuilderForm> {
  if (source.type !== "INTERNAL") {
    return Promise.reject(new Error("Only in-Rescom surveys are copied; Google Forms ones reopen the wizard."));
  }
  const running = inFlight.get(source.id);
  if (running) return running;
  const task = runCopy(source, request).finally(() => inFlight.delete(source.id));
  inFlight.set(source.id, task);
  return task;
}

/** Form Builder of the copy. */
export function copyBuilderHref(copy: { id: string }): string {
  return `${formPath(copy.id)}/builder`;
}
