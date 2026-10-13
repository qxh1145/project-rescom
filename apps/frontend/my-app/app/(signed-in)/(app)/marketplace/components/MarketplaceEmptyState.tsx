import Link from "next/link";
import { Mascot } from "@/components/brand/Mascot";
import { Button, buttonClassName } from "@/components/ui/Button";

/**
 * 3b "Chưa có khảo sát phù hợp" (62:848, mobile). Desktop ASSUMED: the same
 * block centered in the content column. "Cập nhật hồ sơ" goes to the Phase 4
 * profile screen.
 */
export function MarketplaceEmptyState({ availablePoints }: { availablePoints: number | null }) {
  return (
    <section aria-labelledby="marketplace-empty-title" className="mx-auto flex w-full max-w-[342px] flex-col items-center pt-4 text-center">
      <Mascot name="think" height={180} />
      <h1 id="marketplace-empty-title" className="mt-3.5 text-title-sm font-extrabold tracking-[-0.2px] text-ink">
        Chưa có khảo sát phù hợp với bạn
      </h1>
      <p className="mt-4 text-body-relaxed text-ink-muted">
        Bạn đã làm hết khảo sát đang mở cho hồ sơ của mình. Khảo sát mới được duyệt mỗi ngày: Rescom sẽ báo khi có.
      </p>
      <div className="mt-6 flex w-full flex-col gap-2.5">
        <Link href="/account/profile" className={buttonClassName({ size: "lg", fullWidth: true })}>
          Cập nhật hồ sơ để thấy thêm khảo sát
        </Link>
        <Link href="/forms/new" className={buttonClassName({ variant: "secondary", size: "xl", fullWidth: true })}>
          {availablePoints && availablePoints > 0 ? `Dùng ${availablePoints} điểm để tạo khảo sát` : "Tạo khảo sát của bạn"}
        </Link>
      </div>
    </section>
  );
}

/** ASSUMED (design) (not drawn): search/filters matched nothing. */
export function NoMatchState({ onReset }: { onReset: () => void }) {
  return (
    <section aria-labelledby="marketplace-no-match-title" className="mx-auto flex w-full max-w-[342px] flex-col items-center py-6 text-center">
      <Mascot name="search" height={140} />
      <h2 id="marketplace-no-match-title" className="mt-3.5 text-title-sm font-extrabold tracking-[-0.2px] text-ink">
        Không tìm thấy khảo sát
      </h2>
      <p className="mt-3 text-body-relaxed text-ink-muted">Thử từ khoá khác hoặc bỏ bớt bộ lọc để xem thêm khảo sát.</p>
      <Button variant="secondary" size="base" className="mt-6" onClick={onReset}>
        Xoá bộ lọc
      </Button>
    </section>
  );
}
