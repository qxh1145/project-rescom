import { isHybridMocking } from "@/lib/api/config";
import { Tag } from "./Tag";

/**
 * Hybrid mode (gate G): marks a screen whose data comes from MSW, not the
 * backend (deferred PRD scope: disputes, quality, reliability, AI, engagement),
 * so testers do not take it for real data. Renders nothing in other modes.
 */
export function DemoDataTag({ className = "" }: { className?: string }) {
  if (!isHybridMocking) return null;
  return (
    <Tag tone="amber" className={className}>
      Dữ liệu minh hoạ
    </Tag>
  );
}
