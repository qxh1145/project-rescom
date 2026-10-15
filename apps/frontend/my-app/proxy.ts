import { NextResponse, type NextRequest } from "next/server";
import { edgeRequestHeaders } from "@/lib/api/edge-headers";
import { PILOT_BUILD, REWARDS_ENABLED } from "@/lib/pilot-scope";

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api" || request.nextUrl.pathname.startsWith("/api/")) {
    const headers = edgeRequestHeaders(request.headers, process.env.RESCOM_EDGE_KEY);
    return headers ? NextResponse.next({ request: { headers } }) : NextResponse.next();
  }

  const path = request.nextUrl.pathname;
  const isRewardsRoute =
    path === "/rewards" ||
    path.startsWith("/rewards/") ||
    path === "/admin/vouchers" ||
    path.startsWith("/admin/vouchers/") ||
    path === "/admin/flash-sales" ||
    path.startsWith("/admin/flash-sales/") ||
    path === "/admin/code-issues" ||
    path === "/admin/voucher-stats";

  if (isRewardsRoute) {
    if (!REWARDS_ENABLED) {
      return NextResponse.rewrite(new URL("/_pilot-hidden", request.url));
    }
    return NextResponse.next();
  }

  if (!PILOT_BUILD) return NextResponse.next();
  return NextResponse.rewrite(new URL("/_pilot-hidden", request.url));
}

export const config = {
  matcher: [
    "/api/:path*",
    "/account/trust",
    "/account/streak",
    "/account/tier",
    "/leaderboard",
    "/forms/:id/complaints/:attemptId",
    "/forms/:id/quality",
    "/forms/:id/export",
    "/admin/quality",
    "/admin/vouchers",
    "/admin/vouchers/new",
    "/admin/vouchers/:id",
    "/admin/vouchers/:id/edit",
    "/admin/flash-sales",
    "/admin/flash-sales/new",
    "/admin/flash-sales/:id/edit",
    "/admin/code-issues",
    "/admin/voucher-stats",
    "/forms/new/builder/ai",
    "/forms/:id/builder/ai",
    "/f/:id",
    "/rewards",
    "/rewards/:id",
    "/rewards/my-vouchers",
    "/rewards/my-vouchers/:ticketId",
    "/rewards/history",
  ],
};
