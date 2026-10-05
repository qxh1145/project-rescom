import { http } from "msw";
import { z } from "zod";
import {
  COMPLETION_CODE_POLICY,
  COMPLETION_CODE_POLICY_VERSION,
  completionCodeLimitResetRequestSchema,
} from "@rescom/schemas";
import { DECISION_NOTE_MAX, DECISION_NOTE_MIN, disputeCaseOutcomeSchema } from "@/lib/admin/disputes-service";
import { apiUrl, isHybridMocking } from "@/lib/api/config";
import {
  openCaseCounts,
  openDisputeCases,
  resetMockCodeLimit,
  resolveMockDisputeCase,
  toDisputeCaseDto,
} from "../data/admin-disputes";
import { nowIso } from "../db/store";
import { fail, missingCsrf, ok } from "../envelope";
import { HYBRID_ADMIN } from "../hybrid";
import { applyScenario } from "../scenarios";
import { requireMockAdmin } from "./admin";

/**
 * Admin "Khiếu nại & báo lỗi" (Figma 11c). Contracts: `lib/admin/disputes-service.ts`.
 * Queue data and decision effects: `mocks/data/admin-disputes.ts`.
 */

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

const resolveBodySchema = z
  .object({
    outcome: disputeCaseOutcomeSchema,
    note: z.string().trim().min(DECISION_NOTE_MIN).max(DECISION_NOTE_MAX),
  })
  .strict();

async function guardAdmin(request?: Request) {
  const forced = await applyScenario("admin");
  if (forced) return forced;
  // Hybrid: the real session and `SessionGate requireAdmin` decide access (`mocks/hybrid.ts`).
  const admin = isHybridMocking ? HYBRID_ADMIN : await requireMockAdmin();
  if (admin instanceof Response) return admin;
  if (request) {
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
  }
  return admin;
}

export const adminDisputeHandlers = [
  // ASSUMED API CONTRACT: GET /admin/disputes?status=OPEN — open cases of every kind + tab counts.
  http.get(apiUrl("/admin/disputes"), async () => {
    const admin = await guardAdmin();
    if (admin instanceof Response) return admin;
    return ok({ items: openDisputeCases().map(toDisputeCaseDto), counts: openCaseCounts() });
  }),

  // ASSUMED API CONTRACT: POST /admin/disputes/:id/resolve { outcome, note }.
  http.post(apiUrl("/admin/disputes/:id/resolve"), async ({ request, params }) => {
    const admin = await guardAdmin(request);
    if (admin instanceof Response) return admin;
    const body = resolveBodySchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Validation failed", {
        details: body.error.format(),
      });
    }
    const result = resolveMockDisputeCase(String(params.id), body.data, admin);
    if (!result.ok) return fail(result.status, result.code, result.message);
    return ok(toDisputeCaseDto(result.item));
  }),

  // VERIFIED: POST /admin/completion-code-limits/reset (admin-completion-code-limit.controller.ts).
  http.post(apiUrl("/admin/completion-code-limits/reset"), async ({ request }) => {
    const admin = await guardAdmin(request);
    if (admin instanceof Response) return admin;
    const body = completionCodeLimitResetRequestSchema.safeParse(await readJson(request));
    if (!body.success) {
      return fail(400, "VALIDATION_ERROR", body.error.errors[0]?.message ?? "Validation failed", {
        details: body.error.format(),
      });
    }
    const forgiven = resetMockCodeLimit(body.data.respondentId, body.data.formVersionId);
    return ok({
      respondentId: body.data.respondentId,
      formVersionId: body.data.formVersionId,
      failuresForgiven: forgiven,
      failedVerifications: 0,
      limit: COMPLETION_CODE_POLICY.maxFailuresPerAccountVersion,
      resetAt: forgiven > 0 ? nowIso() : null,
      policyVersion: COMPLETION_CODE_POLICY_VERSION,
    });
  }),
];
