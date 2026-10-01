"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { useSession } from "@/lib/session/SessionProvider";
import { CloseFormDialog } from "../components/CloseFormDialog";
import { EditVersionDialog } from "../components/EditVersionDialog";

interface FormActions {
  /** Opens the "Đóng & hoàn điểm" confirmation. */
  requestClose: () => void;
  /** Opens the "Chỉnh sửa" (new version) confirmation of a running Form Builder survey. */
  requestEdit: () => void;
}

const FormActionsContext = createContext<FormActions | null>(null);

/**
 * Survey actions shared by the header (desktop) and the Tiến độ status card
 * (mobile, Figma 62:3324): one close dialog and one "Chỉnh sửa" dialog. No
 * pause/resume: the backend has no PAUSED state (IR.4a AC6, `PAUSE_SUPPORTED`).
 */
export function FormActionsProvider({ children }: { children: ReactNode }) {
  const { form, applyForm } = useFormHeader();
  const { refresh } = useSession();
  const [closeOpen, setCloseOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const value = useMemo<FormActions>(
    () => ({
      requestClose: () => setCloseOpen(true),
      requestEdit: () => setEditOpen(true),
    }),
    [],
  );

  return (
    <FormActionsContext.Provider value={value}>
      {children}
      {form ? (
        <EditVersionDialog
          open={editOpen}
          form={form}
          onClose={() => setEditOpen(false)}
          onCreated={(updated) => {
            setEditOpen(false);
            applyForm(updated);
          }}
        />
      ) : null}
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
