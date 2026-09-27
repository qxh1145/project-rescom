import Link from "next/link";

interface AuthFooterNoteProps {
  /** `/register`, keeping `returnTo`. */
  registerHref: string;
}

export function AuthFooterNote({ registerHref }: AuthFooterNoteProps) {
  return (
    <p className="text-center text-label text-ink-muted lg:text-left">
      Chưa có tài khoản?{" "}
      <Link href={registerHref} className="font-bold text-primary hover:underline">
        Đăng ký
      </Link>
      <span className="hidden lg:inline"> · Mỗi tài khoản chỉ đăng nhập trên một thiết bị cùng lúc.</span>
    </p>
  );
}
