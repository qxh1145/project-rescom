"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { isApiError } from "@/lib/api/api-error";
import { logout } from "@/lib/auth/auth-service";
import { ACCOUNT_MESSAGES } from "@/lib/profile/account-messages";

/** "Đăng xuất": VERIFIED `POST /auth/logout`, then `/login`. A 401 means the session is already gone. */
export function useLogout() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await logout();
    } catch (cause) {
      if (!(isApiError(cause) && cause.status === 401)) {
        setError(ACCOUNT_MESSAGES.logoutFailed);
        setPending(false);
        return;
      }
    }
    router.replace("/login");
  }, [router]);

  return { signOut, pending, error, dismissError: () => setError(null) };
}
