import { NextResponse, type NextRequest } from "next/server";
import { PILOT_BUILD } from "@/lib/pilot-scope";

/**
 * Story IR.5 E1: pilot-hidden routes answer a real HTTP 404. The page guards'
 * `notFound()` runs after the app shell has started streaming, so on its own
 * it renders the not-found UI with status 200. Rewriting to an unmatched path
 * makes Next serve `app/not-found.tsx` with 404 before anything renders.
 * The page guards stay as the second layer.
 */
export function proxy(request: NextRequest) {
  if (!PILOT_BUILD) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_pilot-hidden", request.url));
}

/** Must be literal (Next reads it statically); tests/pilot-scope.test.mjs pins it to PILOT_HIDDEN_ROUTES. */
export const config = {
  matcher: [
    "/account/trust",
    "/account/streak",
    "/account/tier",
    "/leaderboard",
    "/forms/:id/complaints/:attemptId",
    "/forms/:id/quality",
    "/forms/:id/export",
    "/admin/quality",
    "/forms/new/builder/ai",
    "/forms/:id/builder/ai",
    "/f/:id",
  ],
};
