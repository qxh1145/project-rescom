"use client";

import { useCallback, useState } from "react";
import type { UserRole } from "@rescom/schemas";
import { userActionErrorMessage } from "@/lib/admin/users-messages";
import { updateAdminUserRole, updateAdminUserStatus, type AdminUserView } from "@/lib/admin/users-service";
import { isSessionLost } from "@/lib/session/session-status";
import { useSession } from "@/lib/session/SessionProvider";

export type UserAction = "lock" | "unlock" | "role";

/**
 * Lock / unlock (`PATCH /admin/users/:id/status`) and role change
 * (`PATCH /admin/users/:id/role`). Both revoke the target's sessions on the backend.
 */
export function useUserActions(onUpdated: (user: AdminUserView) => void) {
  const { refresh } = useSession();
  const [busy, setBusy] = useState<UserAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (action: UserAction, call: () => Promise<AdminUserView>): Promise<boolean> => {
      setBusy(action);
      setError(null);
      try {
        onUpdated(await call());
        return true;
      } catch (cause) {
        // 401 / own account locked: SessionGate takes over.
        if (isSessionLost(cause)) refresh();
        else setError(userActionErrorMessage(cause, action));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [onUpdated, refresh],
  );

  return {
    busy,
    error,
    clearError: () => setError(null),
    lock: (id: string, reason: string) => run("lock", () => updateAdminUserStatus(id, "LOCKED", reason)),
    unlock: (id: string) => run("unlock", () => updateAdminUserStatus(id, "ACTIVE")),
    changeRole: (id: string, role: UserRole) => run("role", () => updateAdminUserRole(id, role)),
  };
}
