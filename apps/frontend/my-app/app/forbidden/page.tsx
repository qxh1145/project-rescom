import type { Metadata } from "next";
import Link from "next/link";
import { ErrorScreen, errorActionClassName } from "@/components/feedback/ErrorScreen";
import { SUPPORT_MAILTO } from "@/lib/feedback/error-pages";

export const metadata: Metadata = {
  title: "Không có quyền truy cập — Rescom",
};

/** Figma 18.5 "Không có quyền (403)" — desktop 63:4453, mobile 63:4674. `SessionGate` sends non-admins here. */
export default function ForbiddenPage() {
  return (
    <ErrorScreen
      pill="Lỗi 403"
      title="Khu vực này cần quyền riêng"
      description="Tài khoản của bạn không có quyền xem trang này. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ hỗ trợ."
      mascot="shield"
      actions={
        <>
          <Link href="/marketplace" className={errorActionClassName("primary")}>
            Về Khám phá
          </Link>
          <a href={SUPPORT_MAILTO} className={errorActionClassName("secondary")}>
            Liên hệ hỗ trợ
          </a>
        </>
      }
    />
  );
}
