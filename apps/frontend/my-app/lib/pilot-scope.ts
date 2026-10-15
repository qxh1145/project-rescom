/**
 * Story IR.1 owner decision (2026-10-02): the pilot build hides every
 * DEFERRED_KEEP_MOCK screen and the data-export / guest-form scope. Build-time
 * flag (`NEXT_PUBLIC_PILOT_BUILD=true`); unset keeps the hybrid dev behavior.
 */
export const PILOT_BUILD = (process.env.NEXT_PUBLIC_PILOT_BUILD ?? "").trim().toLowerCase() === "true";

/**
 * Story 12.11 (AC 4): Rewards feature flag, off everywhere by default.
 * Independent of PILOT_BUILD; turning on in production requires PRD OQ-24.
 */
export const REWARDS_ENABLED = (process.env.NEXT_PUBLIC_REWARDS_ENABLED ?? "").trim().toLowerCase() === "true";

/**
 * Routes that render `notFound()` in the pilot build.
 */
export const PILOT_HIDDEN_ROUTES: ReadonlyArray<{ route: string; guard: string }> = [
  { route: "/account/trust", guard: "(signed-in)/(app)/account/trust/page.tsx" },
  { route: "/account/streak", guard: "(signed-in)/(app)/account/streak/page.tsx" },
  { route: "/account/tier", guard: "(signed-in)/(app)/account/tier/page.tsx" },
  { route: "/leaderboard", guard: "(signed-in)/(app)/leaderboard/page.tsx" },
  { route: "/forms/[id]/complaints/[attemptId]", guard: "(signed-in)/(app)/forms/[id]/complaints/[attemptId]/page.tsx" },
  { route: "/forms/[id]/quality", guard: "(signed-in)/(app)/forms/[id]/quality/page.tsx" },
  { route: "/forms/[id]/export", guard: "(signed-in)/(app)/forms/[id]/export/page.tsx" },
  { route: "/admin/quality", guard: "(signed-in)/(admin)/admin/quality/page.tsx" },
  { route: "/forms/new/builder/ai", guard: "(signed-in)/(focus)/forms/new/builder/ai/page.tsx" },
  { route: "/forms/[id]/builder/ai", guard: "(signed-in)/(focus)/forms/[id]/builder/ai/page.tsx" },
  { route: "/f/[id]", guard: "f/[id]/layout.tsx" },
];

/**
 * Story 12.11 Task 2.2: Rewards routes gated by REWARDS_ENABLED, independent of PILOT_BUILD.
 */
export const REWARDS_ROUTES: ReadonlyArray<{ route: string; guard: string }> = [
  { route: "/admin/vouchers", guard: "(signed-in)/(admin)/admin/vouchers/page.tsx" },
  { route: "/admin/vouchers/new", guard: "(signed-in)/(admin)/admin/vouchers/new/page.tsx" },
  { route: "/admin/vouchers/[id]", guard: "(signed-in)/(admin)/admin/vouchers/[id]/page.tsx" },
  { route: "/admin/vouchers/[id]/edit", guard: "(signed-in)/(admin)/admin/vouchers/[id]/edit/page.tsx" },
  { route: "/admin/flash-sales", guard: "(signed-in)/(admin)/admin/flash-sales/page.tsx" },
  { route: "/admin/flash-sales/new", guard: "(signed-in)/(admin)/admin/flash-sales/new/page.tsx" },
  { route: "/admin/flash-sales/[id]/edit", guard: "(signed-in)/(admin)/admin/flash-sales/[id]/edit/page.tsx" },
  { route: "/admin/code-issues", guard: "(signed-in)/(admin)/admin/code-issues/page.tsx" },
  { route: "/admin/voucher-stats", guard: "(signed-in)/(admin)/admin/voucher-stats/page.tsx" },
  { route: "/rewards", guard: "(signed-in)/(app)/rewards/page.tsx" },
  { route: "/rewards/[id]", guard: "(signed-in)/(app)/rewards/[id]/page.tsx" },
  { route: "/rewards/my-vouchers", guard: "(signed-in)/(app)/rewards/my-vouchers/page.tsx" },
  { route: "/rewards/my-vouchers/[ticketId]", guard: "(signed-in)/(app)/rewards/my-vouchers/[ticketId]/page.tsx" },
  { route: "/rewards/history", guard: "(signed-in)/(app)/rewards/history/page.tsx" },
];

/** A pilot build must never serve MSW demo data (`enabled`/`hybrid`); importing this from next.config.ts fails `next build`. */
export function assertPilotMockingDisabled(pilot: boolean, mocking: string | undefined): void {
  if (pilot && (mocking === "enabled" || mocking === "hybrid")) {
    throw new Error(
      `NEXT_PUBLIC_PILOT_BUILD=true requires NEXT_PUBLIC_API_MOCKING=disabled (got "${mocking}").`,
    );
  }
}

assertPilotMockingDisabled(PILOT_BUILD, process.env.NEXT_PUBLIC_API_MOCKING);
