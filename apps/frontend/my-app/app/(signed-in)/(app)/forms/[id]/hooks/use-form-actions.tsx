"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { formActionErrorMessage } from "@/lib/forms/manage-messages";
import { setPublisherFormPaused } from "@/lib/forms/manage-service";
import { useSession } from "@/lib/session/SessionProvider";
import { CloseFormDialog } from "../components/CloseFormDialog";

interface FormActions {
  /** Opens the "Đóng & hoàn điểm" confirmation. */
  requestClose: () => void;
  /** "Tạm dừng" / "Tiếp tục" (ASSUMED API). */
  togglePause: () => void;
  pausing: boolean;
  /** Last failed pause/resume, shown under the header. */
  error: string | null;
  dismissError: () => void;
}

const FormActionsContext = createContext<FormActions | null>(null);

/**
 * Survey actions shared by the header (desktop) and the Tiến độ status card
 * (mobile, Figma 62:3324): one close dialog, one pause request at a time.
 */
export function FormActionsProvider({ children }: { children: ReactNode }) {
  const { form, applyForm } = useFormHeader();
  const { refresh } = useSession();
  const [closeOpen, setCloseOpen] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const togglePause = useCallback(async () => {
    if (!form || pausing) return;
    setPausing(true);
    setError(null);
    try {
      applyForm(await setPublisherFormPaused(form.id, !form.pausedAt));
    } catch (cause) {
      setError(formActionErrorMessage(cause, "Chưa đổi được trạng thái khảo sát. Vui lòng thử lại."));
    } finally {
      setPausing(false);
    }
  }, [form, pausing, applyForm]);

  const value = useMemo<FormActions>(
    () => ({
      requestClose: () => setCloseOpen(true),
      togglePause: () => void togglePause(),
      pausing,
      error,
      dismissError: () => setError(null),
    }),
    [togglePause, pausing, error],
  );

  return (
    <FormActionsContext.Provider value={value}>
      {children}
      {form ? (
        <CloseFormDialog
          open={closeOpen}
          form={form}
          onClose={() => setCloseOpen(false)}
          onClosed={(updated) => {
            setCloseOpen(false);
            applyForm(updated);
            // The refund moved points back to Khả dụng: refresh the header chip.
            refresh();
          }}
        />
      ) : null}
    </FormActionsContext.Provider>
  );
}

export function useFormActions(): FormActions {
  const value = useContext(FormActionsContext);
  if (!value) throw new Error("useFormActions must be used inside FormActionsProvider");
  return value;
}
