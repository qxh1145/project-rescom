"use client";

import { ProgressScreen } from "../../../components/ProgressScreen";
import { ComplaintDialog } from "./ComplaintDialog";

/** The Tiến độ tab with the 10c complaint sheet on top ("Khiếu nại" on a 48h row). */
export function ComplaintScreen() {
  return <ProgressScreen overlay={(progress) => <ComplaintDialog progress={progress} />} />;
}
