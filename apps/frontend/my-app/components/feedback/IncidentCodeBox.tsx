"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { CLIPBOARD_COPY_FAILED_MESSAGE, copyTextToClipboard } from "@/lib/clipboard";

type CopyStatus = "idle" | "copied" | "failed";

/**
 * 500 incident code (63:6186): "Mã sự cố A7F3-2109 · gửi mã này khi liên hệ
 * hỗ trợ" + "Sao chép". `code` is null until it is known on the client.
 */
export function IncidentCodeBox({ code }: { code: string | null }) {
  const [status, setStatus] = useState<CopyStatus>("idle");

  useEffect(() => {
    if (status !== "copied") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2500);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function handleCopy() {
    if (!code) return;
    setStatus((await copyTextToClipboard(code)) ? "copied" : "failed");
  }

  return (
    <div>
      <div className="flex min-h-14 items-center gap-3 rounded-field bg-surface-subtle py-2 pl-3.5 pr-2">
        <p className="flex-1 text-center text-caption text-ink-strong lg:text-left">
          Mã sự cố <span className="select-all font-mono font-bold text-ink">{code ?? "…"}</span> · gửi mã này khi
          liên hệ hỗ trợ
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={!code}
          onClick={handleCopy}
          leadingIcon={<Icon name="copy" size={16} className="text-ink" />}
          className="shrink-0 gap-2! rounded-field! px-3! text-caption!"
        >
          {status === "copied" ? "Đã sao chép" : "Sao chép"}
        </Button>
      </div>
      <p role="status" className={status === "failed" ? "mt-2 text-caption text-danger" : "sr-only"}>
        {status === "copied" ? "Đã sao chép" : status === "failed" ? CLIPBOARD_COPY_FAILED_MESSAGE : ""}
      </p>
    </div>
  );
}
