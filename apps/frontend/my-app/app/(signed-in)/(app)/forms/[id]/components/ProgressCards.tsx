import { Icon } from "@/components/ui/Icon";

export const CARD = "rounded-[18px] border border-line bg-surface p-4 lg:rounded-[22px] lg:p-6";
export const CARD_TITLE = "text-[16px] font-extrabold text-ink lg:text-[17px]";

/**
 * Figma 10a "Lượt đang chờ 48 giờ" (62:2670 / 62:3330), as a count: Google
 * Forms completions whose code was verified less than 48 hours ago (their
 * reward is still pending). Approximate: counted from the attempts' verification time, not from the
 * ledger's pending credits (a reversed credit still counts). Per-attempt rows and their "Khiếu nại" links need
 * the Publisher dispute model (Story 8.5, deferred), so only the count is real.
 */
export function PendingAttemptsCard({ count }: { count: number }) {
  return (
    <section aria-labelledby="pending-attempts-title" data-tour="pending-attempts" className={CARD}>
      <h2 id="pending-attempts-title" className={CARD_TITLE}>
        Lượt đang chờ 48 giờ · {count}
      </h2>
      <p className="mt-1.5 text-caption leading-[18.9px] text-ink-muted lg:mt-2.5 lg:leading-[19.5px]">
        Ước tính: lượt làm Google Forms đã nhập đúng mã trong 48 giờ qua. Sau 48 giờ, điểm tự chuyển cho người trả lời.
      </p>
      {count === 0 ? (
        <p className="mt-3 border-t border-line-subtle pt-3 text-body-sm text-ink-muted">Không có lượt nào đang chờ.</p>
      ) : null}
    </section>
  );
}

/** Figma 10a footer note (62:2702 / 62:3400). */
export function AnswersNote() {
  return (
    <div className="flex gap-2.5 rounded-[14px] bg-surface-subtle px-3.5 py-3 lg:px-4">
      <Icon name="info" size={18} className="mt-px text-ink-muted" />
      <p className="text-caption leading-[19.5px] text-ink">
        RESCOM không lưu nội dung câu trả lời của Google Forms, bạn xem chúng trong Google Forms hoặc Google Sheets.
        Khảo sát tạo bằng Form Builder thì xem, lọc và xuất .xlsx/.csv ngay trong tab Câu trả lời.
      </p>
    </div>
  );
}
