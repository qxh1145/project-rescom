"use client";
import { useEffect, useState } from "react";
import { getPayosAvailability } from "@/lib/wallet/payos-top-up-service";
import { TopUpReviewScreen } from "./TopUpReviewScreen";
export function ManualTopUpsPanel({ onChanged }: { onChanged: () => void }) {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { const controller = new AbortController(); getPayosAvailability(controller.signal).then(value => setEnabled(value.payosEnabled)).catch(() => {}); return () => controller.abort(); }, []);
  return <>{enabled && <p role="note" className="mb-4 rounded-lg bg-tone-amber-bg p-4 text-sm">Chỉ đọc. Nạp thủ công (chuyển khoản + Admin duyệt) đã ngừng khi bật PayOS. Không duyệt mới, không hoàn tiền cho các giao dịch này.</p>}<TopUpReviewScreen embedded onChanged={onChanged} /></>;
}
