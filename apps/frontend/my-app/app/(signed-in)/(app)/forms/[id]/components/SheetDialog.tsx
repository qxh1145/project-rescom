"use client";

import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";

interface SheetDialogProps {
  titleId: string;
  title: string;
  subtitle: ReactNode;
  onClose: () => void;
  /** Desktop panel width (Figma 10b: 576). */
  width?: number;
  children: ReactNode;
}

/**
 * Page 10 dialogs: a centered 24px-radius panel on desktop (10b 63:1393) and
 * a bottom sheet with a grab handle on mobile (10b 63:1844, 10c 62:1721).
 * Always open: the route itself is the dialog, closing navigates away.
 */
export function SheetDialog({ titleId, title, subtitle, onClose, width = 576, children }: SheetDialogProps) {
  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy={titleId}
      width={width}
      className="max-lg:mb-0 max-lg:w-full max-lg:rounded-b-none"
    >
      <div className="px-5 pt-3 pb-5 lg:px-7 lg:pt-7 lg:pb-7">
        <span aria-hidden="true" className="mx-auto block h-1.25 w-10 rounded-full bg-line lg:hidden" />
        <div className="mt-3.5 flex items-start gap-3 lg:mt-0">
          <div className="mr-auto min-w-0">
            <h2 id={titleId} className="text-[20px] font-extrabold text-ink lg:text-title-sm">
              {title}
            </h2>
            <p className="mt-1 text-caption text-ink-muted lg:text-body-sm">{subtitle}</p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={onClose} />
        </div>
        {children}
      </div>
    </Dialog>
  );
}
