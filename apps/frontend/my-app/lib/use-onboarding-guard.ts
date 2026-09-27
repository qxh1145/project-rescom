"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { mockRepository } from "@/lib/mock/repository.ts";
import type { MockOnboardingStatus } from "@/lib/mock/types.ts";
import { buildOnboardingRedirect } from "@/lib/onboarding.ts";

function currentPath(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.pathname}${window.location.search}`;
}

export interface OnboardingGuard {
  /** True once the user may see the earning page (or the check failed open). */
  ready: boolean;
  onboarding: MockOnboardingStatus | null;
  /** Sends the user to the Mandatory Demographic Survey, remembering this page. */
  redirectToOnboarding: () => void;
}

/**
 * Client-side routing guard for earning pages (Story 7.1, FR-6): signed-out
 * users go to `/login`, users without a complete demographic profile go to
 * the Mandatory Demographic Survey. The rule itself is enforced again by the
 * repository (`DEMOGRAPHIC_PROFILE_REQUIRED`), so a failed status check falls
 * through to the page, whose data calls stay gated.
 */
export function useRequireCompletedOnboarding(): OnboardingGuard {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [onboarding, setOnboarding] = useState<MockOnboardingStatus | null>(null);

  const redirectToOnboarding = useCallback(() => {
    router.replace(buildOnboardingRedirect(currentPath()));
  }, [router]);

  useEffect(() => {
    let active = true;

    async function check() {
      try {
        const status = await mockRepository.getOnboardingStatus();
        if (!active) return;
        if (!status.isAuthenticated) {
          router.replace("/login");
          return;
        }
        if (!status.isProfileComplete) {
          redirectToOnboarding();
          return;
        }
        setOnboarding(status);
        setReady(true);
      } catch {
        if (active) setReady(true);
      }
    }

    void check();

    return () => {
      active = false;
    };
  }, [router, redirectToOnboarding]);

  return { ready, onboarding, redirectToOnboarding };
}
