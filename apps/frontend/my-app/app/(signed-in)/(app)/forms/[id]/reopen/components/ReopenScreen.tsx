"use client";

import { ProgressScreen } from "../../components/ProgressScreen";
import { ReopenDialog } from "./ReopenDialog";

/** The Tiến độ tab with the 10b dialog on top (the list's "Mở lại" deep-links here). */
export function ReopenScreen() {
  return <ProgressScreen overlay={() => <ReopenDialog />} />;
}
