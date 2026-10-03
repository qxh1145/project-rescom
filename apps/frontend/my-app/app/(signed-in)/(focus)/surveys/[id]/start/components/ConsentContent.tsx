import { Icon } from "@/components/ui/Icon";

/** Figma 14 (62:954 / 62:1163) — what Rescom records, shared by both breakpoints. */
const RECORDED = [
  { title: "Thời gian", body: "Lúc câu hỏi hiện ra và lúc bạn nộp bài" },
  { title: "Câu trả lời", body: "Khi bạn chọn, đổi đáp án và chuyển câu" },
  { title: "Mức tập trung", body: "Khi bạn rời khỏi hoặc quay lại trang khảo sát" },
  { title: "Lỗi nhập", body: "Khi một câu trả lời chưa hợp lệ" },
] as const;

export function RecordedList() {
  return (
    <ul className="grid gap-y-3 lg:grid-cols-2 lg:gap-x-3 lg:gap-y-3.5">
      {RECORDED.map((item) => (
        <li key={item.title} className="flex gap-2.5">
          <Icon name="check-circle" size={18} className="mt-0.5 text-tone-teal-fg" />
          <span className="flex flex-col">
            <span className="text-body font-bold text-ink">{item.title}</span>
            <span className="text-caption leading-[18.9px] text-ink-muted">{item.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function NeverRecordedNote() {
  return (
    <p className="flex gap-2.5 rounded-field bg-surface-muted px-3.5 py-[11px] text-caption-relaxed text-ink-strong">
      <Icon name="lock" size={16} className="mt-0.5 text-ink-muted" />
      <span>
        <strong className="font-bold">Không bao giờ ghi lại:</strong> nội dung bạn gõ phím, clipboard, hoạt động ngoài
        khảo sát này.
      </span>
    </p>
  );
}

export function PurposeParagraph() {
  return (
    <p className="text-body-sm text-ink-strong leading-[21.7px]">
      Dữ liệu này chỉ dùng để đánh giá chất lượng câu trả lời.{" "}
      <strong className="font-bold">Người đăng khảo sát không xem được</strong>, họ chỉ thấy kết quả đánh giá. Người mới
      chưa có lịch sử không bị xem là đáng ngờ.
    </p>
  );
}

/** "Trong Rescom · 5 phút · +12 điểm" (no separators in Figma, 12px gaps). */
export function SurveyMeta({ effort, reward }: { effort: string | null; reward: number | null }) {
  return (
    <p className="flex flex-wrap gap-x-3 text-caption">
      <span className="text-ink-muted">Trong Rescom</span>
      {effort ? <span className="text-ink-muted">{effort}</span> : null}
      {reward !== null ? <span className="font-bold text-tone-amber-fg">+{reward} điểm</span> : null}
    </p>
  );
}

/**
 * "Đọc đầy đủ" content. ASSUMED (design): the full notice text is not in Figma; it
 * restates page 14 plus what happens on "Không đồng ý".
 */
export function FullNoticeBody({ version }: { version: number }) {
  return (
    <div className="flex flex-col gap-3 text-body-sm text-ink-strong leading-[21.7px]">
      <p>
        Khi bạn làm một khảo sát tạo trong Rescom, Rescom ghi lại một số tương tác <strong>trong khảo sát đó</strong> để
        đánh giá chất lượng câu trả lời công bằng cho mọi người:
      </p>
      <ul className="list-disc pl-5">
        {RECORDED.map((item) => (
          <li key={item.title}>
            <strong>{item.title}:</strong> {item.body.charAt(0).toLowerCase() + item.body.slice(1)}.
          </li>
        ))}
      </ul>
      <p>
        Rescom không bao giờ ghi lại nội dung bạn gõ phím, clipboard hay hoạt động ngoài khảo sát. Người đăng khảo sát
        chỉ thấy kết quả đánh giá, không thấy dữ liệu tương tác. Người mới chưa có lịch sử không bị xem là đáng ngờ.
      </p>
      <p>
        Nếu không đồng ý, bạn vẫn dùng Rescom và làm khảo sát Google Forms bình thường; chỉ khảo sát tạo trong Rescom
        cần sự đồng ý này. Bạn được hỏi lại khi thông báo đổi phiên bản.
      </p>
      <p className="text-caption text-ink-muted">Thông báo phiên bản {version}</p>
    </div>
  );
}
