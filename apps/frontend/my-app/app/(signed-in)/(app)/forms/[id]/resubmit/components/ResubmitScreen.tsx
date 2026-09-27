"use client";

import { ProgressScreen } from "../../components/ProgressScreen";
import { ResubmitDialog } from "./ResubmitDialog";

/** The Tiến độ tab with the "Sửa & gửi lại" dialog on top (list, header and rejected panel link here). */
export function ResubmitScreen() {
  return <ProgressScreen overlay={() => <ResubmitDialog />} />;
}
