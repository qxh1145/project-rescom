import type { Metadata } from "next";
import { ReloadButton } from "@/components/feedback/ErrorActions";
import { ErrorScreen } from "@/components/feedback/ErrorScreen";
import { firstParam, formatMaintenanceEnd } from "@/lib/feedback/error-pages";

export const metadata: Metadata = {
  title: "Đang bảo trì | Rescom",
};

interface MaintenancePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Figma 18.6 "Bảo trì" — desktop 63:4865, mobile 63:5036. End time from `?until=<ISO>`. */
export default async function MaintenancePage({ searchParams }: MaintenancePageProps) {
  const endTime = formatMaintenanceEnd(firstParam((await searchParams).until));
  // ASSUMED: without `until` the "[GIỜ KẾT THÚC]" placeholder becomes a time-less sentence.
  const comeBack = endTime ? `Chúng mình sẽ quay lại lúc ${endTime}.` : "Chúng mình sẽ quay lại sớm thôi.";

  return (
    <ErrorScreen
      pill="Bảo trì"
      title="Rescom đang được nâng cấp"
      description={`${comeBack} Điểm, khảo sát và câu trả lời của bạn vẫn được giữ nguyên.`}
      mascot="fix"
      actions={<ReloadButton>Tải lại trang</ReloadButton>}
    />
  );
}
