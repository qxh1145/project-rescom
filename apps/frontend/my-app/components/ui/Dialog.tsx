"use client";

import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** id of the visible title element. */
  labelledBy: string;
  /** "alertdialog" for blocking notices (e.g. signed out on another device). */
  role?: "dialog" | "alertdialog";
  /** Panel width in px (Figma: 480, 600, 720). */
  width?: number;
  children: ReactNode;
  className?: string;
  /**
   * false while an action is in flight: Esc and a backdrop click do nothing, so
   * the dialog (and its error / busy state) cannot vanish mid-request. Callers
   * disable or hide their own close (X) button with the same flag.
   */
  dismissible?: boolean;
}

/**
 * Native modal <dialog>: focus trap, Esc and backdrop come from the browser.
 * Figma: 24px radius, drop shadow 0 24 24 rgba(30,36,70,.25), dim backdrop.
 */
export function Dialog({ open, onClose, labelledBy, role = "dialog", width = 600, children, className = "", dismissible = true }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Set while the parent closes the dialog (`open` → false): the resulting native
  // `close` event must not report a close the parent already made.
  const closingFromProp = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      closingFromProp.current = true;
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      role={role}
      aria-labelledby={labelledBy}
      // Every user-initiated close (Esc, backdrop, a form[method=dialog]) ends here, once.
      onClose={() => {
        if (closingFromProp.current) {
          closingFromProp.current = false;
          return;
        }
        onClose();
      }}
      onCancel={(event) => {
        if (role === "alertdialog" || !dismissible) event.preventDefault();
      }}
      onClick={(event) => {
        // Backdrop click: close natively, so `onClose` fires through the `close` event only.
        if (role === "dialog" && dismissible && event.target === ref.current) ref.current?.close();
      }}
      className={`m-auto max-h-[calc(100dvh-32px)] w-[calc(100%-32px)] rounded-card bg-surface p-0 text-ink shadow-[0_24px_24px_rgba(30,36,70,0.25)] backdrop:bg-[rgba(30,36,70,0.6)] ${className}`}
      style={{ maxWidth: width }}
    >
      {open ? children : null}
    </dialog>
  );
}
