"use client";

import { useState } from "react";
import type { PublisherFormSummary } from "@/lib/forms/manage-service";
import { useSession } from "@/lib/session/SessionProvider";
import { CloseFormDialog } from "../[id]/components/CloseFormDialog";

/**
 * "Rút lại" of a list row (Phase 5 M7): the survey waiting for review or the
 * re-versioned draft is withdrawn through the shared close dialog; the list
 * reloads and the points chip refreshes after the refund.
 */
export function WithdrawAction({
  form,
  className,
  label,
  onWithdrawn,
}: {
  form: PublisherFormSummary;
  className: string;
  label: string;
  onWithdrawn: () => void;
}) {
  const { refresh } = useSession();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <CloseFormDialog
        open={open}
        form={form}
        onClose={() => setOpen(false)}
        onClosed={() => {
          setOpen(false);
          onWithdrawn();
          refresh();
        }}
      />
    </>
  );
}
