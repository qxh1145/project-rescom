import Link from "next/link";
import { Mascot } from "@/components/brand/Mascot";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

export type AttemptEndedVariant = "locked" | "account-limit" | "expired" | "cancelled";

interface AttemptEndedScreenProps {
  variant: AttemptEndedVariant;
  /** "Báo Admin kiểm tra" — omitted for a cancelled attempt (the backend refuses reports on it). */
  onReport?: () => void;
}

const COPY: Record<AttemptEndedVariant, { tag: string; title: string; body: string }> = {
  // Figma 5c (62:67).
  locked: {
    tag: "Lượt làm đã bị khoá",
    title: "Mã hoàn thành sai 3 lần",
    body: "Để tránh gian lận, Rescom tạm khoá lượt làm khảo sát này. Nếu bạn đã làm thật nhưng form không hiện mã hoặc mã không khớp, hãy báo Admin — Admin sẽ kiểm tra và mở lại cho bạn.",
  },
  // ASSUMED (not drawn): 409 COMPLETION_CODE_LIMIT_REACHED, 6 wrong codes on this survey version.
  "account-limit": {
    tag: "Đã hết lượt nhập mã",
    title: "Bạn đã nhập sai mã quá nhiều lần",
    body: "Rescom tạm dừng nhập mã cho khảo sát này trên tài khoản của bạn. Nếu bạn đã làm thật, hãy báo Admin — Admin sẽ kiểm tra và mở lại cho bạn.",
  },
  // ASSUMED (not drawn).
  expired: {
    tag: "Lượt làm đã hết hạn",
    title: "Hết 30 phút giữ chỗ",
    body: "Lượt làm này không còn nhận mã hoàn thành. Nếu bạn đã làm xong form nhưng chưa kịp nhập mã, hãy báo Admin để được kiểm tra.",
  },
  cancelled: {
    tag: "Đã huỷ lượt làm",
    title: "Bạn đã huỷ lượt làm này",
    body: "Chỗ của bạn đã được trả lại. Bạn có thể chọn một khảo sát khác để nhận điểm.",
  },
};

/** Figma 5c (mobile 62:67; desktop ASSUMED: same column, centered) and its ASSUMED siblings. */
export function AttemptEndedScreen({ variant, onReport }: AttemptEndedScreenProps) {
  const copy = COPY[variant];
  return (
    <main className="flex flex-1 flex-col items-center px-6 pb-10 pt-7 text-center lg:pt-16">
      <div className="flex w-full max-w-[342px] flex-col items-center lg:max-w-[420px]">
        <Mascot name={variant === "cancelled" ? "wave" : "sad"} height={160} />
        <span className="mt-3.5 inline-flex h-7.5 items-center gap-1.5 rounded-full bg-danger-soft px-3 text-[13px] font-bold text-danger-strong">
          <Icon name="lock" size={14} />
          {copy.tag}
        </span>
        <h1
          data-focus-heading
          tabIndex={-1}
          className="mt-3.5 text-title-sm leading-[28.6px] font-extrabold text-ink focus:outline-none"
        >
          {copy.title}
        </h1>
        <p className="mt-3.5 text-body-relaxed text-ink-muted">{copy.body}</p>
        <div className="mt-6 flex w-full flex-col gap-2.5">
          {onReport ? (
            <Button size="lg" fullWidth onClick={onReport} leadingIcon={<Icon name="flag" size={18} />}>
              Báo Admin kiểm tra
            </Button>
          ) : null}
          <Link
            href="/marketplace"
            className={buttonClassName({ variant: onReport ? "secondary" : "primary", size: "xl", fullWidth: true })}
          >
            Làm khảo sát khác
          </Link>
        </div>
      </div>
    </main>
  );
}
