import {
  adminCodeIssueListSchema, adminCodeIssueSchema, adminResolveCodeIssueSchema,
  type AdminCodeIssueListQuery, type AdminResolveCodeIssueDto,
} from "@rescom/schemas";
import { apiRequest } from "../api/client.ts";
import { REWARDS_ENABLED } from "../pilot-scope.ts";

export function listAdminCodeIssues(query: Partial<AdminCodeIssueListQuery> = {}, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  const params = new URLSearchParams();
  if (query.status !== undefined) params.set("status", query.status);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.offset !== undefined) params.set("offset", String(query.offset));
  return apiRequest(`/admin/rewards/code-issues?${params}`, { schema: adminCodeIssueListSchema, signal });
}

export function getAdminCodeIssue(id: string, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/code-issues/${encodeURIComponent(id)}`, { schema: adminCodeIssueSchema, signal });
}

export function resolveAdminCodeIssue(id: string, input: AdminResolveCodeIssueDto, signal?: AbortSignal) {
  if (!REWARDS_ENABLED) throw new Error("Rewards admin disabled");
  return apiRequest(`/admin/rewards/code-issues/${encodeURIComponent(id)}/resolve`, {
    method: "POST", body: adminResolveCodeIssueSchema.parse(input), schema: adminCodeIssueSchema, signal,
  });
}
