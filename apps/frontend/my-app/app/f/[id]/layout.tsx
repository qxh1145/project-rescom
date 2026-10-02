import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";

/** Guest form: the captcha is a stub, so the route is excluded from the pilot build. */
export default function GuestFormLayout({ children }: { children: ReactNode }) {
  if (PILOT_BUILD) notFound();
  return children;
}
