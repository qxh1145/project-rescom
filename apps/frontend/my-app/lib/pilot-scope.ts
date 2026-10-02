/**
 * Story IR.1 owner decision (2026-10-02): the pilot build hides every
 * DEFERRED_KEEP_MOCK screen and the data-export / guest-form scope. Build-time
 * flag (`NEXT_PUBLIC_PILOT_BUILD=true`); unset keeps the hybrid dev behavior.
 */
export const PILOT_BUILD = (process.env.NEXT_PUBLIC_PILOT_BUILD ?? "").trim().toLowerCase() === "true";

/**
 * Routes that render `notFound()` in the pilot build. `guard` is the file
 * (relative to `app/`) that checks `PILOT_BUILD`; tests/pilot-scope.test.mjs
 * reads this list, so a new hidden route is added here only.
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
