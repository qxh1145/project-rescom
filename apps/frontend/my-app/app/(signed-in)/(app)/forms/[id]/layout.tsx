import { Suspense, type ReactNode } from "react";
import { FormWorkspace } from "./components/FormWorkspace";

/**
 * `/forms/[id]/*` — shared survey header (breadcrumb, title, status pill, meta,
 * actions) and tab nav (Figma 10a 62:2565, 17 63:4702). Tab pages read the
 * loaded survey with `useFormHeader()` from `lib/forms/manage-header-context`.
 */
export default function FormLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <FormWorkspace>{children}</FormWorkspace>
    </Suspense>
  );
}
