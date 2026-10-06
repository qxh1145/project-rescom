import Image from "next/image";
import { Mascot } from "@/components/brand/Mascot";
import { RescomLogo } from "@/components/brand/RescomLogo";

/** Mobile top section — Figma `62:428` + title/description. Hidden from `lg`. */
export function AuthMobileHeader() {
  return (
    <header className="lg:hidden">
      <div className="relative h-75 overflow-hidden">
        <Image
          src="/brand/hills-mobile.jpg"
          alt=""
          fill
          fetchPriority="high"
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute left-6 top-14">
          <RescomLogo size="md" highPriority />
        </div>
        <Mascot name="wave" height={150} className="absolute left-1/2 top-33 -translate-x-1/2" />
      </div>
      <div className="mx-auto max-w-[440px] px-6 pt-5 text-center">
        {/* Figma's one-line title is 343px in a 342px column; the bleed keeps it on one line at 390. */}
        <h1 className="-mx-1 text-title font-extrabold text-ink">Nhận hỗ trợ, Đóng góp lại</h1>
        <p className="mt-1.5 text-body-sm text-ink-muted">
          Làm khảo sát của bạn bè để nhận điểm, dùng điểm để tìm người trả lời khảo sát của bạn.
        </p>
      </div>
    </header>
  );
}
