import type { Metadata } from "next";
import { GoogleFormWizard } from "./components/GoogleFormWizard";

export const metadata: Metadata = {
  title: "Tạo khảo sát Google Forms — Rescom",
};

/**
 * `/forms/new/google-form?step=1|2|3` — Figma 9a (62:3679, 62:4017), 9b
 * (63:266, 63:1161), 9c (63:1768, 63:1991), 9c' (63:2147). In `(focus)`:
 * the mobile frames have no bottom nav (the wizard renders the desktop
 * header itself).
 */
export default function GoogleFormWizardPage() {
  return <GoogleFormWizard />;
}
