import type { Metadata } from "next";
import Link from "next/link";
import { HistoryBackButton } from "@/components/feedback/ErrorActions";
import { ErrorScreen, errorActionClassName } from "@/components/feedback/ErrorScreen";

export const metadata: Metadata = {
  title: "Không tìm thấy trang — Rescom",
};

/** Figma 18.1 "Không tìm thấy trang (404)" — desktop 63:5152, mobile 63:5232. */
export default function NotFound() {
  return (
    <ErrorScreen
      pill="Lỗi 404"
      title="Trang này đi lạc mất rồi"
      description="Liên kết có thể đã cũ, đã bị xoá hoặc gõ nhầm. Thử quay lại hoặc về trang Khám phá nhé."
      mascot="confused"
      actions={
        <>
          <Link href="/marketplace" className={errorActionClassName("primary")}>
            Về Khám phá
          </Link>
          <HistoryBackButton>Quay lại trang trước</HistoryBackButton>
        </>
      }
    />
  );
}
