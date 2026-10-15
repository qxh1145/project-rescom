"use client";
import type { AdminCodeIssueStatusFilter } from "@rescom/schemas";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getAdminCodeIssue, listAdminCodeIssues } from "@/lib/admin/rewards-code-issues-service";
import { PAGE_SIZE } from "@/lib/admin/rewards-code-issues-view";

export function useAdminCodeIssues(status: AdminCodeIssueStatusFilter, offset: number) {
  return useApiQuery(`admin:code-issues:${status}:${offset}`, signal => listAdminCodeIssues({ status, limit: PAGE_SIZE, offset }, signal));
}
export function useAdminCodeIssue(id: string | null) {
  return useApiQuery(id ? `admin:code-issue:${id}` : null, signal => getAdminCodeIssue(id!, signal));
}
