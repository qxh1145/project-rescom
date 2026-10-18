"use client";

import { TopUpReviewScreen } from "./TopUpReviewScreen";

export function ManualTopUpsPanel({
  onChanged,
  readOnly = false,
}: {
  onChanged: () => void;
  readOnly?: boolean;
}) {
  return (
    <>
      {readOnly && (
        <p role="note" className="mb-4 rounded-lg bg-tone-amber-bg p-4 text-sm">
          Chỉ đọc. Nạp thủ công (chuyển khoản + Admin duyệt) đã ngừng khi bật PayOS. Không duyệt mới, không hoàn tiền cho các giao dịch này.
        </p>
      )}
      <TopUpReviewScreen embedded readOnly={readOnly} onChanged={onChanged} />
    </>
  );
}

