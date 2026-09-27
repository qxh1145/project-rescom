import Link from "next/link";
import { RescomLogo } from "@/components/brand/RescomLogo";

/** Temporary legal page shell; the official copy is not written yet. */
export function LegalPlaceholder({ title }: { title: string }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex h-18 items-center px-6 lg:px-12">
        <Link href="/" aria-label="Về trang chủ Rescom">
          <RescomLogo size="md" />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4 px-6 py-10">
        <h1 className="text-title font-extrabold text-ink">{title}</h1>
        <p className="text-body-lg text-ink-muted">
          Nội dung đang được hoàn thiện và sẽ được cập nhật trước khi Rescom chính thức ra mắt.
        </p>
        <Link href="/register" className="self-start font-bold text-primary hover:underline">
          Quay lại đăng ký
        </Link>
      </main>
    </div>
  );
}
