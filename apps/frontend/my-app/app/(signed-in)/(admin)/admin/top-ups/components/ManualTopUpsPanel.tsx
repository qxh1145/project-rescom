"use client";

import { TopUpReviewScreen } from "./TopUpReviewScreen";

export function ManualTopUpsPanel({
  onChanged,
  readOnly = false,
  modeUnknown = false,
}: {
  onChanged: () => void;
  readOnly?: boolean;
  modeUnknown?: boolean;
}) {
  return (
    <>
      {readOnly && (
        <p role="note" className="mb-4 rounded-lg bg-tone-amber-bg p-4 text-sm">
          {modeUnknown
            ? "Chỉ đọc. Chưa xác định được trạng thái PayOS — thử lại để duyệt."
            : "Chỉ đọc. Nạp thủ công (chuyển khoản + Admin duyệt) đã ngừng khi bật PayOS. Không duyệt mới, không hoàn tiền cho các giao dịch này."}
        </p>
      )}
      <TopUpReviewScreen embedded readOnly={readOnly} onChanged={onChanged} />
    </>
  );
}

