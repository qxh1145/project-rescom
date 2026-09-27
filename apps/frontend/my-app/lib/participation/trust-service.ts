import { z } from "zod";
import { apiRequest } from "../api/client.ts";

/**
 * Figma 17d "Độ tin cậy câu trả lời" (63:5117) — the respondent's own,
 * read-only reliability summary.
 *
 * ASSUMED API CONTRACT: `GET /integrity/reliability/me`. The backend computes
 * reliability (Integrity Engine) but exposes no respondent route yet.
 * `level`: FORMING = too little evidence ("Đang hình thành"); GOOD / REVIEW
 * are the formed states. `recent[].result`: PASSED "Đạt", REVIEW "Cần xem
 * thêm", PENDING "Đang xét", NOT_ASSESSED "Không đánh giá" (Google Forms:
 * only the completion code is checked).
 */
export const reliabilitySummarySchema = z.object({
  level: z.enum(["FORMING", "GOOD", "REVIEW"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  internalResponseCount: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
  recent: z.array(
    z.object({
      attemptId: z.string().uuid(),
      surveyTitle: z.string().min(1),
      source: z.enum(["INTERNAL", "EXTERNAL"]),
      submittedAt: z.string().datetime(),
      result: z.enum(["PASSED", "REVIEW", "PENDING", "NOT_ASSESSED"]),
    }),
  ),
});
export type ReliabilitySummary = z.infer<typeof reliabilitySummarySchema>;
export type ReliabilityResult = ReliabilitySummary["recent"][number]["result"];

export function getReliabilitySummary(signal?: AbortSignal): Promise<ReliabilitySummary> {
  return apiRequest("/integrity/reliability/me", { schema: reliabilitySummarySchema, signal });
}
